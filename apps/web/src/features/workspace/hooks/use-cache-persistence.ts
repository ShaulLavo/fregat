import { scrollPositionsEqual } from '@/lib/scroll-positions'
import { captureEditorScrollPositions } from '@/features/editor/state/scroll-persistence'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { Debouncer } from '@tanstack/react-pacer/debouncer'
import { useEffect } from 'react'
import { sameTabContent } from '@/lib/documents/utils/tabs'
import type { ReopenScrollPosition } from '@/lib/documents/utils/types'

import {
  type EditorDocumentStoreApi,
  useEditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import {
  type EditorWorkspaceStore,
  type EditorWorkspaceStoreApi,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  cachedSearchBufferState,
  type SearchBufferSnapshot,
  type SearchBufferStore,
  type SearchBufferStoreApi,
  useSearchBufferStoreApi,
} from '@/features/search/state/buffer-state'
import {
  readWorkspaceCheckoutIds,
  type CachedSearchBufferState,
  type CachedWorkspaceSlice,
  writeChatModePanelsCache,
  writeRootFolderCache,
  writeSearchBufferCache,
  writeUiModeCache,
  writeWorkbenchLayoutCache,
  writeWorkspaceIndexCache,
  writeWorkspaceSliceCache,
} from '@/features/workspace/state/cache'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

const WORKSPACE_CACHE_WRITE_DEBOUNCE_MS = 350

type WithoutStorage<T> = T extends (storage: ScopedStorage, ...args: infer A) => infer R
  ? (...args: A) => R
  : never

export type WorkspaceCacheWriters = {
  chatModePanels: typeof writeChatModePanelsCache
  rootFolder: WithoutStorage<typeof writeRootFolderCache>
  searchBuffer: WithoutStorage<typeof writeSearchBufferCache>
  uiMode: typeof writeUiModeCache
  workbenchLayout: typeof writeWorkbenchLayoutCache
  workspaceIndex: WithoutStorage<typeof writeWorkspaceIndexCache>
  workspaceSlice: WithoutStorage<typeof writeWorkspaceSliceCache>
}

type WorkspaceCachePersistenceOptions = {
  storage: ScopedStorage
  cacheWriters?: WorkspaceCacheWriters
  debounceMs?: number
  documentStore: EditorDocumentStoreApi
  searchStore: SearchBufferStoreApi
  workspaceStore: EditorWorkspaceStoreApi
}

function workspaceCacheWriters(
  storage: ScopedStorage,
  workspaceStore: EditorWorkspaceStoreApi,
): WorkspaceCacheWriters {
  const worktreeId = (rootPath: string | undefined) =>
    rootPath === undefined
      ? null
      : (workspaceStore.getState().worktreeIdByRootPath[rootPath] ?? null)
  return {
    chatModePanels: writeChatModePanelsCache,
    rootFolder: (root) => writeRootFolderCache(storage, root, worktreeId(root?.path)),
    searchBuffer: (root, buffer) => writeSearchBufferCache(storage, root, buffer, worktreeId(root)),
    uiMode: writeUiModeCache,
    workbenchLayout: writeWorkbenchLayoutCache,
    workspaceIndex: (roots) =>
      writeWorkspaceIndexCache(storage, roots, workspaceStore.getState().worktreeIdByRootPath),
    workspaceSlice: (root, slice) =>
      writeWorkspaceSliceCache(storage, root, slice, worktreeId(root)),
  }
}

export function useWorkspaceCachePersistence() {
  const { storage } = useEditorRuntime()
  const documentStore = useEditorDocumentStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  const searchStore = useSearchBufferStoreApi()

  useEffect(
    () =>
      subscribeWorkspaceCachePersistence({
        storage,
        documentStore,
        searchStore,
        workspaceStore,
      }),
    [documentStore, searchStore, storage, workspaceStore],
  )
}

export function subscribeWorkspaceCachePersistence({
  storage,
  cacheWriters,
  debounceMs = WORKSPACE_CACHE_WRITE_DEBOUNCE_MS,
  documentStore,
  searchStore,
  workspaceStore,
}: WorkspaceCachePersistenceOptions) {
  const writers = cacheWriters ?? workspaceCacheWriters(storage, workspaceStore)
  const workspace = workspaceStore.getState()
  const cachedRoots = workspaceSlicesCacheValue(workspace).order
  const bindings = Object.entries(workspace.worktreeIdByRootPath).filter(([root]) =>
    cachedRoots.includes(root),
  )
  const cachedBindings = bindings.length > 0 ? readWorkspaceCheckoutIds(storage) : {}
  if (bindings.some(([root, id]) => cachedBindings[root] !== id))
    persistCheckoutOwnership(writers, workspaceStore, searchStore)
  const subscriptions = workspaceCacheSubscriptions({
    cacheWriters: writers,
    debounceMs,
    documentStore,
    searchStore,
    workspaceStore,
  })
  const removeLifecycleFlush = addLifecycleFlush(() => flushCacheSubscriptions(subscriptions))

  return () => {
    unsubscribeCacheSubscriptions(subscriptions)
    removeLifecycleFlush()
    flushCacheSubscriptions(subscriptions)
  }
}

type EqualityFn<T> = (left: T, right: T) => boolean

type SelectorStore<TState> = {
  getState: () => TState
  subscribe: {
    <TValue>(
      selector: (state: TState) => TValue,
      listener: (selectedState: TValue, previousSelectedState: TValue) => void,
      options?: {
        equalityFn?: EqualityFn<TValue>
        fireImmediately?: boolean
      },
    ): () => void
  }
}

type CacheSubscription = {
  flush: () => void
  unsubscribe: () => void
}

type CacheEntrySubscriptionOptions<TState, TValue> = {
  debounceMs: number
  equalityFn?: EqualityFn<TValue>
  select: (state: TState) => TValue
  store: SelectorStore<TState>
  write: (value: TValue) => void
}

/** Every remembered project's slice plus the order the cache index should record. */
type WorkspaceSlicesCacheValue = {
  order: readonly string[]
  slices: ReadonlyMap<string, CachedWorkspaceSlice>
}

type SearchBuffersCacheValue = {
  /** The open project's results, already in cache shape — see the equality note. */
  active: CachedSearchBufferState | null
  activeSnapshot: SearchBufferSnapshot | null
  parked: ReadonlyMap<string, SearchBufferSnapshot>
}

type WorkspaceCacheSubscriptionOptions = {
  cacheWriters: WorkspaceCacheWriters
  debounceMs: number
  documentStore: EditorDocumentStoreApi
  searchStore: SearchBufferStoreApi
  workspaceStore: EditorWorkspaceStoreApi
}

function workspaceCacheSubscriptions({
  cacheWriters,
  debounceMs,
  documentStore,
  searchStore,
  workspaceStore,
}: WorkspaceCacheSubscriptionOptions): CacheSubscription[] {
  return [
    subscribeCacheEntry({
      debounceMs,
      select: (state) => state.chatModePanels,
      store: workspaceStore,
      write: cacheWriters.chatModePanels,
    }),
    subscribeCacheEntry({
      debounceMs,
      select: (state) => state.uiMode,
      store: workspaceStore,
      write: cacheWriters.uiMode,
    }),
    subscribeCacheEntry({
      debounceMs,
      select: (state) => state.workbenchLayout,
      store: workspaceStore,
      write: cacheWriters.workbenchLayout,
    }),
    subscribeCacheEntry({
      debounceMs,
      select: (state) => state.rootFolder,
      store: workspaceStore,
      write: cacheWriters.rootFolder,
    }),
    // Before the slice subscription in flush order: a pagehide flush pushes the
    // latest scroll positions into the workspace store first, so the slice flush
    // right after writes them out.
    subscribeScrollPositions({ documentStore, workspaceStore }),
    subscribeWorkspaceSlices({ cacheWriters, debounceMs, workspaceStore }),
    subscribeSearchBuffers({ cacheWriters, debounceMs, searchStore }),
    subscribeCacheEntry({
      debounceMs,
      select: (state) => state.worktreeIdByRootPath,
      store: workspaceStore,
      write: () => persistCheckoutOwnership(cacheWriters, workspaceStore, searchStore),
    }),
  ]
}

function persistCheckoutOwnership(
  writers: WorkspaceCacheWriters,
  workspace: EditorWorkspaceStoreApi,
  search: SearchBufferStoreApi,
) {
  const state = workspace.getState()
  const slices = workspaceSlicesCacheValue(state)
  writers.rootFolder(state.rootFolder)
  for (const [root, slice] of slices.slices) writers.workspaceSlice(root, slice)
  writers.workspaceIndex(slices.order)
  const buffers = searchBuffersCacheValue(search.getState())
  if (buffers.active) writers.searchBuffer(buffers.active.rootPath, buffers.active)
  for (const [root, buffer] of buffers.parked)
    writers.searchBuffer(root, cachedSearchBufferState(buffer))
}

// Flush document scroll positions into the workspace slice before writing its cache.
function subscribeScrollPositions({
  documentStore,
  workspaceStore,
}: Pick<WorkspaceCacheSubscriptionOptions, 'documentStore' | 'workspaceStore'>): CacheSubscription {
  const capture = () => captureEditorScrollPositions(workspaceStore, documentStore)
  const unsubscribe = documentStore.subscribe((state) => state.viewsByTabId, capture)
  return { flush: capture, unsubscribe }
}

function subscribeCacheEntry<TState, TValue>({
  debounceMs,
  equalityFn = Object.is,
  select,
  store,
  write,
}: CacheEntrySubscriptionOptions<TState, TValue>): CacheSubscription {
  let value = select(store.getState())
  const pendingWrite = new Debouncer(() => write(value), { wait: debounceMs })
  const unsubscribe = store.subscribe(
    select,
    (nextValue) => {
      value = nextValue
      pendingWrite.maybeExecute()
    },
    { equalityFn },
  )

  return {
    flush: () => pendingWrite.flush(),
    unsubscribe,
  }
}

/**
 * One writer for active and parked slices alike. Parking hands the same field objects
 * to a new owner, so a switch writes nothing that was not already written — the only
 * cost of changing projects is the index entry that records the new order.
 */
function subscribeWorkspaceSlices({
  cacheWriters,
  debounceMs,
  workspaceStore,
}: Pick<
  WorkspaceCacheSubscriptionOptions,
  'cacheWriters' | 'debounceMs' | 'workspaceStore'
>): CacheSubscription {
  // Seeded from what was restored: nothing has drifted yet, so a session that only
  // reads its cache back never rewrites it.
  const restored = workspaceSlicesCacheValue(workspaceStore.getState())
  const written = new Map(restored.slices)
  let writtenOrder = restored.order

  return subscribeCacheEntry({
    debounceMs,
    equalityFn: workspaceSlicesCacheValuesEqual,
    select: workspaceSlicesCacheValue,
    store: workspaceStore,
    write: (value) => {
      for (const [rootPath, slice] of value.slices) {
        if (sameWorkspaceSlice(written.get(rootPath), slice)) continue

        written.set(rootPath, slice)
        cacheWriters.workspaceSlice(rootPath, slice)
      }
      if (readonlyArraysEqual(writtenOrder, value.order)) return

      writtenOrder = value.order
      cacheWriters.workspaceIndex(value.order)
    },
  })
}

function subscribeSearchBuffers({
  cacheWriters,
  debounceMs,
  searchStore,
}: Pick<
  WorkspaceCacheSubscriptionOptions,
  'cacheWriters' | 'debounceMs' | 'searchStore'
>): CacheSubscription {
  const written = new Map<string, SearchBufferSnapshot>(searchStore.getState().parked)

  return subscribeCacheEntry({
    debounceMs,
    equalityFn: searchBuffersCacheValuesEqual,
    select: searchBuffersCacheValue,
    store: searchStore,
    write: (value) => {
      for (const [rootPath, snapshot] of value.parked) {
        if (written.get(rootPath) === snapshot) continue

        written.set(rootPath, snapshot)
        cacheWriters.searchBuffer(rootPath, cachedSearchBufferState(snapshot))
      }
      if (!value.activeSnapshot || !value.active) return
      if (written.get(value.activeSnapshot.rootPath) === value.activeSnapshot) return

      written.set(value.activeSnapshot.rootPath, value.activeSnapshot)
      cacheWriters.searchBuffer(value.activeSnapshot.rootPath, value.active)
    },
  })
}

function workspaceSlicesCacheValue(state: EditorWorkspaceStore): WorkspaceSlicesCacheValue {
  const activeRootPath = state.rootFolder?.path ?? null
  const parked = Array.from(state.parkedWorkspaces.entries()).toSorted(
    (left, right) => right[1].lastActiveAt - left[1].lastActiveAt,
  )
  const slices = new Map<string, CachedWorkspaceSlice>(parked)
  if (activeRootPath !== null) {
    slices.set(activeRootPath, {
      editorHistory: state.editorHistory,
      recentlyClosedTabs: state.recentlyClosedTabs,
      reopenScrollPositions: state.reopenScrollPositions,
      viewScrollPositions: state.viewScrollPositions,
      workbenchPanels: state.workbenchPanels,
    })
  }

  return {
    order:
      activeRootPath !== null
        ? [activeRootPath, ...parked.map((entry) => entry[0])]
        : parked.map((entry) => entry[0]),
    slices,
  }
}

/**
 * Only the open project's results move, so parked ones are compared by identity and
 * never converted. The active one is converted up front on purpose: a streaming search
 * changes the snapshot on every batch while the cache shape stays put, and comparing
 * the cache shape is what keeps a long search from writing localStorage hundreds of
 * times.
 */
function searchBuffersCacheValue(state: SearchBufferStore): SearchBuffersCacheValue {
  return {
    active: cachedSearchBufferState(state.active),
    activeSnapshot: state.active,
    parked: state.parked,
  }
}

function workspaceSlicesCacheValuesEqual(
  left: WorkspaceSlicesCacheValue,
  right: WorkspaceSlicesCacheValue,
) {
  if (!readonlyArraysEqual(left.order, right.order)) return false

  return mapsEqual(left.slices, right.slices, sameWorkspaceSlice)
}

function searchBuffersCacheValuesEqual(
  left: SearchBuffersCacheValue,
  right: SearchBuffersCacheValue,
) {
  if (!cachedSearchBufferStatesEqual(left.active, right.active)) return false

  return mapsEqual(left.parked, right.parked, Object.is)
}

function cachedSearchBufferStatesEqual(
  left: CachedSearchBufferState | null,
  right: CachedSearchBufferState | null,
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.activeResultId === right.activeResultId &&
    left.caseSensitive === right.caseSensitive &&
    left.excludeGlobText === right.excludeGlobText &&
    left.filtersVisible === right.filtersVisible &&
    left.includeGlobText === right.includeGlobText &&
    left.matchMode === right.matchMode &&
    left.query === right.query &&
    left.replaceText === right.replaceText &&
    left.replaceVisible === right.replaceVisible &&
    left.resultsQuery === right.resultsQuery &&
    left.resultsSearchQuery === right.resultsSearchQuery &&
    left.rootPath === right.rootPath &&
    left.totalCount === right.totalCount &&
    left.truncated === right.truncated &&
    left.wholeWord === right.wholeWord &&
    readonlyArraysEqual(left.collapsedPaths, right.collapsedPaths) &&
    readonlyArraysEqual(left.queryHistory, right.queryHistory) &&
    readonlyArraysEqual(left.replaceHistory, right.replaceHistory)
  )
}

function sameWorkspaceSlice(
  left: CachedWorkspaceSlice | undefined,
  right: CachedWorkspaceSlice | undefined,
) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.workbenchPanels !== right.workbenchPanels) return false
  if (left.viewScrollPositions !== right.viewScrollPositions) return false
  if (!readonlyArraysEqual(left.editorHistory, right.editorHistory, sameTabContent)) return false
  if (!readonlyArraysEqual(left.recentlyClosedTabs, right.recentlyClosedTabs, sameTabContent)) {
    return false
  }

  return readonlyArraysEqual(
    left.reopenScrollPositions,
    right.reopenScrollPositions,
    sameScrollPosition,
  )
}

// Order matters: readers of this list take the first entry that matches a tab.
function sameScrollPosition(left: ReopenScrollPosition, right: ReopenScrollPosition) {
  if (!scrollPositionsEqual(left.position, right.position)) return false
  return sameTabContent(left.content, right.content)
}

function mapsEqual<TValue>(
  left: ReadonlyMap<string, TValue>,
  right: ReadonlyMap<string, TValue>,
  valuesEqual: (leftValue: TValue, rightValue: TValue) => boolean,
) {
  if (left === right) return true
  if (left.size !== right.size) return false

  for (const [key, value] of left) {
    if (!right.has(key)) return false

    const rightValue = right.get(key)
    if (rightValue === undefined) return false
    if (!valuesEqual(value, rightValue)) return false
  }

  return true
}

function readonlyArraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
  equal: (left: T, right: T) => boolean = Object.is,
) {
  if (left === right) return true
  if (left.length !== right.length) return false

  return left.every((item, index) => right[index] !== undefined && equal(item, right[index]))
}

function flushCacheSubscriptions(subscriptions: readonly CacheSubscription[]) {
  for (const subscription of subscriptions) subscription.flush()
}

function unsubscribeCacheSubscriptions(subscriptions: readonly CacheSubscription[]) {
  for (const subscription of subscriptions) subscription.unsubscribe()
}
