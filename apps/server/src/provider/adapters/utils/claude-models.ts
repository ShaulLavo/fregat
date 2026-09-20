import type { ProviderModel, ProviderModelCapabilities } from '@workspace/contracts'

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5'

/**
 * The 1M context window is selected by suffixing the model slug, not by a
 * separate option field. Omitting it silently caps the request at 200k with no
 * error from the API, so it is spelled out here and covered by a test.
 */
export const ONE_MILLION_CONTEXT_SUFFIX = '[1m]'

/**
 * Hardcoded catalog, deliberately. The agent SDK's init handshake does return a
 * model list, but reading it would make the picker's contents depend on a live
 * probe succeeding; Codex pages `model/list` because its protocol has one, and
 * Claude's does not. The cost is a code change per model release.
 *
 * The `[1m]` row is not a separate SDK field: the 1M context window is selected
 * by SUFFIXING the model slug. Exposing it as its own catalog entry is what
 * makes that path reachable from the UI at all — omitting it silently caps every
 * request at 200k with no error.
 */
const ONE_MILLION_CONTEXT_MODEL = `${DEFAULT_CLAUDE_MODEL}${ONE_MILLION_CONTEXT_SUFFIX}`

/**
 * Copy for the levels, keyed by the id we advertise. `low`..`max` are the SDK's
 * own `EffortLevel` union; `ultracode` and `ultrathink` are Claude Code levels
 * that are NEVER sent as `Options.effort` — see claude-reasoning.ts, which maps
 * `ultracode` to xhigh + a session setting and `ultrathink` to a prompt prefix.
 */
const EFFORT_DESCRIPTIONS = {
  low: 'Minimal thinking, fastest responses',
  medium: 'Moderate thinking',
  high: 'Deep reasoning',
  xhigh: 'Deeper than high',
  max: 'Maximum effort',
  ultracode: 'Extra high effort plus standing dynamic-workflow orchestration',
  ultrathink: 'Prompt keyword — prefixes the turn instead of setting a level',
} as const

type ClaudeEffortId = keyof typeof EFFORT_DESCRIPTIONS

function reasoningEfforts(efforts: readonly ClaudeEffortId[]) {
  return efforts.map((effort) => ({ description: EFFORT_DESCRIPTIONS[effort], effort }))
}

/**
 * MINIMUM CLI VERSIONS, unenforced on purpose — noted so nobody reads this
 * catalog as a promise about the local binary:
 *   claude-opus-5 >= 2.1.219, claude-fable-5 >= 2.1.169.
 * `xhigh` needs a Fable 5 / Opus 4.7+ / Sonnet 5 class model (every row here
 * qualifies), and `ultracode` additionally needs workflows enabled plus an
 * xhigh-capable model, which only the CLI can decide at runtime.
 *
 * We cannot filter on any of it today: `snapshot()` reports `version: null`
 * because the agent SDK's init handshake carries no CLI version, so there is
 * nothing to compare against. The reference gates its catalog on a version
 * parsed from `claude --version`; wiring that probe is the prerequisite for
 * doing the same here.
 */
const CLAUDE_MODELS: ProviderModel[] = [
  {
    capabilities: opusCapabilities(),
    isCustom: false,
    name: 'Claude Opus 5',
    shortName: 'Opus 5',
    slug: DEFAULT_CLAUDE_MODEL,
  },
  {
    capabilities: opusCapabilities(),
    isCustom: false,
    name: 'Claude Opus 5 (1M context)',
    shortName: 'Opus 5 1M',
    slug: ONE_MILLION_CONTEXT_MODEL,
  },
  {
    // Sonnet is the one row without `ultracode`: the CLI setting requires an
    // xhigh-capable model AND workflows, and the reference offers it on the
    // Opus/Fable rows only.
    capabilities: {
      defaultReasoningEffort: 'high',
      reasoningEfforts: reasoningEfforts(['low', 'medium', 'high', 'xhigh', 'max', 'ultrathink']),
      supportsExtendedThinking: true,
    },
    isCustom: false,
    name: 'Claude Sonnet 5',
    shortName: 'Sonnet 5',
    slug: 'claude-sonnet-5',
  },
  {
    capabilities: opusCapabilities(),
    isCustom: false,
    name: 'Claude Fable 5',
    shortName: 'Fable 5',
    slug: 'claude-fable-5',
  },
  {
    // No effort ladder advertised: Haiku 4.5 predates it, and null sends no `effort` at all.
    capabilities: null,
    isCustom: false,
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    slug: 'claude-haiku-4-5-20251001',
  },
]

export function claudeModelCatalog(): ProviderModel[] {
  return CLAUDE_MODELS
}

/**
 * Capabilities for a slug, or null when we know nothing about it — a custom or
 * newer model. Null is load-bearing: it advertises no level, so no `effort` is
 * ever sent for that model rather than a guess the CLI would reject.
 *
 * The `[1m]` variant is the same model with a wider window, so a selection that
 * carries the suffix resolves to the base row's capabilities.
 */
export function claudeModelCapabilities(model: string): ProviderModelCapabilities | null {
  const slug = model.trim()
  const match = CLAUDE_MODELS.find((entry) => entry.slug === slug)
  if (match) return match.capabilities ?? null
  if (!slug.endsWith(ONE_MILLION_CONTEXT_SUFFIX)) return null

  return claudeModelCapabilities(slug.slice(0, -ONE_MILLION_CONTEXT_SUFFIX.length))
}

/**
 * Opus 5, its 1M twin, and Fable 5 share one ladder. Built per row rather than
 * shared by reference so a caller mutating one row cannot reach the others.
 */
function opusCapabilities(): ProviderModelCapabilities {
  return {
    defaultReasoningEffort: 'high',
    reasoningEfforts: reasoningEfforts([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultracode',
      'ultrathink',
    ]),
    // Every current Claude model thinks adaptively; the SDK calls this
    // `supportsAdaptiveThinking` on its own `ModelInfo`. Effort is the primary
    // dial — the explicit `thinking` option only overrides it.
    supportsExtendedThinking: true,
  }
}
