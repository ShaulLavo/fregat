import type { LogDashboardFilters, LogTimeRange } from '@workspace/contracts'
import { logFilterQuery, sinceForRange } from '@workspace/client-core/logs/filters'

export function logFilters(
  search: string,
  range: LogTimeRange,
  slowMs: number,
  now = Date.now(),
): LogDashboardFilters {
  return logFilterQuery({ search, slowMs, since: sinceForRange(range, now) })
}
