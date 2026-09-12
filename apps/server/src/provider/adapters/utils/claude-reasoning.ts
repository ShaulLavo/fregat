import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type {
  ModelSelection,
  ProviderInstanceId,
  ProviderModelCapabilities,
} from '@workspace/contracts'
import { claudeModelCapabilities } from './claude-models'
import { modelOptionValue, type ModelOptions } from './model-options'

/**
 * Reasoning effort and extended thinking, translated from the per-session
 * `ModelSelection` into the agent SDK's `Options`. Type-only SDK imports, same
 * rule as claude-query-options.ts: nothing here may pull in the SDK runtime.
 *
 * Two of the levels we advertise are NOT API effort levels, and sending them as
 * `Options.effort` fails silently:
 *   - `ultrathink` is a PROMPT KEYWORD. The turn runs at the model's default
 *     level and the keyword is prefixed onto the message text instead.
 *   - `ultracode` is a Claude Code session SETTING that pairs with xhigh.
 * `effortPlan` is the single gate that guarantees only the SDK's own
 * `EffortLevel` union can ever reach `Options.effort`.
 */

/** The SDK's `Settings`, which the package does not export under that name. */
type ClaudeSettings = Exclude<NonNullable<Options['settings']>, string>

type ClaudeEffortLevel = NonNullable<Options['effort']>

export type ClaudeReasoning = {
  effort?: ClaudeEffortLevel
  /** Set only for `ultrathink`, which is injected into the prompt text. */
  promptPrefix?: 'ultrathink'
  settings?: ClaudeSettings
  thinking?: NonNullable<Options['thinking']>
}

export type ClaudeEffortPlan = {
  effort?: ClaudeEffortLevel
  promptPrefix?: 'ultrathink'
  ultracode?: boolean
}

const SDK_EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

const ULTRACODE = 'ultracode'
const ULTRATHINK = 'ultrathink'
const ULTRATHINK_PROMPT_PREFIX = 'Ultrathink:'

/**
 * Where a level the selected model does not advertise lands. `xhigh` means
 * "deeper than high", so a model without it gets `max` rather than dropping
 * back down — the reference's `normalizeClaudeCliEffort` makes the same call.
 * Everything else falls back to the model's own default, and a model that
 * advertises nothing sends no effort at all. Never an error: a stale
 * per-session selection must not fail the turn.
 */
const EFFORT_DEGRADES: Record<string, string> = { xhigh: 'max' }

export function claudeReasoning(input: {
  modelSelection: ModelSelection
  providerInstanceId: ProviderInstanceId
}): ClaudeReasoning {
  // Same instance-mismatch guard as claudeModelId: a selection aimed at another
  // provider carries none of our model's options, so ignore it wholesale.
  if (input.modelSelection.providerInstanceId !== input.providerInstanceId) return {}

  const capabilities = claudeModelCapabilities(input.modelSelection.model)
  const options = input.modelSelection.options
  const plan = effortPlan({ capabilities, requested: requestedEffort(options) })
  const thinking = thinkingSelection(options, capabilities)

  return {
    ...(plan.effort ? { effort: plan.effort } : {}),
    ...(plan.promptPrefix ? { promptPrefix: plan.promptPrefix } : {}),
    ...reasoningSettings(plan, thinking),
    ...thinkingConfig(thinking),
  }
}

/**
 * The resolution itself, taking capabilities directly so it can be exercised
 * against ladders no catalog row happens to have.
 */
export function effortPlan(input: {
  capabilities: ProviderModelCapabilities | null
  requested: string | undefined
}): ClaudeEffortPlan {
  const { capabilities } = input
  const modelDefault = capabilities?.defaultReasoningEffort?.trim()
  const requested = input.requested?.trim()
  // Nothing chosen sends NO effort — the CLI's own resolved settings decide.
  // `defaultReasoningEffort` is what the picker preselects and where a level
  // this model cannot run lands; it is not something we send unasked.
  if (!requested) return {}

  // The reference runs an ultrathink turn at the model's default level, because
  // the level slot is spoken for by a keyword that has no flag.
  if (requested === ULTRATHINK && advertises(capabilities, ULTRATHINK)) {
    return { ...sdkEffortPlan(modelDefault), promptPrefix: 'ultrathink' }
  }
  if (requested === ULTRACODE && advertises(capabilities, ULTRACODE)) {
    return { ...sdkEffortPlan('xhigh'), ultracode: true }
  }
  if (advertises(capabilities, requested)) return sdkEffortPlan(requested)

  return sdkEffortPlan(degradedEffort(capabilities, requested) ?? modelDefault)
}

/**
 * `ultrathink` reaches the model as a prompt keyword, exactly as the reference
 * injects it — the CLI has no flag for it. An empty message is left alone: a
 * lone keyword is not a turn.
 */
export function claudePromptText(messageText: string, reasoning: ClaudeReasoning): string {
  if (reasoning.promptPrefix !== 'ultrathink') return messageText

  const trimmed = messageText.trim()
  if (trimmed.length === 0) return messageText
  if (trimmed.startsWith(ULTRATHINK_PROMPT_PREFIX)) return trimmed

  return `${ULTRATHINK_PROMPT_PREFIX}\n${trimmed}`
}

/** The SDK-facing subset. `promptPrefix` is ours and never leaves this layer. */
export function claudeReasoningQueryOptions(
  reasoning: ClaudeReasoning,
): Pick<Options, 'effort' | 'settings' | 'thinking'> {
  return {
    ...(reasoning.effort ? { effort: reasoning.effort } : {}),
    ...(reasoning.settings ? { settings: reasoning.settings } : {}),
    ...(reasoning.thinking ? { thinking: reasoning.thinking } : {}),
  }
}

/**
 * Stable identity for session reuse. Effort, settings and thinking are fixed
 * when the query is created, so a changed plan has to restart the session the
 * same way a changed model does — otherwise the new level silently does nothing
 * until the next restart.
 */
export function claudeReasoningKey(reasoning: ClaudeReasoning): string {
  return JSON.stringify([
    reasoning.effort ?? null,
    reasoning.promptPrefix ?? null,
    reasoning.settings?.ultracode ?? null,
    reasoning.settings?.alwaysThinkingEnabled ?? null,
    reasoning.thinking?.type ?? null,
  ])
}

function requestedEffort(options: ModelOptions): string | undefined {
  const value = modelOptionValue(options, 'reasoningEffort')
  return typeof value === 'string' ? value : undefined
}

/**
 * The explicit override, ignored outright by a model that does not advertise
 * thinking support. Absent means "leave the CLI's own default alone".
 */
function thinkingSelection(
  options: ModelOptions,
  capabilities: ProviderModelCapabilities | null,
): boolean | undefined {
  if (capabilities?.supportsExtendedThinking !== true) return undefined

  const value = modelOptionValue(options, 'thinking')
  return typeof value === 'boolean' ? value : undefined
}

function thinkingConfig(thinking: boolean | undefined): Pick<ClaudeReasoning, 'thinking'> {
  if (thinking === undefined) return {}
  // `thinking` supersedes the deprecated `maxThinkingTokens`, which we never
  // send. 'adaptive' — not 'enabled' — is the on state here: it is the SDK's own
  // default for the models in our catalog and needs no invented token budget,
  // whereas 'enabled' requires one and exists for older models.
  if (thinking) return { thinking: { type: 'adaptive' } }

  return { thinking: { type: 'disabled' } }
}

function reasoningSettings(
  plan: ClaudeEffortPlan,
  thinking: boolean | undefined,
): Pick<ClaudeReasoning, 'settings'> {
  const settings: ClaudeSettings = {
    // The CLI-side twin of `thinking`: the session reads
    // `settings.alwaysThinkingEnabled`, the request carries `thinking`. Both are
    // written together so the two can never disagree.
    ...(thinking === undefined ? {} : { alwaysThinkingEnabled: thinking }),
    // `ultracode` is a session setting, not an API level — the level itself was
    // already normalized to xhigh.
    ...(plan.ultracode ? { ultracode: true } : {}),
  }
  if (Object.keys(settings).length === 0) return {}

  return { settings }
}

function advertises(capabilities: ProviderModelCapabilities | null, effort: string): boolean {
  return capabilities?.reasoningEfforts?.some((option) => option.effort === effort) === true
}

function degradedEffort(
  capabilities: ProviderModelCapabilities | null,
  requested: string,
): string | undefined {
  const degraded = EFFORT_DEGRADES[requested]
  if (!degraded) return undefined
  if (!advertises(capabilities, degraded)) return undefined

  return degraded
}

/** The only door to `Options.effort`: anything outside the union is dropped. */
function sdkEffortPlan(effort: string | undefined): ClaudeEffortPlan {
  if (!effort) return {}
  if (!SDK_EFFORT_LEVELS.includes(effort)) return {}

  return { effort: effort as ClaudeEffortLevel }
}
