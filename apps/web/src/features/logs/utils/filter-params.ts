import type { LogsFilterState } from '@workspace/client-core/logs/filters'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'

/**
 * A function, not a constant: the settings mirror is read per call, so a change
 * to the log defaults applies to the next panel that opens. As a module-level
 * const it would be evaluated once at import and never move again.
 */
export function defaultLogsFilterState(): LogsFilterState {
  const settings = readSettingsMirror()

  return {
    area: 'all',
    level: 'all',
    search: '',
    slowMs: settings['logs.slowThresholdMs'],
    source: 'all',
    timeRange: settings['logs.defaultTimeRange'],
  }
}

/** Identity of the filter set, so a changed filter resets inspection and scroll. */
export function logsFilterIdentity(filters: LogsFilterState) {
  return JSON.stringify([
    filters.area,
    filters.level,
    filters.search,
    filters.slowMs,
    filters.source,
    filters.timeRange,
  ])
}
