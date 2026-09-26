import type {
  ProviderModelCapabilities,
  ProviderOptionChoice,
  ProviderOptionDescriptor,
} from '@workspace/contracts'
import type { CodexModel } from '../codex-protocol'

const effortLabels: Readonly<Record<string, string>> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
}

export function codexModelCapabilities(model: CodexModel): ProviderModelCapabilities | null {
  const optionDescriptors: ProviderOptionDescriptor[] = []
  const family = model.model.replace(/^openai\./, '')
  const defaultEffort = family === 'gpt-6-astra' ? 'medium' : model.defaultReasoningEffort.trim()
  const efforts = model.supportedReasoningEfforts.flatMap((option) => {
    const id = option.reasoningEffort.trim()
    if (!id) return []

    const description = option.description.trim()
    return [
      {
        id,
        label: effortLabels[id] ?? id,
        ...(description ? { description } : {}),
        ...(id === defaultEffort ? { isDefault: true } : {}),
      },
    ]
  })
  if (efforts.length > 0) {
    optionDescriptors.push({
      id: 'reasoningEffort',
      label: 'Reasoning',
      type: 'select',
      options: efforts,
      ...(efforts.some((option) => option.isDefault) ? { currentValue: defaultEffort } : {}),
    })
  }
  const tiers = serviceTierChoices(model)
  if (tiers.length > 0) optionDescriptors.push(serviceTierDescriptor(model, tiers))

  return optionDescriptors.length > 0 ? { optionDescriptors } : null
}

function serviceTierChoices(model: CodexModel): ProviderOptionChoice[] {
  const tiers = (model.serviceTiers ?? []).flatMap((tier) => {
    const id = tier.id.trim()
    const label = tier.name.trim()
    if (!id || !label) return []

    const description = tier.description.trim()
    return [{ id, label, ...(description ? { description } : {}) }]
  })
  if (tiers.length > 0) return tiers

  return (model.additionalSpeedTiers ?? []).flatMap((tier) => {
    const id = tier.trim()
    return id ? [{ id, label: id === 'fast' ? 'Fast' : id }] : []
  })
}

function serviceTierDescriptor(
  model: CodexModel,
  tiers: ProviderOptionChoice[],
): ProviderOptionDescriptor {
  const advertisedDefault =
    typeof model.defaultServiceTier === 'string' ? model.defaultServiceTier : undefined
  const defaultTier =
    advertisedDefault && tiers.some((tier) => tier.id === advertisedDefault)
      ? advertisedDefault
      : 'default'
  const options = [{ id: 'default', label: 'Standard' }, ...tiers].map((tier) => ({
    ...tier,
    ...(tier.id === defaultTier ? { isDefault: true } : {}),
  }))
  return {
    id: 'serviceTier',
    label: 'Service tier',
    type: 'select',
    options,
    currentValue: defaultTier,
  }
}
