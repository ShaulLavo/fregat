/** Category fills for the context bar, reused in order: the theme's chart tokens. */
const SEGMENT_FILLS = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
] as const

export function contextSegmentFill(index: number) {
  return SEGMENT_FILLS[index % SEGMENT_FILLS.length]
}
