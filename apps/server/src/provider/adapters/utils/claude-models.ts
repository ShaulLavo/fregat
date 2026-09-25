import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type {
  ProviderModel,
  ProviderModelCapabilities,
  ProviderOptionDescriptor,
} from '@workspace/contracts'

/** The product's default for a new chat, when the CLI still lists it. */
export const DEFAULT_CLAUDE_MODEL = 'claude-fable-5-1'
export const ONE_MILLION_CONTEXT_SUFFIX = '[1m]'

/** The CLI row that names its own recommendation; it is not a model of its own. */
const CLI_DEFAULT_ROW = 'default'

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultracode: 'Ultracode',
  ultrathink: 'Ultrathink',
}

const EFFORT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  ultracode: 'Extra high effort plus multi-agent workflow orchestration',
  ultrathink: 'Starts your prompt with “Ultrathink:”',
}

type ClaudeModelOverlay = {
  /** The CLI picks its own default effort and never reports it. */
  defaultEffort?: string
  /** Sonnet takes a `[1m]` suffix though the CLI lists no `[1m]` row for it. */
  defaultContextWindow?: '200k'
  /** Ultracode is a settings flag, not an effort level the CLI lists. */
  ultracode?: boolean
  /** Haiku has no effort levels; `alwaysThinkingEnabled` is its only reasoning switch. */
  thinking?: boolean
}

// Keyed by slug first, then by family. Only what `ModelInfo` cannot say lives here.
const MODEL_OVERLAYS: Readonly<Record<string, ClaudeModelOverlay>> = {
  // T3's opus-5-5 profile defaults to medium, unlike the rest of the family.
  'claude-opus-5-5': { defaultEffort: 'medium' },
  fable: { defaultEffort: 'medium', ultracode: true },
  opus: { defaultEffort: 'high', ultracode: true },
  sonnet: { defaultEffort: 'high', defaultContextWindow: '200k' },
  haiku: { thinking: true },
}

// Retired models the CLI no longer lists but still accepts by id. Grows only when one retires.
const LEGACY_ROWS: readonly ModelInfo[] = [
  legacyRow('claude-opus-5[1m]', { supportsFastMode: true }),
  legacyRow('claude-fable-5[1m]', {}),
]

export type ClaudeCatalog = {
  /** The model a selection without one runs; always listed as current. */
  defaultModel: string
  /** True when `DEFAULT_CLAUDE_MODEL` was not listed and the CLI's own default stood in. */
  defaultFallback: boolean
  models: ProviderModel[]
}

type MergedRow = {
  effortLevels: string[]
  fastMode: boolean
  oneMillion: boolean
  slug: string
}

/**
 * Maps the CLI's `supportedModels()` rows onto provider models. Aliases resolve
 * to concrete slugs, `[1m]` rows fold into a context-window option, and retired
 * models the CLI dropped follow as `legacy`.
 */
export function claudeCatalog(rows: readonly ModelInfo[]): ClaudeCatalog {
  const current = mergeRows(rows.filter((row) => row.value !== CLI_DEFAULT_ROW))
  // A CLI that listed nothing proves nothing; the registry keeps the last good list.
  if (current.length === 0)
    return { defaultModel: DEFAULT_CLAUDE_MODEL, defaultFallback: false, models: [] }

  const listed = new Set(current.map((row) => row.slug))
  const legacy = mergeRows(LEGACY_ROWS).filter((row) => !listed.has(row.slug))
  const cliDefault = rows.find((row) => row.value === CLI_DEFAULT_ROW)
  const defaultModel = catalogDefault(listed, cliDefault)
  const ordered = [
    ...current.filter((row) => row.slug === defaultModel),
    ...current.filter((row) => row.slug !== defaultModel),
  ]

  return {
    defaultModel,
    defaultFallback: defaultModel !== DEFAULT_CLAUDE_MODEL,
    models: [
      ...ordered.map((row) => providerModel(row, 'current')),
      ...legacy.map((row) => providerModel(row, 'legacy')),
    ],
  }
}

export function claudeModelCapabilities(
  models: readonly ProviderModel[],
  model: string,
): ProviderModelCapabilities | null {
  const slug = claudeSlug(model)
  return models.find((entry) => entry.slug === slug)?.capabilities ?? null
}

/** `claude-haiku-4-5-20251001[1m]` → `claude-haiku-4-5`: the id without its window or date. */
export function claudeSlug(model: string) {
  return model
    .trim()
    .replace(/\[1m\]$/i, '')
    .replace(/-\d{8}$/, '')
}

/** `claude-opus-5-5` → `Claude Opus 5.5`; the CLI's `displayName` is only `Opus`. */
export function claudeModelName(slug: string) {
  const groups: string[] = []
  let numbers: string[] = []
  for (const token of slug.split('-')) {
    if (/^\d+$/.test(token)) {
      numbers.push(token)
      continue
    }
    if (numbers.length > 0) groups.push(numbers.join('.'))
    numbers = []
    groups.push(token.charAt(0).toUpperCase() + token.slice(1))
  }
  if (numbers.length > 0) groups.push(numbers.join('.'))

  return groups.join(' ')
}

function catalogDefault(listed: ReadonlySet<string>, cliDefault: ModelInfo | undefined) {
  if (listed.has(DEFAULT_CLAUDE_MODEL)) return DEFAULT_CLAUDE_MODEL
  if (!cliDefault) return DEFAULT_CLAUDE_MODEL

  return claudeSlug(cliDefault.resolvedModel ?? cliDefault.value)
}

function mergeRows(rows: readonly ModelInfo[]): MergedRow[] {
  const merged = new Map<string, MergedRow>()
  for (const row of rows) {
    const concrete = row.resolvedModel ?? row.value
    const slug = claudeSlug(concrete)
    const entry = merged.get(slug) ?? { effortLevels: [], fastMode: false, oneMillion: false, slug }
    for (const level of row.supportedEffortLevels ?? []) {
      if (!entry.effortLevels.includes(level)) entry.effortLevels.push(level)
    }
    entry.fastMode ||= row.supportsFastMode === true
    entry.oneMillion ||= isOneMillion(row.value) || isOneMillion(concrete)
    merged.set(slug, entry)
  }

  return [...merged.values()]
}

function isOneMillion(model: string) {
  return model.toLowerCase().endsWith(ONE_MILLION_CONTEXT_SUFFIX)
}

function providerModel(row: MergedRow, status: 'current' | 'legacy'): ProviderModel {
  const name = claudeModelName(row.slug)

  return {
    slug: row.slug,
    name,
    shortName: name.replace(/^Claude /, ''),
    isCustom: false,
    status,
    capabilities: { optionDescriptors: optionDescriptors(row, modelOverlay(row.slug)) },
  }
}

function modelOverlay(slug: string): ClaudeModelOverlay {
  const family = slug.replace(/^claude-/, '').split('-')[0] ?? ''

  return { ...MODEL_OVERLAYS[family], ...MODEL_OVERLAYS[slug] }
}

function optionDescriptors(row: MergedRow, overlay: ClaudeModelOverlay) {
  const descriptors: ProviderOptionDescriptor[] = []
  if (row.effortLevels.length > 0) descriptors.push(effortDescriptor(row.effortLevels, overlay))
  if (overlay.thinking) descriptors.push({ id: 'thinking', label: 'Thinking', type: 'boolean' })
  if (row.fastMode) descriptors.push({ id: 'fastMode', label: 'Fast mode', type: 'boolean' })
  const contextWindow = row.oneMillion ? '1m' : overlay.defaultContextWindow
  if (contextWindow) descriptors.push(contextDescriptor(contextWindow))

  return descriptors
}

function effortDescriptor(
  levels: readonly string[],
  overlay: ClaudeModelOverlay,
): ProviderOptionDescriptor {
  const ids = [...levels, ...(overlay.ultracode ? ['ultracode'] : []), 'ultrathink']

  return {
    id: 'effort',
    label: 'Reasoning',
    type: 'select',
    options: ids.map((id) => ({
      id,
      label: EFFORT_LABELS[id] ?? id,
      ...(id === overlay.defaultEffort ? { isDefault: true } : {}),
      ...(EFFORT_DESCRIPTIONS[id] ? { description: EFFORT_DESCRIPTIONS[id] } : {}),
    })),
    promptInjectedValues: ['ultrathink'],
  }
}

function contextDescriptor(defaultContext: string): ProviderOptionDescriptor {
  return {
    id: 'contextWindow',
    label: 'Context window',
    type: 'select',
    options: ['200k', '1m'].map((id) => ({
      id,
      label: id === '1m' ? '1M' : id,
      ...(id === defaultContext ? { isDefault: true } : {}),
    })),
  }
}

function legacyRow(value: string, flags: Pick<ModelInfo, 'supportsFastMode'>): ModelInfo {
  return {
    value,
    displayName: value,
    description: '',
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    ...flags,
  }
}
