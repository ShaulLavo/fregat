export function turnStatusLabel({
  summary,
  expanded,
  hiddenCount,
  foldable,
}: {
  summary: string | null
  expanded: boolean
  hiddenCount: number
  foldable: boolean
}) {
  if (!foldable) return summary ?? 'Response'
  if (expanded) return `${summary ?? 'Worked'} · Hide steps`

  return `${summary ?? 'Worked'} · ${hiddenCount} ${hiddenCount === 1 ? 'step' : 'steps'}`
}
