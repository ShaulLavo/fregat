import { createSubscriptions } from '@workspace/utils/subscriptions'
/**
 * The log dashboard's filters, lifted out of the panel so an address can name them.
 *
 * Module-level for the same reason as the settings stores: the panel unmounts when
 * you look at another tab, and filters that reset every time would make a shared
 * "here are the errors in git over the last six hours" link useless the moment you
 * clicked away. Before this the filters were plain `useState` and survived nothing,
 * so the feature strictly gains.
 */
import { useSyncExternalStore } from 'react'

import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import { type LogsFilterState } from '@workspace/client-core/logs/filters'

/**
 * `null` means "nobody has touched the filters", which is NOT the same as a snapshot of
 * the defaults: `defaultLogsFilterState()` reads the settings mirror per call, so
 * freezing it at first read made a `logs.defaultTimeRange` change invisible until a
 * full reload — and made the projection compare live defaults against frozen filters,
 * leaking `log.*` into every address.
 */
let filters: LogsFilterState | null = null
/**
 * The defaults are re-derived but the OBJECT is reused while it is unchanged.
 * `useSyncExternalStore` compares snapshots by identity: returning a fresh object each
 * call is an infinite render loop.
 */
let defaultsSnapshot = defaultLogsFilterState()
const subscriptions = createSubscriptions()
const subscribeLogsFilters = subscriptions.subscribe

function currentFilters() {
  if (filters) return filters

  const fresh = defaultLogsFilterState()
  if (!sameFilters(fresh, defaultsSnapshot)) defaultsSnapshot = fresh

  return defaultsSnapshot
}

function sameFilters(a: LogsFilterState, b: LogsFilterState) {
  return (
    a.area === b.area &&
    a.level === b.level &&
    a.search === b.search &&
    a.slowMs === b.slowMs &&
    a.source === b.source &&
    a.timeRange === b.timeRange
  )
}

export function readLogsFilters() {
  return currentFilters()
}

export function setLogsFilters(next: LogsFilterState) {
  filters = next
  subscriptions.notify()
}

/**
 * Back to "nobody has touched the filters", which is NOT the same as storing a snapshot
 * of the defaults: a stored snapshot freezes `logs.defaultTimeRange` until a full
 * reload, and makes the projection compare live defaults against frozen filters, which
 * leaks `log.*` into every address.
 */
export function resetLogsFilters() {
  filters = null
  subscriptions.notify()
}

export function useLogsFilters() {
  return useSyncExternalStore(subscribeLogsFilters, currentFilters, currentFilters)
}
