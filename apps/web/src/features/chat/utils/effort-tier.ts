import type { ModelSelection, ProviderOptionDescriptor } from '@workspace/contracts'

import { effectiveOptionValue, promptEffortState } from '@/features/chat/utils/model-options'

/** Evenly spaced stops for the seven rainbow hues, coloured by `rainbow-hue`. */
export const RAINBOW_STOP_OFFSETS = Array.from({ length: 7 }, (_, index) => index / 6)

/** Ultra levels wear the rainbow; max only gets the smaller burst. */
export type EffortTier = 'max' | 'ultra'

export function effortTier(value: string): EffortTier | null {
  if (value === 'ultracode' || value === 'ultrathink') return 'ultra'
  if (value === 'max') return 'max'

  return null
}

/** The effective effort's tier, or ultra while the prompt says ultrathink. */
export function composerEffortTier(
  descriptors: readonly ProviderOptionDescriptor[],
  selection: ModelSelection,
  prompt: string,
) {
  const effort = promptEffortState(descriptors, prompt)
  if (effort.controlled) return 'ultra'
  const primary = descriptors.find((descriptor) => descriptor.id === effort.descriptorId)
  if (!primary) return null

  return effortTier(String(effectiveOptionValue(primary, selection) ?? ''))
}

/** Offsets of every whole-word "ultrathink", the same match `promptEffortState` uses. */
export function ultrathinkMatches(text: string) {
  return [...text.matchAll(/\bultrathink\b/gi)].map((match) => match.index)
}
