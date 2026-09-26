/** Category fills for data marks, reused in order: the theme's chart tokens. */
const CHART_FILLS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const

export function chartFill(index: number) {
  return CHART_FILLS[index % CHART_FILLS.length]
}
