import type { LogDashboardFilters, SettingsValues } from '@workspace/contracts'
const rangeMinutes = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 }
export function logFilters(
  search: string,
  range: SettingsValues['logs.defaultTimeRange'],
  slowMs: number,
): LogDashboardFilters {
  return {
    search,
    slowMs,
    since:
      range === 'all'
        ? undefined
        : new Date(Date.now() - rangeMinutes[range] * 60000).toISOString(),
  }
}
