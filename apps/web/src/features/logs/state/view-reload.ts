import type { QueryClient } from '@tanstack/react-query'
import * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'

const KEY = 'logs.view.v1'
const LOGS_VIEW_MAX_BYTES = 4_096
const schema = v.object({
  root: v.nullable(v.string()),
  filterKey: v.string(),
  /**
   * The time window the reader was looking at, not a cache of its rows. Without it
   * the restored scroll offset lands in a different set of events on every reload.
   */
  windowTime: v.pipe(v.number(), v.minValue(0)),
  scrollTop: v.pipe(v.number(), v.minValue(0)),
  inspectedId: v.nullable(v.string()),
})
export type LogsView = v.InferOutput<typeof schema>
type Owner = { storage: ScopedStorage; root: string | null; saved: LogsView | null }
const owners = new WeakMap<QueryClient, Owner>()

export function prepareLogsViewReload(
  owner: QueryClient,
  storage: ScopedStorage,
  root: string | null,
) {
  const record = readReloadCache<LogsView>(KEY, schema, storage, LOGS_VIEW_MAX_BYTES)
  owners.set(owner, { storage, root, saved: record?.root === root ? record : null })
}

export function savedLogsView(owner: QueryClient, filterKey: string) {
  const saved = owners.get(owner)?.saved
  return saved?.filterKey === filterKey ? saved : null
}

/** The window the reader last had, for the initial `now` before any filter change. */
export function savedLogsWindow(owner: QueryClient) {
  return owners.get(owner)?.saved ?? null
}

export function captureLogsView(owner: QueryClient, view: Omit<LogsView, 'root'>) {
  const state = owners.get(owner)
  if (!state) return
  const record = { ...view, root: state.root }
  const result = writeWorkspaceCacheEntry(KEY, record, {
    storage: state.storage,
    maxSerializedBytes: LOGS_VIEW_MAX_BYTES,
  })
  if (result.status !== 'written') {
    state.storage.removeItem(KEY)
    return
  }
  state.saved = record
}
