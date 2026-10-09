import type { LogDashboardBreakdownItem } from '@workspace/contracts'

export function logBreakdownOptionValues(
  items: readonly LogDashboardBreakdownItem[],
  selected: string,
) {
  const values = items.map((item) => item.value)
  if (selected === 'all') return values
  if (values.includes(selected)) return values

  return [selected].concat(values)
}
