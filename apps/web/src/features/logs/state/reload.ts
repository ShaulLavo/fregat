import { fitsCacheBudget } from '@/lib/cache-budget'
import type { QueryClient } from '@tanstack/react-query'
import { logDashboardSummarySchema, logEventsResultSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { LogsFilterState } from '@/features/logs/utils/filter-params'

const KEY = 'logs.display.v1'
const LOGS_RELOAD_MAX_BYTES = 327_680
const schema = v.object({
  root: v.nullable(v.string()),
  filterKey: v.string(),
  windowTime: v.number(),
  observedAt: v.number(),
  events: logEventsResultSchema,
  summary: v.optional(logDashboardSummarySchema),
  options: v.optional(logDashboardSummarySchema),
  scrollTop: v.number(),
  inspectedId: v.nullable(v.string()),
})
export type LogsReload = v.InferOutput<typeof schema>
type Owner = { storage: ScopedStorage; root: string | null; saved: LogsReload | null }
const owners = new WeakMap<QueryClient, Owner>()
const listeners = new Set<() => void>()
export function subscribeLogsReload(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function prepareLogsReload(owner: QueryClient, storage: ScopedStorage, root: string | null) {
  const record = readReloadCache<LogsReload>(KEY, schema, storage, LOGS_RELOAD_MAX_BYTES)
  owners.set(owner, { storage, root, saved: record?.root === root ? record : null })
  for (const listener of listeners) listener()
}

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

export function savedLogs(owner: QueryClient, filterKey: string, state = owners.get(owner)) {
  return state?.saved?.filterKey === filterKey ? state.saved : null
}

export function logsReloadOwner(owner: QueryClient) {
  return owners.get(owner)
}

export function captureLogs(
  owner: QueryClient,
  expected: ReturnType<typeof logsReloadOwner>,
  record: Omit<LogsReload, 'root'>,
) {
  const state = owners.get(owner)
  if (!state || state !== expected) return
  const detailsById =
    record.inspectedId && record.events.detailsById[record.inspectedId]
      ? { [record.inspectedId]: record.events.detailsById[record.inspectedId] }
      : {}
  const saved = { ...record, root: state.root, events: { ...record.events, detailsById } }
  // Bound traversal before JSON serialization, including arbitrary structured log fields.
  if (record.events.events.length > 500 || !fitsCacheBudget(saved, LOGS_RELOAD_MAX_BYTES)) {
    state.storage.removeItem(KEY)
    return
  }
  const result = writeWorkspaceCacheEntry(KEY, saved, {
    storage: state.storage,
    maxSerializedBytes: LOGS_RELOAD_MAX_BYTES,
  })
  if (result.status !== 'written') {
    state.storage.removeItem(KEY)
    return
  }
  state.saved = saved
}
