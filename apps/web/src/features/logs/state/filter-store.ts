/**
 * The log dashboard's filters, lifted out of the panel so an address can name them and they
 * survive the panel unmounting when another tab is shown.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { useSettingValue } from '@/hooks/use-setting-value'
import { defaultLogsFilterState, logsFilterDefaults } from '@/features/logs/utils/filter-params'
import { type LogsFilterState } from '@workspace/client-core/logs/filters'

/**
 * `null` means "nobody has touched the filters". Storing a snapshot of the defaults instead would
 * freeze `logs.defaultTimeRange` until a reload and leak `log.*` into every address.
 */
const store = createStore<LogsFilterState | null>(() => null)

export function readLogsFilters() {
  return store.getState() ?? defaultLogsFilterState()
}

export function setLogsFilters(next: LogsFilterState) {
  store.setState(next, true)
}

export function resetLogsFilters() {
  store.setState(null, true)
}

export function useLogsFilters() {
  const filters = useStore(store)
  const slowMs = useSettingValue('logs.slowThresholdMs')
  const timeRange = useSettingValue('logs.defaultTimeRange')
  return filters ?? logsFilterDefaults(slowMs, timeRange)
}
