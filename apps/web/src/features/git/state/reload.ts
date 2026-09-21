import { fitsCacheBudget } from '@/lib/cache-budget'
import type { QueryClient } from '@tanstack/react-query'
import type { GitFileDiff, GitStatusResult } from '@workspace/contracts'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import {
  reloadSchema,
  gitViewSchema,
  type GitReloadRecord,
  type GitViewRecord,
  type DiffReloadView,
} from '@/features/git/utils/reload-schema'

const KEY = 'git.display.v1'
const VIEW_KEY = 'git.view.v1'
const VIEW_MAX_BYTES = 16_384
export const GIT_RELOAD_MAX_BYTES = 524_288
const owners = new WeakMap<QueryClient, { storage: ScopedStorage; record: GitReloadRecord }>()

const listeners = new Set<() => void>()
export function subscribeGitReload(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function prepareGitReload(owner: QueryClient, storage: ScopedStorage, root: string | null) {
  const saved = readReloadCache<GitReloadRecord>(KEY, reloadSchema, storage, GIT_RELOAD_MAX_BYTES)
  const view = readReloadCache<GitViewRecord>(VIEW_KEY, gitViewSchema, storage, VIEW_MAX_BYTES)
  const record = saved?.root === root ? saved : { root, observedAt: 0 }
  owners.set(owner, {
    storage,
    record: { ...record, view: view?.root === root ? view.view : undefined },
  })
  for (const listener of listeners) listener()
}

export function savedGit(owner: QueryClient, root: string) {
  const record = owners.get(owner)?.record
  return record?.root === root ? record : null
}

export function captureGitStatus(owner: QueryClient, root: string, status: GitStatusResult) {
  const state = owners.get(owner)
  if (!state || state.record.root !== root) return
  if (status.files.length > 1500) {
    state.record = { ...state.record, status: undefined, observedAt: 0 }
    write(state)
    return
  }
  state.record = { ...state.record, status, observedAt: Date.now() }
  write(state)
}

export function captureGitView(
  owner: QueryClient,
  root: string,
  view: NonNullable<GitReloadRecord['view']>,
) {
  const state = owners.get(owner)
  if (!state || state.record.root !== root) return
  state.record = { ...state.record, view }
  const result = writeWorkspaceCacheEntry(
    VIEW_KEY,
    { root, view },
    {
      storage: state.storage,
      maxSerializedBytes: VIEW_MAX_BYTES,
    },
  )
  if (result.status === 'oversized') state.storage.removeItem(VIEW_KEY)
}

export function savedDiff(owner: QueryClient, identity: string) {
  const record = owners.get(owner)?.record.diff
  return record?.identity === identity ? record : null
}

export function gitReloadGeneration(owner: QueryClient): object | undefined {
  return owners.get(owner)
}

export function captureDiff(
  owner: QueryClient,
  generation: object | undefined,
  identity: string,
  diffs: readonly GitFileDiff[],
  view?: DiffReloadView,
) {
  const state = owners.get(owner)
  if (!state || state !== generation) return
  const retained =
    diffs.length <= 200 && fitsCacheBudget(diffs, GIT_RELOAD_MAX_BYTES) ? [...diffs] : undefined
  const previous = state.record.diff
  state.record = {
    ...state.record,
    diff: {
      identity,
      diffs: retained,
      view: view ?? (previous?.identity === identity ? previous.view : undefined),
    },
  }
  write(state)
}

function write(state: { storage: ScopedStorage; record: GitReloadRecord }) {
  if (!fitsCacheBudget(state.record, GIT_RELOAD_MAX_BYTES) && state.record.diff?.diffs) {
    state.record = { ...state.record, diff: { ...state.record.diff, diffs: undefined } }
  }
  if (!fitsCacheBudget(state.record, GIT_RELOAD_MAX_BYTES)) {
    state.record = { root: state.record.root, observedAt: 0 }
    state.storage.removeItem(KEY)
    return
  }
  const { view: _view, ...record } = state.record
  const result = writeWorkspaceCacheEntry(KEY, record, {
    storage: state.storage,
    maxSerializedBytes: GIT_RELOAD_MAX_BYTES,
  })
  if (result.status !== 'oversized') return
  if (state.record.diff?.diffs) {
    state.record = { ...state.record, diff: { ...state.record.diff, diffs: undefined } }
    write(state)
    return
  }
  state.record = { root: state.record.root, observedAt: 0 }
  state.storage.removeItem(KEY)
}
