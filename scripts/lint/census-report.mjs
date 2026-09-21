/** Shared report formatting for the censuses. A measure is a list of hits, each with a `value`. */

/** Past this a list stops being readable; the count above it is the number that matters. */
const LIST_CAP = 40

export function histogram(hits) {
  const counts = new Map()
  for (const hit of hits) counts.set(hit.value, (counts.get(hit.value) ?? 0) + 1)
  return counts
}

export function formatHistogram(title, hits) {
  const rows = [...histogram(hits)].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )
  if (rows.length === 0) return `${title}\n  (none)`
  const width = Math.max(...rows.map(([value]) => value.length), 'total'.length)
  const body = rows.map(
    ([value, count]) => `  ${value.padEnd(width)}  ${String(count).padStart(6)}`,
  )
  return `${title}\n${body.join('\n')}\n  ${'total'.padEnd(width)}  ${String(hits.length).padStart(6)}`
}

export function formatList(title, hits) {
  if (hits.length === 0) return `${title}: none`
  const shown = hits.slice(0, LIST_CAP).map((hit) => `  ${hit.file}:${hit.line}  ${hit.value}`)
  if (hits.length > LIST_CAP) shown.push(`  … and ${hits.length - LIST_CAP} more`)
  return `${title}: ${hits.length}\n${shown.join('\n')}`
}

export function formatGate(result) {
  const lines = result.allowProblems.map((problem) => `  allow-list  ${problem}`)
  for (const failure of result.failures)
    lines.push(`  ${failure.title}: ${failure.count} over target`)
  if (lines.length === 0) return 'gate: every measure is on target'
  return `gate: ${lines.length} measure(s) off target\n${lines.join('\n')}`
}
