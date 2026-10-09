import type { QueryClient } from '@tanstack/react-query'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import {
  gitViewSchema,
  type DiffReloadView,
  type DiffReloadIdentity,
  type GitViewRecord,
} from '@/features/git/utils/reload-schema'

const KEY = 'git.view.v1'
const VIEW_MAX_BYTES = 65_536
type ReloadState = {
  storage: ScopedStorage
  record: GitViewRecord
  /** The diff view this page load started with; handed out once, never refreshed by captures. */
  saved: GitViewRecord['diff']
}
const owners = new WeakMap<QueryClient, ReloadState>()

const listeners = new Set<() => void>()
export function subscribeGitReload(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function prepareGitReload(owner: QueryClient, storage: ScopedStorage, root: string | null) {
  const saved = readReloadCache<GitViewRecord>(KEY, gitViewSchema, storage, VIEW_MAX_BYTES)
  const record = saved?.root === root ? saved : { root }
  owners.set(owner, { storage, record, saved: record.diff })
  for (const listener of listeners) listener()
}

export function gitReloadGeneration(owner: QueryClient): object | undefined {
  return owners.get(owner)
}

export function savedGitView(owner: QueryClient, root: string) {
  const record = owners.get(owner)?.record
  return record?.root === root ? record.list : undefined
}

export function captureGitView(
  owner: QueryClient,
  root: string,
  list: NonNullable<GitViewRecord['list']>,
) {
  const state = owners.get(owner)
  if (!state || state.record.root !== root) return
  write(state, { ...state.record, list })
}

export function takeSavedDiffView(owner: QueryClient, identity: DiffReloadIdentity) {
  const state = owners.get(owner)
  const saved = state?.saved
  if (!state || !saved || JSON.stringify(saved.identity) !== JSON.stringify(identity)) return
  state.saved = undefined
  return saved.view
}

export function captureDiffView(
  owner: QueryClient,
  generation: object | undefined,
  identity: DiffReloadIdentity,
  view: DiffReloadView,
) {
  const state = owners.get(owner)
  if (!state || state !== generation) return
  write(state, { ...state.record, diff: { identity, view } })
}

function write(state: ReloadState, record: GitViewRecord): void {
  state.record = record
  const result = writeWorkspaceCacheEntry(KEY, record, {
    storage: state.storage,
    maxSerializedBytes: VIEW_MAX_BYTES,
  })
  if (result.status === 'oversized') state.storage.removeItem(KEY)
}
