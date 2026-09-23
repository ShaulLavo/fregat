import type {
  ModelSelection,
  ProviderModelCapabilities,
  ProviderOptionDescriptor,
} from '@workspace/contracts'

export type ModelOptions = ModelSelection['options']

export function modelOptionValue(options: ModelOptions, key: string): unknown {
  return options?.[key]
}

export function modelOptionDescriptor(
  capabilities: ProviderModelCapabilities | null,
  id: string,
): ProviderOptionDescriptor | undefined {
  return capabilities?.optionDescriptors?.find((descriptor) => descriptor.id === id)
}

export function modelSelectValue(
  descriptor: ProviderOptionDescriptor | undefined,
  value: unknown,
): string | undefined {
  if (descriptor?.type !== 'select') return undefined

  const fallback =
    descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id
  const selected = typeof value === 'string' ? value.trim() : ''
  if (!selected) return fallback
  if (descriptor.options.length === 0) return selected
  if (!descriptor.options.some((option) => option.id === selected)) return fallback
  if (descriptor.promptInjectedValues?.includes(selected))
    return descriptor.options.find((option) => option.isDefault)?.id

  return selected
}
