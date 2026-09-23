import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type {
  ModelSelection,
  ProviderInstanceId,
  ProviderModelCapabilities,
} from '@workspace/contracts'
import { claudeModelCapabilities, DEFAULT_CLAUDE_MODEL } from './claude-models'
import {
  modelOptionDescriptor,
  modelOptionValue,
  modelSelectValue,
  type ModelOptions,
} from './model-options'

type ClaudeSettings = Exclude<NonNullable<Options['settings']>, string>
type ClaudeEffortLevel = NonNullable<Options['effort']>

export type ClaudeReasoning = {
  effort?: ClaudeEffortLevel
  promptPrefix?: 'ultrathink'
  settings?: ClaudeSettings
}

export type ClaudeEffortPlan = {
  effort?: ClaudeEffortLevel
  promptPrefix?: 'ultrathink'
  ultracode?: boolean
}

const ULTRATHINK_PROMPT_PREFIX = 'Ultrathink:'

export function claudeReasoning(input: {
  modelSelection: ModelSelection
  providerInstanceId: ProviderInstanceId
}): ClaudeReasoning {
  if (input.modelSelection.providerInstanceId !== input.providerInstanceId) return {}

  const capabilities = claudeModelCapabilities(
    input.modelSelection.model.trim() || DEFAULT_CLAUDE_MODEL,
  )
  const options = input.modelSelection.options
  const requested = modelOptionValue(options, 'effort')
  const plan = effortPlan({
    capabilities,
    requested: typeof requested === 'string' ? requested : undefined,
  })
  const thinking = booleanSelection(options, capabilities, 'thinking')
  const fastMode = booleanSelection(options, capabilities, 'fastMode')

  return {
    ...(plan.effort ? { effort: plan.effort } : {}),
    ...(plan.promptPrefix ? { promptPrefix: plan.promptPrefix } : {}),
    ...reasoningSettings(plan, thinking, fastMode),
  }
}

export function effortPlan(input: {
  capabilities: ProviderModelCapabilities | null
  requested: string | undefined
}): ClaudeEffortPlan {
  const descriptor = modelOptionDescriptor(input.capabilities, 'effort')
  if (descriptor?.type !== 'select') return {}

  const requested = input.requested?.trim()
  const effective = modelSelectValue(descriptor, requested)
  if (requested === 'ultrathink' && descriptor.options.some((option) => option.id === requested)) {
    return { ...sdkEffortPlan(effective), promptPrefix: 'ultrathink' }
  }
  if (effective === 'ultracode') return { effort: 'xhigh', ultracode: true }

  return sdkEffortPlan(effective)
}

export function claudePromptText(messageText: string, reasoning: ClaudeReasoning): string {
  if (reasoning.promptPrefix !== 'ultrathink') return messageText

  const trimmed = messageText.trim()
  if (trimmed.length === 0) return messageText
  if (trimmed.startsWith(ULTRATHINK_PROMPT_PREFIX)) return trimmed

  return `${ULTRATHINK_PROMPT_PREFIX}\n${trimmed}`
}

export function claudeReasoningQueryOptions(
  reasoning: ClaudeReasoning,
): Pick<Options, 'effort' | 'settings'> {
  return {
    ...(reasoning.effort ? { effort: reasoning.effort } : {}),
    ...(reasoning.settings ? { settings: reasoning.settings } : {}),
  }
}

// SDK options are fixed when a query starts; changed options require a new query.
export function claudeReasoningKey(reasoning: ClaudeReasoning): string {
  return JSON.stringify([
    reasoning.effort ?? null,
    reasoning.promptPrefix ?? null,
    reasoning.settings?.ultracode ?? null,
    reasoning.settings?.alwaysThinkingEnabled ?? null,
    reasoning.settings?.fastMode ?? null,
  ])
}

function booleanSelection(
  options: ModelOptions,
  capabilities: ProviderModelCapabilities | null,
  id: string,
): boolean | undefined {
  const descriptor = modelOptionDescriptor(capabilities, id)
  if (descriptor?.type !== 'boolean') return undefined

  const value = modelOptionValue(options, id)
  return typeof value === 'boolean' ? value : descriptor.currentValue
}

function reasoningSettings(
  plan: ClaudeEffortPlan,
  thinking: boolean | undefined,
  fastMode: boolean | undefined,
): Pick<ClaudeReasoning, 'settings'> {
  const settings: ClaudeSettings = {
    ...(thinking === undefined ? {} : { alwaysThinkingEnabled: thinking }),
    ...(plan.ultracode ? { ultracode: true } : {}),
    ...(fastMode ? { fastMode: true } : {}),
  }
  return Object.keys(settings).length > 0 ? { settings } : {}
}

function sdkEffortPlan(effort: string | undefined): ClaudeEffortPlan {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return { effort }
    default:
      return {}
  }
}
