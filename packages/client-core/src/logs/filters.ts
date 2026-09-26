import type { LogDashboardFilters, LogDashboardLevel, LogTimeRange } from '@workspace/contracts'

export type LogsFilterState = {
  area: string
  level: LogDashboardLevel | 'all'
  search: string
  slowMs: number
  source: string
  timeRange: LogTimeRange
}

const rangeMinutes: Record<Exclude<LogTimeRange, 'all'>, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1_440,
}

export function logDashboardFilters(state: LogsFilterState, now = Date.now()): LogDashboardFilters {
  return compactFilters({
    areas: state.area === 'all' ? undefined : [state.area],
    levels: state.level === 'all' ? undefined : [state.level],
    search: trimmedValue(state.search),
    since: sinceForRange(state.timeRange, now),
    slowMs: state.slowMs,
    sources: state.source === 'all' ? undefined : [state.source],
  })
}

export function logFilterQuery(filters: LogDashboardFilters) {
  return {
    areas: nonEmptyArray(filters.areas),
    levels: nonEmptyArray(filters.levels),
    search: trimmedValue(filters.search),
    since: filters.since,
    slowMs: filters.slowMs,
    sources: nonEmptyArray(filters.sources),
    until: filters.until,
  }
}

export function logToolbarOptionFilters(filters: LogDashboardFilters): LogDashboardFilters {
  const { areas: _areas, sources: _sources, ...optionFilters } = filters

  return optionFilters
}

function compactFilters(filters: LogDashboardFilters): LogDashboardFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined))
}

function nonEmptyArray<T>(value: readonly T[] | undefined) {
  return value && value.length > 0 ? Array.from(value) : undefined
}

function trimmedValue(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function sinceForRange(range: LogTimeRange, now: number) {
  if (range === 'all') return undefined

  return new Date(now - rangeMinutes[range] * 60 * 1_000).toISOString()
}
