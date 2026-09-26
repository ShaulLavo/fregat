import type { ModelSelection, ProviderOptionDescriptor } from '@workspace/contracts'

import { effectiveOptionValue, promptEffortState } from '@/features/chat/utils/model-options'

/** Evenly spaced stops for the seven rainbow hues, coloured by `rainbow-hue`. */
export const RAINBOW_STOP_OFFSETS = Array.from({ length: 7 }, (_, index) => index / 6)

/** Ultra levels wear the rainbow; max only gets the smaller burst. */
export type EffortTier = 'max' | 'ultra'

/**
 * Anything named ultra is ultra: Codex's `ultra`, Claude's `ultracode` and `ultrathink`.
 * Providers report their own effort ids, so a list would miss the next one.
 */
export function effortTier(value: string): EffortTier | null {
  if (/ultra/i.test(value)) return 'ultra'
  if (value === 'max') return 'max'

  return null
}

/** The effective effort level, or ultrathink while the prompt says it. */
export function composerEffortLevel(
  descriptors: readonly ProviderOptionDescriptor[],
  selection: ModelSelection,
  prompt: string,
) {
  const effort = promptEffortState(descriptors, prompt)
  if (effort.controlled) return 'ultrathink'
  const primary = descriptors.find((descriptor) => descriptor.id === effort.descriptorId)
  if (!primary) return null

  return String(effectiveOptionValue(primary, selection) ?? '')
}

/** The first whole-word "ultrathink", the same match `promptEffortState` uses. */
export function ultrathinkMatch(text: string) {
  const match = /\bultrathink\b/i.exec(text)
  if (!match) return null

  return { end: match.index + match[0].length, start: match.index }
}
