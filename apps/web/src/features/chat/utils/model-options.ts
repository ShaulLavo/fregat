import type { ModelSelection, ProviderOptionDescriptor } from '@workspace/contracts'
import {
  modelOptionDefaultValue,
  modelSelectionOptionValue,
} from '@workspace/client-core/chat/providers/options'

export const PROVIDER_DEFAULT_VALUE = ''

/** What the trigger says: chosen values first, the model's own defaults after. */
export function descriptorSummary(
  descriptors: readonly ProviderOptionDescriptor[],
  selection: ModelSelection,
  prompt = '',
) {
  const effort = promptEffortState(descriptors, prompt)
  const labels = descriptors
    .map((descriptor) => {
      if (effort.controlled && descriptor.id === effort.descriptorId) return 'Ultrathink'
      return activeChoiceLabel(descriptor, selection)
    })
    .filter((label): label is string => label !== null)
  if (labels.length === 0) return 'Options'

  return labels.join(' · ')
}

function activeChoiceLabel(descriptor: ProviderOptionDescriptor, selection: ModelSelection) {
  const value =
    modelSelectionOptionValue(selection, descriptor) ?? modelOptionDefaultValue(descriptor)
  if (value === null) return null

  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return descriptorChoices(descriptor).find((choice) => choice.id === value)?.label ?? null
}

export function defaultChoiceLabel(descriptor: ProviderOptionDescriptor) {
  const value = modelOptionDefaultValue(descriptor)
  if (typeof value === 'boolean') return `Provider default (${value ? 'On' : 'Off'})`
  const fallback = descriptorChoices(descriptor).find((choice) => choice.id === value)
  return fallback ? `Provider default (${fallback.label})` : 'Provider default'
}

export function radioValue(value: string | boolean | null) {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return value ?? PROVIDER_DEFAULT_VALUE
}

export function descriptorChoices(
  descriptor: ProviderOptionDescriptor,
): readonly { id: string; label: string; description?: string }[] {
  if (descriptor.type === 'select') return descriptor.options
  return [
    { id: 'on', label: 'On' },
    { id: 'off', label: 'Off' },
  ]
}

export function promptEffortState(
  descriptors: readonly ProviderOptionDescriptor[],
  prompt: string,
) {
  const primary = descriptors.find((descriptor) => descriptor.type === 'select')
  const controlled =
    Boolean(primary?.promptInjectedValues?.length) && /\bultrathink\b/i.test(prompt)
  return {
    descriptorId: primary?.id,
    controlled,
    inBody: controlled && /\bultrathink\b/i.test(withoutUltrathinkPrefix(prompt)),
  }
}

export function withoutUltrathinkPrefix(prompt: string) {
  return prompt.replace(/^Ultrathink:\s*/i, '')
}

export function withUltrathinkPrefix(prompt: string) {
  const trimmed = prompt.trim()
  if (!trimmed) return 'Ultrathink:\n'
  if (/^\/[^\s/]+(?:\s|$)/u.test(trimmed) || trimmed.startsWith('Ultrathink:')) return trimmed
  return `Ultrathink:\n${trimmed}`
}
