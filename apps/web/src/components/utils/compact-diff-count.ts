/** Scaled units, largest first, so the first match is the right magnitude. */
const COMPACT_DIFF_UNITS = [
  { suffix: 'b', threshold: 1_000_000_000 },
  { suffix: 'm', threshold: 1_000_000 },
  { suffix: 'k', threshold: 1_000 },
] as const

/**
 * Diff counts share a row with the file name, so a five-digit count pushes the
 * name off the edge. Two significant digits is all a reader takes from it — the
 * exact number stays in the accessible name.
 */
export function formatCompactDiffCount(value: number): string {
  if (!Number.isFinite(value)) return '0'

  const rounded = Math.max(0, Math.round(value))
  for (const unit of COMPACT_DIFF_UNITS) {
    if (rounded < unit.threshold) continue

    return `${formatScaledCount(rounded / unit.threshold)}${unit.suffix}`
  }

  return String(rounded)
}

function formatScaledCount(scaled: number): string {
  if (scaled >= 10) return String(Math.round(scaled))

  return String(Number(scaled.toFixed(1)))
}
