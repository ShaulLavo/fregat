import type {
  ProviderModel,
  ProviderModelCapabilities,
  ProviderOptionDescriptor,
} from '@workspace/contracts'

export const DEFAULT_CLAUDE_MODEL = 'claude-fable-5-1'
export const ONE_MILLION_CONTEXT_SUFFIX = '[1m]'

const effortLabels: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
  ultracode: 'Ultracode',
  ultrathink: 'Ultrathink',
}

// Profiles match the pinned T3 manifest. CLI version probing remains separate.
const CLAUDE_MODELS: ProviderModel[] = [
  model(DEFAULT_CLAUDE_MODEL, 'Claude Fable 5.1', [
    effortDescriptor('medium', true),
    contextDescriptor('1m'),
  ]),
  model('claude-fable-5', 'Claude Fable 5', [
    effortDescriptor('medium', true),
    contextDescriptor('1m'),
  ]),
  model('claude-opus-5', 'Claude Opus 5', [
    effortDescriptor('high', true),
    { id: 'fastMode', label: 'Fast Mode', type: 'boolean' },
    contextDescriptor('1m'),
  ]),
  model('claude-sonnet-5', 'Claude Sonnet 5', [
    effortDescriptor('high', false),
    contextDescriptor('200k'),
  ]),
  model('claude-haiku-4-5', 'Claude Haiku 4.5', [
    { id: 'thinking', label: 'Thinking', type: 'boolean' },
  ]),
]

export function claudeModelCatalog(): ProviderModel[] {
  return CLAUDE_MODELS
}

export function claudeModelCapabilities(model: string): ProviderModelCapabilities | null {
  const slug = model.trim().replace(/\[1m\]$/, '')
  return CLAUDE_MODELS.find((entry) => entry.slug === slug)?.capabilities ?? null
}

function model(
  slug: string,
  name: string,
  optionDescriptors: ProviderOptionDescriptor[],
): ProviderModel {
  return {
    slug,
    name,
    shortName: name.replace(/^Claude /, ''),
    isCustom: false,
    capabilities: { optionDescriptors },
  }
}

function effortDescriptor(defaultEffort: string, ultracode: boolean): ProviderOptionDescriptor {
  const ids = [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    ...(ultracode ? ['ultracode'] : []),
    'ultrathink',
  ]
  return {
    id: 'effort',
    label: 'Reasoning',
    type: 'select',
    options: ids.map((id) => ({
      id,
      label: effortLabels[id] ?? id,
      ...(id === defaultEffort ? { isDefault: true } : {}),
      ...(id === 'ultracode'
        ? { description: 'xhigh effort plus multi-agent workflow orchestration' }
        : {}),
    })),
    promptInjectedValues: ['ultrathink'],
  }
}

function contextDescriptor(defaultContext: string): ProviderOptionDescriptor {
  return {
    id: 'contextWindow',
    label: 'Context Window',
    type: 'select',
    options: ['200k', '1m'].map((id) => ({
      id,
      label: id === '1m' ? '1M' : id,
      ...(id === defaultContext ? { isDefault: true } : {}),
    })),
  }
}
