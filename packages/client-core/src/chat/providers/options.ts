import type {
  ModelSelection,
  ModelSelectionOptions,
  ProviderModel,
  ProviderOptionDescriptor,
} from '@workspace/contracts'

export type ModelEffortLevel = {
  readonly description: string | null
  readonly effort: string
  readonly label: string
}

export function modelOptionDescriptors(
  model: Pick<ProviderModel, 'capabilities'>,
): readonly ProviderOptionDescriptor[] {
  return model.capabilities?.optionDescriptors ?? []
}

export function modelEffortDescriptor(descriptors: readonly ProviderOptionDescriptor[]) {
  return descriptors.find(
    (descriptor) =>
      descriptor.type === 'select' &&
      (descriptor.id === 'reasoningEffort' || descriptor.id === 'effort'),
  )
}

export function modelEffortLevels(model: Pick<ProviderModel, 'capabilities'>): ModelEffortLevel[] {
  const descriptor = modelEffortDescriptor(modelOptionDescriptors(model))
  if (descriptor?.type !== 'select') return []
  return descriptor.options.map((choice) => ({
    description: choice.description ?? null,
    effort: choice.id,
    label: choice.label,
  }))
}

export function modelDefaultEffort(model: Pick<ProviderModel, 'capabilities'>): string | null {
  const descriptor = modelEffortDescriptor(modelOptionDescriptors(model))
  if (!descriptor) return null
  const value = modelOptionDefaultValue(descriptor)
  return typeof value === 'string' ? value : null
}

export function modelSelectionEffort(selection: ModelSelection | null | undefined): string | null {
  return selection?.options?.reasoningEffort ?? selection?.options?.effort ?? null
}

export function modelOptionDefaultValue(descriptor: ProviderOptionDescriptor) {
  return reconciledValue(undefined, descriptor)
}

export function modelSelectionOptionValue(
  selection: ModelSelection | null | undefined,
  descriptor: ProviderOptionDescriptor,
): string | boolean | null {
  const stored = selection?.options?.[descriptor.id]
  if (stored === undefined) return null
  return reconciledValue(stored, descriptor)
}

export function withModelOption(
  selection: ModelSelection,
  descriptor: ProviderOptionDescriptor,
  value: string | boolean | null,
): ModelSelection {
  const options = { ...selection.options }
  delete options[descriptor.id]
  if (value !== null) options[descriptor.id] = value
  return selectionWithOptions(selection, options)
}

export function reconcileModelOptions(
  previous: ModelSelection | null,
  next: ModelSelection,
  descriptors: readonly ProviderOptionDescriptor[],
): ModelSelection {
  const options: ModelSelectionOptions = {}
  for (const descriptor of descriptors) {
    if (previous?.options?.[descriptor.id] === undefined) continue
    const value = reconciledValue(previous.options[descriptor.id], descriptor)
    if (value !== null) options[descriptor.id] = value
  }
  return selectionWithOptions(next, options)
}

function reconciledValue(value: unknown, descriptor: ProviderOptionDescriptor) {
  if (descriptor.type === 'boolean')
    return typeof value === 'boolean' ? value : (descriptor.currentValue ?? null)
  const raw = typeof value === 'string' ? value : descriptor.currentValue
  const trimmed = raw?.trim()
  const fallback =
    descriptor.currentValue ?? descriptor.options.find((choice) => choice.isDefault)?.id ?? null
  if (!trimmed) return fallback
  if (descriptor.options.length === 0) return trimmed
  if (!descriptor.options.some((choice) => choice.id === trimmed)) return fallback
  return trimmed
}

function selectionWithOptions(selection: ModelSelection, options: ModelSelectionOptions) {
  const base = { model: selection.model, providerInstanceId: selection.providerInstanceId }
  return Object.keys(options).length ? { ...base, options } : base
}
