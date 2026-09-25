import type { ModelSelection, ProviderOptionDescriptor } from '@workspace/contracts'

import { effectiveOptionValue, promptEffortState } from '@/features/chat/utils/model-options'

export type EffortSparkleLevel = 'max' | 'xhigh'

type SparkleCell = { delay: number; left: number; top: number }

/** How many cells twinkle per level; Neon's densities .14 and .20 over the same field. */
const CELL_COUNT: Record<EffortSparkleLevel, number> = { max: 24, xhigh: 17 }

/** Fixed positions and phases from a hash of the index, so every render agrees. */
export const SPARKLE_CELLS: readonly SparkleCell[] = Array.from(
  { length: CELL_COUNT.max },
  (_, i) => ({
    delay: fraction(i, 3.1),
    left: fraction(i, 1.7) * 100,
    top: fraction(i, 2.3) * 100,
  }),
)

export function sparkleCells(level: EffortSparkleLevel) {
  return SPARKLE_CELLS.slice(0, CELL_COUNT[level])
}

/** Only the highest efforts sparkle. */
export function effortSparkleLevel(value: string): EffortSparkleLevel | null {
  if (value === 'xhigh') return 'xhigh'
  if (value === 'max' || value === 'ultracode' || value === 'ultrathink') return 'max'

  return null
}

/** The trigger's level: the effective effort, or max while the prompt says ultrathink. */
export function triggerSparkleLevel(
  descriptors: readonly ProviderOptionDescriptor[],
  selection: ModelSelection,
  prompt: string,
) {
  const effort = promptEffortState(descriptors, prompt)
  if (effort.controlled) return 'max'
  const primary = descriptors.find((descriptor) => descriptor.id === effort.descriptorId)
  if (!primary) return null

  return effortSparkleLevel(String(effectiveOptionValue(primary, selection) ?? ''))
}

/** Offsets of every whole-word "ultrathink", the same match `promptEffortState` uses. */
export function ultrathinkMatches(text: string) {
  return [...text.matchAll(/\bultrathink\b/gi)].map((match) => match.index)
}

function fraction(index: number, seed: number) {
  const value = Math.sin((index + 1) * 12.9898 * seed) * 43_758.5453
  return value - Math.floor(value)
}
