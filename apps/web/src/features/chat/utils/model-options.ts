import type { ModelSelection, ProviderOptionDescriptor } from '@workspace/contracts'
import {
  modelOptionDefaultValue,
  modelSelectionOptionValue,
} from '@workspace/client-core/chat/providers/options'

/** Fast mode shows as a bolt on the trigger, never as text. */
export const FAST_MODE_OPTION_ID = 'fastMode'

/** The stored choice, or the model's default when nothing is stored. */
export function effectiveOptionValue(
  descriptor: ProviderOptionDescriptor,
  selection: ModelSelection,
) {
  return modelSelectionOptionValue(selection, descriptor) ?? modelOptionDefaultValue(descriptor)
}

/** What the trigger says: every select's value, then booleans that are on. */
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
  const fast = descriptors.some(
    (descriptor) =>
      descriptor.id === FAST_MODE_OPTION_ID && effectiveOptionValue(descriptor, selection) === true,
  )

  return { fast, label: labels.join(' · ') || (fast ? 'Fast' : 'Options') }
}

function activeChoiceLabel(descriptor: ProviderOptionDescriptor, selection: ModelSelection) {
  const value = effectiveOptionValue(descriptor, selection)
  if (descriptor.type === 'boolean') {
    if (value !== true || descriptor.id === FAST_MODE_OPTION_ID) return null
    return descriptor.label
  }
  return descriptor.options.find((choice) => choice.id === value)?.label ?? null
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
