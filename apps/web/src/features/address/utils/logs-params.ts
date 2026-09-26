import { LOG_TIME_RANGES, LOG_DASHBOARD_LEVELS } from '@workspace/contracts'
import type { LogsFilterState } from '@workspace/client-core/logs/filters'

/**
 * `log.*` — the dashboard's filters.
 *
 * Only values that differ from the default are emitted, so an untouched panel adds
 * nothing to the URL and a shared link says exactly what the sender changed.
 */
export function logsParamsFor(filters: LogsFilterState, defaults: LogsFilterState) {
  const params: Record<string, string> = {}

  if (filters.level !== defaults.level) params.level = filters.level
  if (filters.area !== defaults.area) params.area = filters.area
  if (filters.source !== defaults.source) params.src = filters.source
  if (filters.search !== defaults.search) params.find = filters.search
  if (filters.slowMs !== defaults.slowMs) params.slow = String(filters.slowMs)
  if (filters.timeRange !== defaults.timeRange) params.since = filters.timeRange

  return Object.keys(params).length > 0 ? params : null
}

const LEVELS = ['all', ...LOG_DASHBOARD_LEVELS] as const

export function logsFiltersFor(
  params: Readonly<Record<string, string>> | null,
  defaults: LogsFilterState,
): LogsFilterState | null {
  if (!params) return null

  // `Number('')` is `0`, not `NaN`, so a bare `?log.slow=` would otherwise read as a
  // real zero threshold and silently show every event as slow.
  const slowMs = params.slow ? Number(params.slow) : Number.NaN

  return {
    area: params.area ?? defaults.area,
    level: LEVELS.find((level) => level === params.level) ?? defaults.level,
    search: params.find ?? defaults.search,
    slowMs: Number.isFinite(slowMs) && slowMs >= 0 ? slowMs : defaults.slowMs,
    source: params.src ?? defaults.source,
    timeRange: LOG_TIME_RANGES.find((range) => range === params.since) ?? defaults.timeRange,
  }
}
