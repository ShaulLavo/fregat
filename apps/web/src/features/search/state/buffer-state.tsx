import type {
  WorkspaceSearchEvent,
  WorkspaceSearchMatch,
  WorkspaceSearchMatchMode,
  WorkspaceSearchQuery,
  WorkspaceSearchWarningEvent,
} from '@workspace/contracts'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore, type Mutate, type StoreApi } from 'zustand/vanilla'

import type { CachedSearchBufferState } from '@/features/workspace/state/cache'
import { basename, toTreePath } from '@/lib/path-formatters'
import { clientErrors } from '@/lib/structured-errors'
import { createStoreContext } from '@/lib/store-context'
import { documentKey, filesystemPath } from '@/lib/documents/utils/identity'
import type { DocumentKey } from '@/lib/documents/utils/types'
import { compareSearchPaths } from '@/features/search/utils/sort'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import {
  expandedSearchResultItems,
  searchResultContentItems,
  searchResultIdIsName,
  searchResultItemById,
  firstSelectableSearchResultId,
  pickedSearchResultId,
  type SearchResultId,
} from '@/features/search/utils/result-items'

const SEARCH_HISTORY_LIMIT = 50

export type SearchBufferStatus = 'idle' | 'loading' | 'ready' | 'error'
type SearchReplaceStatus = 'idle' | 'running' | 'success' | 'error'

export type SearchBufferOptionPatch = Partial<
  Pick<
    SearchBufferSnapshot,
    | 'caseSensitive'
    | 'excludeGlobText'
    | 'filtersVisible'
    | 'includeGlobText'
    | 'matchMode'
    | 'wholeWord'
  >
>

export type WorkspaceSearchFileGroup = {
  collapsed: boolean
  count: number
  matches: WorkspaceSearchMatch[]
  name: string
  path: string
  pathLabel: string
}

type SearchReplaceToken = Readonly<{
  rootPath: string
  incarnation: object
  runId: number
  query: WorkspaceSearchQuery | null
  replaceText: string
}>

export type SearchBufferSnapshot = {
  readonly incarnation: object
  replaceRequest: SearchReplaceToken | null
  activeResultId: SearchResultId | null
  // False while the cursor is only the default first result: it follows the list and never scrolls it.
  activeResultPicked: boolean
  caseSensitive: boolean
  collapsedPaths: readonly string[]
  error: string | null
  excludeGlobText: string
  filtersVisible: boolean
  groups: readonly WorkspaceSearchFileGroup[]
  key: DocumentKey
  includeGlobText: string
  matchMode: WorkspaceSearchMatchMode
  matches: readonly WorkspaceSearchMatch[]
  query: string
  queryHistory: readonly string[]
  queryHistoryCursor: number | null
  queryHistoryDraft: string | null
  replaceHistory: readonly string[]
  replaceHistoryCursor: number | null
  replaceHistoryDraft: string | null
  replaceMessage: string | null
  replaceStatus: SearchReplaceStatus
  replaceText: string
  replaceVisible: boolean
  resultsQuery: string
  resultsSearchQuery: WorkspaceSearchQuery | null
  rootPath: string
  pendingResultIds: readonly SearchResultId[]
  runningMatches: readonly WorkspaceSearchMatch[]
  runningQuery: string | null
  runningSearchQuery: WorkspaceSearchQuery | null
  runId: number
  searchRevision: number
  status: SearchBufferStatus
  streamBaseMatches: readonly WorkspaceSearchMatch[]
  totalCount: number
  truncated: boolean
  warnings: readonly WorkspaceSearchWarningEvent[]
  wholeWord: boolean
}

type SearchBufferActiveState = {
  active: SearchBufferSnapshot | null
}

type SearchBufferStoreState = SearchBufferActiveState & {
  /** Results for every project except the open one, by root path. */
  parked: ReadonlyMap<string, SearchBufferSnapshot>
}

type SearchBufferStoreActions = {
  appendEvent: (runId: number, event: WorkspaceSearchEvent) => void
  appendEvents: (runId: number, events: readonly WorkspaceSearchEvent[]) => void
  collapseAllGroups: () => void
  expandAllGroups: () => void
  failSearch: (runId: number, error: string) => void
  failReplace: (token: SearchReplaceToken, error: string) => void
  finishReplace: (token: SearchReplaceToken, message: string, refresh?: boolean) => void
  prepareBuffer: (rootPath: string) => SearchBufferSnapshot
  resetBuffer: (rootPath: string) => void
  requestSearchRefresh: (rootPath: string) => void
  setSearchOptions: (rootPath: string, options: SearchBufferOptionPatch) => void
  setQuery: (rootPath: string, query: string) => void
  setReplaceText: (rootPath: string, replaceText: string) => void
  setReplaceVisible: (rootPath: string, replaceVisible: boolean) => void
  selectNextQuery: (rootPath: string) => void
  selectNextReplaceText: (rootPath: string) => void
  selectNextMatch: () => void
  selectPreviousQuery: (rootPath: string) => void
  selectPreviousReplaceText: (rootPath: string) => void
  selectPreviousMatch: () => void
  selectResult: (id: SearchResultId | null) => void
  startReplace: (rootPath: string) => SearchReplaceToken | null
  startSearch: (query: WorkspaceSearchQuery) => number
  /** Parks the open project's results and restores the target's. */
  switchWorkspace: (rootPath: string | null) => void
  toggleGroup: (path: string) => void
}

export type SearchBufferStore = SearchBufferStoreState & SearchBufferStoreActions

export type SearchBufferStoreApi = Mutate<
  StoreApi<SearchBufferStore>,
  [['zustand/subscribeWithSelector', never]]
>

const EMPTY_SEARCH_GROUPS: readonly WorkspaceSearchFileGroup[] = []

export const {
  Context: SearchBufferStateContext,
  useStoreApi: useSearchBufferStoreApi,
  useSelector: useSearchBufferState,
} = createStoreContext<SearchBufferStoreApi>(
  'useSearchBufferStoreApi must be used within SearchBufferStateContext',
)

export function createSearchBufferStore({
  cachedByRootPath = {},
  rootPath = null,
}: {
  cachedByRootPath?: Readonly<Record<string, CachedSearchBufferState>>
  rootPath?: string | null
} = {}) {
  const restored = restoredSearchBuffers(cachedByRootPath)
  const active = rootPath ? (restored.get(rootPath) ?? null) : null
  if (rootPath) restored.delete(rootPath)

  return createStore<SearchBufferStore>()(
    subscribeWithSelector((set, get) => ({
      active,
      parked: restored,
      appendEvent: (runId, event) => set((state) => appendSearchEvent(state, runId, event)),
      appendEvents: (runId, events) => set((state) => appendSearchEvents(state, runId, events)),
      collapseAllGroups: () => set((state) => ({ active: collapseSearchGroups(state.active) })),
      expandAllGroups: () => set((state) => ({ active: expandSearchGroups(state.active) })),
      failSearch: (runId, error) => set((state) => failSearchBuffer(state, runId, error)),
      failReplace: (token, error) =>
        set((state) => settleReplace(state, token, error, 'error', false)),
      finishReplace: (token, message, refresh = false) =>
        set((state) => settleReplace(state, token, message, 'success', refresh)),
      prepareBuffer: (rootPath) => {
        const current = get().active
        if (current?.rootPath === rootPath) return current

        const next = emptySearchBuffer(rootPath)
        set({ active: next })
        return next
      },
      resetBuffer: (rootPath) => set({ active: emptySearchBuffer(rootPath) }),
      requestSearchRefresh: (rootPath) =>
        set((state) => ({
          active: refreshSearchBuffer(state.active, rootPath),
        })),
      setSearchOptions: (rootPath, options) =>
        set((state) => ({
          active: optionSearchBuffer(state.active, rootPath, options),
        })),
      setQuery: (rootPath, query) =>
        set((state) => ({
          active: querySearchBuffer(state.active, rootPath, query),
        })),
      setReplaceText: (rootPath, replaceText) =>
        set((state) => ({
          active: replaceTextSearchBuffer(state.active, rootPath, replaceText),
        })),
      setReplaceVisible: (rootPath, replaceVisible) =>
        set((state) => ({
          active: replaceSearchBuffer(state.active, rootPath, {
            replaceMessage: null,
            replaceStatus: 'idle',
            replaceVisible,
          }),
        })),
      selectNextQuery: (rootPath) =>
        set((state) => ({
          active: searchHistoryQuerySnapshot(state.active, rootPath, 1),
        })),
      selectNextReplaceText: (rootPath) =>
        set((state) => ({
          active: selectReplaceHistoryText(state.active, rootPath, 1),
        })),
      selectNextMatch: () => set((state) => ({ active: selectSearchMatch(state.active, 1) })),
      selectPreviousQuery: (rootPath) =>
        set((state) => ({
          active: searchHistoryQuerySnapshot(state.active, rootPath, -1),
        })),
      selectPreviousReplaceText: (rootPath) =>
        set((state) => ({
          active: selectReplaceHistoryText(state.active, rootPath, -1),
        })),
      selectPreviousMatch: () => set((state) => ({ active: selectSearchMatch(state.active, -1) })),
      selectResult: (id) => set((state) => ({ active: selectSearchResult(state.active, id) })),
      startReplace: (rootPath) => {
        const snapshot = get().active
        if (!snapshot || snapshot.rootPath !== rootPath) return null
        if (snapshot.runId === 0 || snapshot.status !== 'ready') return null
        const token = Object.freeze({
          rootPath,
          incarnation: snapshot.incarnation,
          runId: snapshot.runId,
          query: snapshot.resultsSearchQuery,
          replaceText: snapshot.replaceText,
        })
        set({ active: { ...startReplaceSearchBuffer(snapshot, rootPath), replaceRequest: token } })
        return token
      },
      startSearch: (query) => {
        const current = get().active
        const runId = (current?.runId ?? 0) + 1
        set({ active: loadingSearchBuffer(query, runId, current) })
        return runId
      },
      switchWorkspace: (rootPath) => set((state) => switchedSearchWorkspace(state, rootPath)),
      toggleGroup: (path) =>
        set((state) => ({
          active: toggleSearchGroup(state.active, path),
        })),
    })),
  )
}

function switchedSearchWorkspace(
  state: SearchBufferStoreState,
  rootPath: string | null,
): SearchBufferStoreState {
  if (state.active?.rootPath === rootPath) return state

  const parked = new Map(state.parked)
  if (state.active) parked.set(state.active.rootPath, state.active)

  const restored = rootPath ? (parked.get(rootPath) ?? null) : null
  if (rootPath) parked.delete(rootPath)

  return { active: restored, parked }
}

function restoredSearchBuffers(
  cachedByRootPath: Readonly<Record<string, CachedSearchBufferState>>,
) {
  const restored = new Map<string, SearchBufferSnapshot>()

  for (const [rootPath, cached] of Object.entries(cachedByRootPath)) {
    const snapshot = searchBufferSnapshotFromCache(cached)
    if (!snapshot) continue

    restored.set(rootPath, snapshot)
  }

  return restored
}

export function cachedSearchBufferState(
  snapshot: SearchBufferSnapshot | null,
): CachedSearchBufferState | null {
  if (!snapshot) return null

  const resultMetadata = cachedSearchResultMetadata(snapshot)

  return {
    activeResultId: resultMetadata.activeResultId,
    caseSensitive: snapshot.caseSensitive,
    collapsedPaths: Array.from(snapshot.collapsedPaths),
    excludeGlobText: snapshot.excludeGlobText,
    filtersVisible: snapshot.filtersVisible,
    includeGlobText: snapshot.includeGlobText,
    matchMode: snapshot.matchMode,
    matches: Array.from(resultMetadata.matches),
    query: snapshot.query,
    queryHistory: Array.from(snapshot.queryHistory),
    replaceHistory: Array.from(snapshot.replaceHistory),
    replaceText: snapshot.replaceText,
    replaceVisible: snapshot.replaceVisible,
    resultsQuery: resultMetadata.resultsQuery,
    resultsSearchQuery: resultMetadata.resultsSearchQuery,
    rootPath: snapshot.rootPath,
    totalCount: resultMetadata.totalCount,
    truncated: resultMetadata.truncated,
    warnings: Array.from(resultMetadata.warnings),
    wholeWord: snapshot.wholeWord,
  }
}

function cachedSearchResultMetadata(snapshot: SearchBufferSnapshot) {
  if (!snapshot.resultsSearchQuery || !snapshot.resultsQuery) {
    return {
      activeResultId: null,
      matches: [],
      resultsQuery: '',
      resultsSearchQuery: null,
      totalCount: 0,
      truncated: false,
      warnings: [],
    }
  }
  if (
    snapshot.status === 'loading' &&
    sameWorkspaceSearchQuery(snapshot.resultsSearchQuery, snapshot.runningSearchQuery)
  ) {
    return {
      activeResultId: null,
      matches: [],
      resultsQuery: '',
      resultsSearchQuery: null,
      totalCount: 0,
      truncated: false,
      warnings: [],
    }
  }

  return {
    activeResultId: snapshot.activeResultId,
    matches: Array.from(snapshot.matches),
    resultsQuery: snapshot.resultsQuery,
    resultsSearchQuery: snapshot.resultsSearchQuery,
    totalCount: snapshot.totalCount,
    truncated: snapshot.truncated,
    warnings: snapshot.warnings,
  }
}

function searchBufferSnapshotFromCache(
  cached: CachedSearchBufferState | null,
): SearchBufferSnapshot | null {
  if (!cached) return null
  const groups = groupSearchMatches(cached.matches, cached.rootPath, cached.collapsedPaths)
  const collapsedPaths = prunedCollapsedPaths(cached.collapsedPaths, groups)

  return resolveActiveSearchResult({
    incarnation: Object.freeze({}),
    replaceRequest: null,
    activeResultId: cached.activeResultId,
    activeResultPicked: cached.activeResultId !== null,
    caseSensitive: cached.caseSensitive,
    collapsedPaths,
    error: null,
    excludeGlobText: cached.excludeGlobText,
    filtersVisible: cached.filtersVisible,
    groups: searchGroupsWithCollapsedPaths(groups, collapsedPaths),
    key: documentKey({ kind: 'search', root: filesystemPath(cached.rootPath) }),
    includeGlobText: cached.includeGlobText,
    matchMode: cached.matchMode,
    matches: cached.matches,
    query: cached.query,
    queryHistory: cached.queryHistory,
    queryHistoryCursor: null,
    queryHistoryDraft: null,
    replaceHistory: cached.replaceHistory,
    replaceHistoryCursor: null,
    replaceHistoryDraft: null,
    replaceMessage: null,
    replaceStatus: 'idle',
    replaceText: cached.replaceText,
    replaceVisible: cached.replaceVisible,
    pendingResultIds: [],
    resultsQuery: cached.resultsQuery,
    resultsSearchQuery: cached.resultsSearchQuery,
    rootPath: cached.rootPath,
    runningMatches: [],
    runningQuery: null,
    runningSearchQuery: null,
    runId: 0,
    searchRevision: 0,
    status: cachedSearchBufferStatus(cached),
    streamBaseMatches: [],
    totalCount: cached.totalCount,
    truncated: cached.truncated,
    warnings: cached.warnings,
    wholeWord: cached.wholeWord,
  })
}

function cachedSearchBufferStatus(cached: CachedSearchBufferState) {
  if (!cached.query) return 'idle'
  if (!cached.resultsQuery) return 'loading'

  return 'ready'
}

function optionSearchBuffer(
  current: SearchBufferSnapshot | null,
  rootPath: string,
  options: SearchBufferOptionPatch,
) {
  const base = current?.rootPath === rootPath ? current : emptySearchBuffer(rootPath)
  const next = { ...base, ...options, error: null }
  if (!searchOptionsChanged(base, next)) return base
  if (!next.query) return next

  return {
    ...next,
    replaceMessage: null,
    replaceStatus: 'idle' as const,
    pendingResultIds: [],
    runId: base.runId + 1,
    runningMatches: [],
    runningQuery: null,
    runningSearchQuery: null,
    streamBaseMatches: [],
    status: 'loading' as const,
  }
}

function querySearchBuffer(current: SearchBufferSnapshot | null, rootPath: string, query: string) {
  const base = current?.rootPath === rootPath ? current : emptySearchBuffer(rootPath)
  if (!query) return base.query ? clearedSearchBuffer(base) : base

  const queryChanged = base.query !== query
  if (!queryChanged) return base

  return {
    ...base,
    error: null,
    query,
    queryHistoryCursor: null,
    queryHistoryDraft: null,
    replaceMessage: null,
    replaceStatus: 'idle' as const,
    pendingResultIds: queryChanged ? [] : base.pendingResultIds,
    runId: queryChanged ? base.runId + 1 : base.runId,
    runningMatches: queryChanged ? [] : base.runningMatches,
    runningQuery: queryChanged ? null : base.runningQuery,
    runningSearchQuery: queryChanged ? null : base.runningSearchQuery,
    status: queryChanged ? 'loading' : base.status,
    streamBaseMatches: queryChanged ? [] : base.streamBaseMatches,
  }
}

function clearedSearchBuffer(current: SearchBufferSnapshot) {
  return {
    ...current,
    activeResultId: null,
    activeResultPicked: false,
    error: null,
    groups: EMPTY_SEARCH_GROUPS,
    matches: [],
    query: '',
    queryHistoryCursor: null,
    queryHistoryDraft: null,
    replaceMessage: null,
    replaceStatus: 'idle' as const,
    pendingResultIds: [],
    resultsQuery: '',
    resultsSearchQuery: null,
    runningMatches: [],
    runningQuery: null,
    runningSearchQuery: null,
    runId: current.runId + 1,
    status: 'idle' as const,
    streamBaseMatches: [],
    totalCount: 0,
    truncated: false,
    warnings: [],
  }
}

export function searchGroupsForSnapshot(snapshot: Pick<SearchBufferSnapshot, 'groups'> | null) {
  if (!snapshot) return EMPTY_SEARCH_GROUPS

  return snapshot.groups
}

function appendSearchEvents(
  state: SearchBufferActiveState,
  runId: number,
  events: readonly WorkspaceSearchEvent[],
): SearchBufferActiveState {
  let next = state
  let matches: WorkspaceSearchMatch[] = []

  for (const event of events) {
    if (event.type === 'match') {
      matches.push(event.match)
      continue
    }

    next = appendSearchMatches(next, runId, matches)
    matches = []
    next = appendSearchEvent(next, runId, event)
  }

  return appendSearchMatches(next, runId, matches)
}

function appendSearchEvent(
  state: SearchBufferActiveState,
  runId: number,
  event: WorkspaceSearchEvent,
): SearchBufferActiveState {
  if (event.type === 'match') {
    return appendSearchMatches(state, runId, [event.match])
  }

  const active = activeRun(state.active, runId)
  if (!active) return state
  if (event.type === 'warning') {
    return { active: { ...active, warnings: appendSearchWarning(active.warnings, event) } }
  }
  if (event.type === 'done') {
    const query = active.runningQuery ?? event.query
    const searchQuery = active.runningSearchQuery
    const matches = doneMatches(active, searchQuery)
    const groups = doneGroups(active, matches)
    const collapsedPaths = prunedCollapsedPaths(active.collapsedPaths, groups)
    return {
      active: resolveActiveSearchResult({
        ...active,
        collapsedPaths,
        groups: searchGroupsWithCollapsedPaths(groups, collapsedPaths),
        matches,
        pendingResultIds: [],
        resultsQuery: query,
        resultsSearchQuery: searchQuery,
        runningMatches: [],
        runningQuery: null,
        runningSearchQuery: null,
        status: 'ready',
        streamBaseMatches: [],
        totalCount: event.count,
        truncated: event.truncated,
        warnings: active.warnings,
      }),
    }
  }

  return failSearchBuffer(state, runId, event.message)
}

// One warning per code: a tolerated tool failure can be reported by both the
// disk provider and the composite, and the user only needs to be told once.
function appendSearchWarning(
  warnings: readonly WorkspaceSearchWarningEvent[],
  event: WorkspaceSearchWarningEvent,
) {
  if (warnings.some((warning) => warning.code === event.code)) return warnings

  return warnings.concat(event)
}

function appendSearchMatches(
  state: SearchBufferActiveState,
  runId: number,
  incomingMatches: readonly WorkspaceSearchMatch[],
): SearchBufferActiveState {
  if (incomingMatches.length === 0) return state

  const active = activeRun(state.active, runId)
  if (!active) return state

  const appendingToResults = sameWorkspaceSearchQuery(
    active.resultsSearchQuery,
    active.runningSearchQuery,
  )
  const runningMatches = active.runningMatches.concat(incomingMatches)
  const reconciliation = reconcileSearchStream(active, runningMatches)
  const matches = nextSearchMatches({
    appendingToResults,
    reconciliation,
    runningMatches,
  })
  const groups = nextSearchGroups({
    active,
    appendingToResults,
    incomingMatches,
    matches,
    reconciliation,
  })
  const runningSearchQuery = active.runningSearchQuery
  const next = {
    ...active,
    groups,
    matches,
    pendingResultIds: reconciliation?.pendingResultIds ?? [],
    resultsQuery: active.runningQuery ?? active.resultsQuery,
    resultsSearchQuery: runningSearchQuery ?? active.resultsSearchQuery,
    runningMatches,
    status: 'loading' as const,
    totalCount: contentSearchMatchCount(runningMatches),
    truncated: false,
    warnings: active.warnings,
  }

  return {
    active: resolveAppendedSearchResult(active, next, {
      appendingToResults,
      incomingMatches,
    }),
  }
}

function failSearchBuffer(
  state: SearchBufferActiveState,
  runId: number,
  error: string,
): SearchBufferActiveState {
  const active = activeRun(state.active, runId)
  if (!active) return state

  return {
    active: {
      ...active,
      error,
      pendingResultIds: [],
      runningMatches: [],
      runningQuery: null,
      runningSearchQuery: null,
      status: 'error',
      streamBaseMatches: [],
    },
  }
}

function replaceSearchBuffer(
  snapshot: SearchBufferSnapshot | null,
  rootPath: string,
  patch: Partial<
    Pick<
      SearchBufferSnapshot,
      | 'replaceHistory'
      | 'replaceHistoryCursor'
      | 'replaceHistoryDraft'
      | 'replaceMessage'
      | 'replaceStatus'
      | 'replaceText'
      | 'replaceVisible'
    >
  >,
) {
  if (!snapshot) return null
  if (snapshot.rootPath !== rootPath) return snapshot
  if (!searchBufferPatchChanged(snapshot, patch)) return snapshot

  return {
    ...snapshot,
    ...patch,
  }
}

function searchBufferPatchChanged<TSnapshot extends SearchBufferSnapshot>(
  snapshot: TSnapshot,
  patch: Partial<TSnapshot>,
) {
  for (const key in patch) {
    if (snapshot[key] !== patch[key]) return true
  }

  return false
}

function replaceTextSearchBuffer(
  snapshot: SearchBufferSnapshot | null,
  rootPath: string,
  replaceText: string,
) {
  return replaceSearchBuffer(snapshot, rootPath, {
    replaceHistoryCursor: null,
    replaceHistoryDraft: null,
    replaceMessage: null,
    replaceStatus: 'idle',
    replaceText,
  })
}

function startReplaceSearchBuffer(snapshot: SearchBufferSnapshot, rootPath: string) {
  if (snapshot.rootPath !== rootPath) return snapshot

  const historyNavigation = activeReplaceHistoryNavigation(snapshot)
  return {
    ...snapshot,
    replaceHistory: replaceHistoryForRun(snapshot),
    replaceHistoryCursor: historyNavigation ? snapshot.replaceHistoryCursor : null,
    replaceHistoryDraft: historyNavigation ? snapshot.replaceHistoryDraft : null,
    replaceMessage: null,
    replaceStatus: 'running' as const,
  }
}

function settleReplace(
  state: SearchBufferStoreState,
  token: SearchReplaceToken,
  message: string,
  status: SearchReplaceStatus,
  refresh: boolean,
): Partial<SearchBufferStoreState> {
  const active = state.active?.incarnation === token.incarnation
  const snapshot = active ? state.active : state.parked.get(token.rootPath)
  if (!snapshot || snapshot.incarnation !== token.incarnation || snapshot.replaceRequest !== token)
    return {}
  const matches =
    snapshot.runId === token.runId &&
    snapshot.resultsSearchQuery === token.query &&
    snapshot.replaceText === token.replaceText
  let next: SearchBufferSnapshot = {
    ...snapshot,
    replaceRequest: null,
    replaceStatus: matches ? status : 'idle',
    replaceMessage: matches ? message : null,
  }
  if (matches && refresh) next = refreshSearchBuffer(next, token.rootPath) ?? next
  if (active) return { active: next }
  const parked = new Map(state.parked)
  parked.set(token.rootPath, next)
  return { parked }
}

function refreshSearchBuffer(snapshot: SearchBufferSnapshot | null, rootPath: string) {
  if (!snapshot) return null
  if (snapshot.rootPath !== rootPath) return snapshot
  if (!snapshot.query) return snapshot

  return {
    ...snapshot,
    error: null,
    pendingResultIds: [],
    runId: snapshot.runId + 1,
    runningMatches: [],
    runningQuery: null,
    runningSearchQuery: null,
    searchRevision: snapshot.searchRevision + 1,
    status: 'loading' as const,
    streamBaseMatches: [],
  }
}

function activeRun(snapshot: SearchBufferSnapshot | null, runId: number) {
  if (!snapshot) return null
  if (snapshot.runId !== runId) return null

  return snapshot
}

export function emptySearchBuffer(rootPath: string): SearchBufferSnapshot {
  // Seeded from settings, not hardcoded: these are the defaults a *new* search
  // starts from. The per-buffer values the user toggles afterwards stay in the
  // buffer — a setting that reached back in and reset them mid-session would be
  // a setting nobody could work with.
  const settings = readSettingsMirror()

  return {
    incarnation: Object.freeze({}),
    replaceRequest: null,
    activeResultId: null,
    activeResultPicked: false,
    caseSensitive: settings['search.caseSensitive'],
    collapsedPaths: [],
    error: null,
    excludeGlobText: '',
    filtersVisible: false,
    groups: EMPTY_SEARCH_GROUPS,
    key: documentKey({ kind: 'search', root: filesystemPath(rootPath) }),
    includeGlobText: '',
    matchMode: settings['search.defaultMatchMode'],
    matches: [],
    query: '',
    queryHistory: [],
    queryHistoryCursor: null,
    queryHistoryDraft: null,
    replaceHistory: [],
    replaceHistoryCursor: null,
    replaceHistoryDraft: null,
    replaceMessage: null,
    replaceStatus: 'idle',
    replaceText: '',
    replaceVisible: false,
    pendingResultIds: [],
    resultsQuery: '',
    resultsSearchQuery: null,
    rootPath,
    runningMatches: [],
    runningQuery: null,
    runningSearchQuery: null,
    runId: 0,
    searchRevision: 0,
    status: 'idle',
    streamBaseMatches: [],
    totalCount: 0,
    truncated: false,
    warnings: [],
    wholeWord: settings['search.wholeWord'],
  }
}

function loadingSearchBuffer(
  query: WorkspaceSearchQuery,
  runId: number,
  current: SearchBufferSnapshot | null,
): SearchBufferSnapshot {
  const previous = current?.rootPath === query.path ? current : null
  const historyNavigation = activeSearchHistoryNavigation(previous, query.query)
  const streamBaseMatches = streamBaseMatchesForSearch(previous, query)

  return {
    incarnation: previous?.incarnation ?? Object.freeze({}),
    replaceRequest: previous?.replaceRequest ?? null,
    activeResultId: previous?.activeResultId ?? null,
    activeResultPicked: previous?.activeResultPicked ?? false,
    caseSensitive: query.caseSensitive ?? previous?.caseSensitive ?? false,
    collapsedPaths: previous?.collapsedPaths ?? [],
    error: null,
    excludeGlobText: previous?.excludeGlobText ?? globTextForQuery(query.excludeGlobs),
    filtersVisible: previous?.filtersVisible ?? hasWorkspaceSearchGlobs(query),
    groups: previous?.groups ?? EMPTY_SEARCH_GROUPS,
    key: documentKey({ kind: 'search', root: filesystemPath(query.path) }),
    includeGlobText: previous?.includeGlobText ?? globTextForQuery(query.includeGlobs),
    matchMode: query.matchMode ?? previous?.matchMode ?? 'literal',
    matches: previous?.matches ?? [],
    query: query.query,
    queryHistory: searchHistoryForRun(previous, query.query),
    queryHistoryCursor: historyNavigation && previous ? previous.queryHistoryCursor : null,
    queryHistoryDraft: historyNavigation && previous ? previous.queryHistoryDraft : null,
    replaceHistory: previous?.replaceHistory ?? [],
    replaceHistoryCursor: previous?.replaceHistoryCursor ?? null,
    replaceHistoryDraft: previous?.replaceHistoryDraft ?? null,
    replaceMessage: previous?.replaceMessage ?? null,
    replaceStatus: previous?.replaceStatus ?? 'idle',
    replaceText: previous?.replaceText ?? '',
    replaceVisible: previous?.replaceVisible ?? false,
    pendingResultIds: pendingResultIdsForMatches(
      streamBaseMatches,
      query.path,
      previous?.collapsedPaths ?? [],
    ),
    resultsQuery: previous?.resultsQuery ?? '',
    resultsSearchQuery: previous?.resultsSearchQuery ?? null,
    rootPath: query.path,
    runningMatches: [],
    runningQuery: query.query,
    runningSearchQuery: query,
    runId,
    searchRevision: previous?.searchRevision ?? 0,
    status: 'loading',
    streamBaseMatches,
    totalCount: previous?.totalCount ?? 0,
    truncated: previous?.truncated ?? false,
    warnings: [],
    wholeWord: query.wholeWord ?? previous?.wholeWord ?? false,
  }
}

function hasWorkspaceSearchGlobs(query: WorkspaceSearchQuery) {
  if ((query.includeGlobs?.length ?? 0) > 0) return true

  return (query.excludeGlobs?.length ?? 0) > 0
}

function globTextForQuery(globs: readonly string[] | undefined) {
  return globs?.join(', ') ?? ''
}

function nextSearchMatches({
  appendingToResults,
  reconciliation,
  runningMatches,
}: {
  appendingToResults: boolean
  reconciliation: SearchStreamReconciliation | null
  runningMatches: readonly WorkspaceSearchMatch[]
}) {
  if (reconciliation) return reconciliation.matches
  if (appendingToResults) return runningMatches

  return runningMatches
}

function nextSearchGroups({
  active,
  appendingToResults,
  incomingMatches,
  matches,
  reconciliation,
}: {
  active: SearchBufferSnapshot
  appendingToResults: boolean
  incomingMatches: readonly WorkspaceSearchMatch[]
  matches: readonly WorkspaceSearchMatch[]
  reconciliation: SearchStreamReconciliation | null
}) {
  if (reconciliation) {
    return groupSearchMatches(matches, active.rootPath, active.collapsedPaths)
  }
  if (appendingToResults) {
    return appendSearchGroups(
      active.groups,
      incomingMatches,
      active.rootPath,
      active.collapsedPaths,
    )
  }

  return groupSearchMatches(matches, active.rootPath, active.collapsedPaths)
}

function doneMatches(active: SearchBufferSnapshot, query: WorkspaceSearchQuery | null) {
  if (sameWorkspaceSearchQuery(active.runningSearchQuery, query)) {
    return active.runningMatches
  }
  if (sameWorkspaceSearchQuery(active.resultsSearchQuery, query)) {
    return active.matches
  }

  return []
}

function doneGroups(active: SearchBufferSnapshot, matches: readonly WorkspaceSearchMatch[]) {
  if (matches === active.matches) return active.groups

  return groupSearchMatches(matches, active.rootPath, active.collapsedPaths)
}

type SearchStreamReconciliation = {
  matches: readonly WorkspaceSearchMatch[]
  pendingResultIds: readonly SearchResultId[]
}

function reconcileSearchStream(
  active: SearchBufferSnapshot,
  runningMatches: readonly WorkspaceSearchMatch[],
): SearchStreamReconciliation | null {
  if (!shouldReconcileSearchStream(active)) return null

  const runningItems = resultMatchItemsForMatches(
    runningMatches,
    active.rootPath,
    active.collapsedPaths,
  )
  const runningById = new Map(runningItems.map((item) => [item.id, item.match]))
  const usedRunningIds = new Set<SearchResultId>()
  const pendingResultIds: SearchResultId[] = []
  const matches: WorkspaceSearchMatch[] = []

  for (const baseItem of resultMatchItemsForMatches(
    active.streamBaseMatches,
    active.rootPath,
    active.collapsedPaths,
  )) {
    const runningMatch = runningById.get(baseItem.id)
    if (runningMatch) {
      matches.push(runningMatch)
      usedRunningIds.add(baseItem.id)
      continue
    }

    matches.push(baseItem.match)
    pendingResultIds.push(baseItem.id)
  }

  for (const runningItem of runningItems) {
    if (usedRunningIds.has(runningItem.id)) continue

    matches.push(runningItem.match)
  }

  return { matches, pendingResultIds }
}

function shouldReconcileSearchStream(active: SearchBufferSnapshot) {
  if (active.streamBaseMatches.length === 0) return false

  return active.runningSearchQuery !== null
}

function streamBaseMatchesForSearch(
  previous: SearchBufferSnapshot | null,
  query: WorkspaceSearchQuery,
) {
  if (!previous) return []
  if (!previous.resultsSearchQuery) return []
  if (previous.matches.length === 0) return []
  if (!sameWorkspaceSearchScope(previous.resultsSearchQuery, query)) return []
  if (!relatedSearchText(previous.resultsSearchQuery.query, query.query)) return []

  return previous.matches
}

function pendingResultIdsForMatches(
  matches: readonly WorkspaceSearchMatch[],
  rootPath: string,
  collapsedPaths: readonly string[],
) {
  if (matches.length === 0) return []

  return resultMatchItemsForMatches(matches, rootPath, collapsedPaths).map((item) => item.id)
}

function resultMatchItemsForMatches(
  matches: readonly WorkspaceSearchMatch[],
  rootPath: string,
  collapsedPaths: readonly string[],
) {
  return expandedSearchResultItems(groupSearchMatches(matches, rootPath, collapsedPaths)).filter(
    isSearchResultMatchOrNameItem,
  )
}

function isSearchResultMatchOrNameItem(
  item: ReturnType<typeof expandedSearchResultItems>[number],
): item is Extract<
  ReturnType<typeof expandedSearchResultItems>[number],
  { type: 'match' | 'name' }
> {
  return item.type === 'match' || item.type === 'name'
}

function searchOptionsChanged(current: SearchBufferSnapshot, next: SearchBufferSnapshot) {
  if (current.caseSensitive !== next.caseSensitive) return true
  if (current.excludeGlobText !== next.excludeGlobText) return true
  if (current.filtersVisible !== next.filtersVisible) return true
  if (current.includeGlobText !== next.includeGlobText) return true
  if (current.matchMode !== next.matchMode) return true

  return current.wholeWord !== next.wholeWord
}

export function sameWorkspaceSearchQuery(
  left: WorkspaceSearchQuery | null,
  right: WorkspaceSearchQuery | null,
) {
  if (!left || !right) return left === right
  return left.query === right.query && sameWorkspaceSearchScope(left, right)
}

function sameWorkspaceSearchScope(left: WorkspaceSearchQuery, right: WorkspaceSearchQuery) {
  if (left.caseSensitive !== right.caseSensitive) return false
  if (left.entryType !== right.entryType) return false
  if (left.includeContent !== right.includeContent) return false
  if (left.includeNames !== right.includeNames) return false
  if (left.limit !== right.limit) return false
  if (left.matchMode !== right.matchMode) return false
  if (left.maxDepth !== right.maxDepth) return false
  if (left.path !== right.path) return false
  if (left.useWorkspaceIndex !== right.useWorkspaceIndex) return false
  if (left.wholeWord !== right.wholeWord) return false
  if (!sameStringList(left.includeGlobs, right.includeGlobs)) return false

  return sameStringList(left.excludeGlobs, right.excludeGlobs)
}

function relatedSearchText(left: string, right: string) {
  if (!left || !right) return false

  return left === right || left.startsWith(right) || right.startsWith(left)
}

function sameStringList(left: readonly string[] | undefined, right: readonly string[] | undefined) {
  const leftList = left ?? []
  const rightList = right ?? []
  if (leftList.length !== rightList.length) return false

  return leftList.every((value, index) => value === rightList[index])
}

function toggleSearchGroup(snapshot: SearchBufferSnapshot | null, path: string) {
  if (!snapshot) return null

  const collapsedPaths = new Set(snapshot.collapsedPaths)
  if (collapsedPaths.has(path)) {
    collapsedPaths.delete(path)
  } else {
    collapsedPaths.add(path)
  }
  const collapsedPathList = Array.from(collapsedPaths)

  return resolveActiveSearchResult({
    ...snapshot,
    collapsedPaths: collapsedPathList,
    groups: searchGroupsWithCollapsedPaths(snapshot.groups, collapsedPathList),
  })
}

export function searchHistoryQuerySnapshot(
  snapshot: SearchBufferSnapshot | null,
  rootPath: string,
  direction: 1 | -1,
) {
  if (!snapshot) return null
  if (snapshot.rootPath !== rootPath) return snapshot

  const selection = searchHistorySelection(queryHistoryState(snapshot), direction)
  if (!selection) return snapshot

  return searchHistoryQueryBuffer(snapshot, selection.value, selection.cursor, selection.draft)
}

function selectReplaceHistoryText(
  snapshot: SearchBufferSnapshot | null,
  rootPath: string,
  direction: 1 | -1,
) {
  if (!snapshot) return null
  if (snapshot.rootPath !== rootPath) return snapshot

  const selection = searchHistorySelection(replaceHistoryState(snapshot), direction)
  if (!selection) return snapshot

  return {
    ...snapshot,
    replaceHistoryCursor: selection.cursor,
    replaceHistoryDraft: selection.draft,
    replaceMessage: null,
    replaceStatus: 'idle' as const,
    replaceText: selection.value,
  }
}

function searchHistoryQueryBuffer(
  snapshot: SearchBufferSnapshot,
  query: string,
  cursor: number | null,
  draft: string | null,
) {
  if (!query) {
    return {
      ...clearedSearchBuffer(snapshot),
      queryHistoryCursor: cursor,
      queryHistoryDraft: draft,
    }
  }

  const queryChanged = snapshot.query !== query
  return {
    ...snapshot,
    error: null,
    query,
    queryHistoryCursor: cursor,
    queryHistoryDraft: draft,
    replaceMessage: null,
    replaceStatus: 'idle' as const,
    runId: queryChanged ? snapshot.runId + 1 : snapshot.runId,
    runningQuery: queryChanged ? null : snapshot.runningQuery,
    runningSearchQuery: queryChanged ? null : snapshot.runningSearchQuery,
    status: queryChanged ? 'loading' : snapshot.status,
  }
}

type SearchTextHistoryState = {
  cursor: number | null
  draft: string | null
  history: readonly string[]
  value: string
}

type SearchTextHistorySelection = {
  cursor: number | null
  draft: string | null
  value: string
}

function queryHistoryState(snapshot: SearchBufferSnapshot) {
  return {
    cursor: snapshot.queryHistoryCursor,
    draft: snapshot.queryHistoryDraft,
    history: snapshot.queryHistory,
    value: snapshot.query,
  }
}

function replaceHistoryState(snapshot: SearchBufferSnapshot) {
  return {
    cursor: snapshot.replaceHistoryCursor,
    draft: snapshot.replaceHistoryDraft,
    history: snapshot.replaceHistory,
    value: snapshot.replaceText,
  }
}

function searchHistorySelection(
  state: SearchTextHistoryState,
  direction: 1 | -1,
): SearchTextHistorySelection | null {
  const cursor = searchHistoryCursor(state, direction)
  if (cursor === state.cursor) return null

  return {
    cursor,
    draft: searchHistoryDraft(state, cursor),
    value: searchHistoryValue(state, cursor),
  }
}

function searchHistoryCursor(state: SearchTextHistoryState, direction: 1 | -1) {
  if (state.history.length === 0) return null
  if (direction < 0) return previousSearchHistoryCursor(state)

  return nextSearchHistoryCursor(state)
}

function previousSearchHistoryCursor(state: SearchTextHistoryState) {
  if (state.cursor !== null) {
    return Math.max(0, state.cursor - 1)
  }

  const currentIndex = currentSearchHistoryIndex(state)
  if (currentIndex > 0) return currentIndex - 1
  if (currentIndex === 0) return 0

  return state.history.length - 1
}

function nextSearchHistoryCursor(state: SearchTextHistoryState) {
  if (state.cursor !== null) {
    return nextSearchHistoryCursorFromActive(state)
  }

  const currentIndex = currentSearchHistoryIndex(state)
  if (currentIndex < 0) return null
  if (currentIndex >= state.history.length - 1) return null

  return currentIndex + 1
}

function nextSearchHistoryCursorFromActive(state: SearchTextHistoryState) {
  const cursor = state.cursor
  if (cursor === null) return null
  if (cursor >= state.history.length - 1) return null

  return cursor + 1
}

function currentSearchHistoryIndex(state: SearchTextHistoryState) {
  return state.history.lastIndexOf(state.value)
}

function searchHistoryDraft(state: SearchTextHistoryState, cursor: number | null) {
  if (cursor === null) return null
  if (state.cursor !== null) return state.draft

  return state.value
}

function searchHistoryValue(state: SearchTextHistoryState, cursor: number | null) {
  if (cursor === null) return state.draft ?? state.value

  return state.history[cursor] ?? state.value
}

function activeSearchHistoryNavigation(
  previous: SearchBufferSnapshot | null,
  query: string,
): boolean {
  if (!previous) return false

  return activeTextHistoryNavigation(queryHistoryState(previous), query)
}

function activeReplaceHistoryNavigation(snapshot: SearchBufferSnapshot) {
  return activeTextHistoryNavigation(replaceHistoryState(snapshot), snapshot.replaceText)
}

function activeTextHistoryNavigation(state: SearchTextHistoryState, value: string) {
  if (state.cursor === null) return false

  return state.value === value
}

function searchHistoryForRun(previous: SearchBufferSnapshot | null, query: string) {
  if (previous && activeSearchHistoryNavigation(previous, query)) {
    return previous.queryHistory
  }

  return nextSearchHistory(previous?.queryHistory ?? [], query, {
    trim: false,
  })
}

function replaceHistoryForRun(snapshot: SearchBufferSnapshot) {
  if (activeReplaceHistoryNavigation(snapshot)) return snapshot.replaceHistory

  return nextSearchHistory(snapshot.replaceHistory, snapshot.replaceText, {
    trim: false,
  })
}

function nextSearchHistory(
  history: readonly string[],
  text: string,
  options: { trim?: boolean } = {},
) {
  const value = options.trim === false ? text : text.trim()
  if (!value) return history
  if (history.at(-1) === value) return history

  return history
    .filter((item) => item !== value)
    .concat(value)
    .slice(-SEARCH_HISTORY_LIMIT)
}

function collapseSearchGroups(snapshot: SearchBufferSnapshot | null) {
  if (!snapshot) return null

  const collapsedPaths = snapshot.groups
    .filter((group) => group.count > 0)
    .map((group) => group.path)

  return resolveActiveSearchResult({
    ...snapshot,
    collapsedPaths,
    groups: searchGroupsWithCollapsedPaths(snapshot.groups, collapsedPaths),
  })
}

function expandSearchGroups(snapshot: SearchBufferSnapshot | null) {
  if (!snapshot) return null

  return resolveActiveSearchResult({
    ...snapshot,
    collapsedPaths: [],
    groups: searchGroupsWithCollapsedPaths(snapshot.groups, []),
  })
}

function selectSearchResult(snapshot: SearchBufferSnapshot | null, id: SearchResultId | null) {
  if (!snapshot) return null

  const groups = snapshot.groups
  const selected = searchResultItemById(expandedSearchResultItems(groups), id)
  if (!selected) return resolveActiveSearchResult(snapshot)

  const collapsedPaths =
    selected.type === 'match'
      ? withoutPath(snapshot.collapsedPaths, selected.groupPath)
      : snapshot.collapsedPaths

  return resolveActiveSearchResult({
    ...snapshot,
    activeResultId: selected.id,
    activeResultPicked: true,
    collapsedPaths,
    groups: searchGroupsWithCollapsedPaths(groups, collapsedPaths),
  })
}

function selectSearchMatch(snapshot: SearchBufferSnapshot | null, direction: 1 | -1) {
  if (!snapshot) return null

  const groups = snapshot.groups
  const matches = searchResultContentItems(expandedSearchResultItems(groups))
  if (matches.length === 0) return resolveActiveSearchResult(snapshot)

  const index = activeSearchMatchIndex(matches, snapshot.activeResultId)
  const nextIndex = wrappedSearchMatchIndex(index, matches.length, direction)
  const selected = matches[nextIndex]
  if (!selected) return resolveActiveSearchResult(snapshot)

  const collapsedPaths = withoutPath(snapshot.collapsedPaths, selected.groupPath)
  return resolveActiveSearchResult({
    ...snapshot,
    activeResultId: selected.id,
    activeResultPicked: true,
    collapsedPaths,
    groups: searchGroupsWithCollapsedPaths(groups, collapsedPaths),
  })
}

function resolveActiveSearchResult(snapshot: SearchBufferSnapshot) {
  const picked = snapshot.activeResultPicked
    ? pickedSearchResultId(snapshot.groups, snapshot.activeResultId)
    : null
  const activeResultId = picked ?? firstSelectableSearchResultId(snapshot.groups)
  const activeResultPicked = picked !== null
  const unchanged =
    activeResultId === snapshot.activeResultId && activeResultPicked === snapshot.activeResultPicked
  if (unchanged) return snapshot

  return {
    ...snapshot,
    activeResultId,
    activeResultPicked,
  }
}

function resolveAppendedSearchResult(
  previous: SearchBufferSnapshot,
  next: SearchBufferSnapshot,
  options: {
    appendingToResults: boolean
    incomingMatches: readonly WorkspaceSearchMatch[]
  },
) {
  if (!canKeepActiveResult(previous, options)) {
    return resolveActiveSearchResult(next)
  }

  return next
}

function canKeepActiveResult(
  previous: SearchBufferSnapshot,
  options: {
    appendingToResults: boolean
    incomingMatches: readonly WorkspaceSearchMatch[]
  },
) {
  if (!previous.activeResultId || !previous.activeResultPicked) return false
  if (!options.appendingToResults) return false
  if (!searchResultIdIsName(previous.activeResultId)) return true

  return !hasContentSearchMatch(options.incomingMatches)
}

function activeSearchMatchIndex(
  matches: ReturnType<typeof searchResultContentItems>,
  activeResultId: SearchResultId | null,
) {
  if (!activeResultId) return -1

  return matches.findIndex((match) => match.id === activeResultId)
}

function wrappedSearchMatchIndex(index: number, length: number, direction: 1 | -1) {
  if (index < 0) return direction > 0 ? 0 : length - 1

  return (index + direction + length) % length
}

function withoutPath(paths: readonly string[], path: string) {
  return paths.filter((item) => item !== path)
}

function prunedCollapsedPaths(
  collapsedPaths: readonly string[],
  groups: readonly WorkspaceSearchFileGroup[],
) {
  const presentPaths = new Set(groups.map((group) => group.path))

  return collapsedPaths.filter((path) => presentPaths.has(path))
}

function contentSearchMatchCount(matches: readonly WorkspaceSearchMatch[]) {
  let count = 0

  for (const match of matches) {
    count += contentMatchCount(match)
  }

  return count
}

function hasContentSearchMatch(matches: readonly WorkspaceSearchMatch[]) {
  for (const match of matches) {
    if (match.kind === 'content') return true
  }

  return false
}

function groupSearchMatches(
  matches: readonly WorkspaceSearchMatch[],
  rootPath: string,
  collapsedPaths: readonly string[],
) {
  if (matches.length === 0) return EMPTY_SEARCH_GROUPS

  const groupMatches = new Map<string, WorkspaceSearchMatch[]>()

  for (const match of matches) {
    const pathMatches = groupMatches.get(match.path)
    if (pathMatches) {
      pathMatches.push(match)
      continue
    }

    groupMatches.set(match.path, [match])
  }

  const collapsed = new Set(collapsedPaths)
  return sortedSearchGroups(
    Array.from(groupMatches.values()).map((pathMatches) =>
      searchFileGroup(pathMatches, rootPath, collapsed),
    ),
  )
}

function searchFileGroup(
  matches: readonly WorkspaceSearchMatch[],
  rootPath: string,
  collapsedPaths: ReadonlySet<string>,
): WorkspaceSearchFileGroup {
  const firstMatch = matches[0]
  if (!firstMatch) {
    throw clientErrors.INVALID_OPTION({
      message: 'Cannot create a search file group without matches.',
      internal: { rootPath, collapsedCount: collapsedPaths.size },
    })
  }

  return {
    collapsed: collapsedPaths.has(firstMatch.path),
    count: contentSearchMatchCount(matches),
    matches: matches.slice(),
    name: basename(firstMatch.path),
    path: firstMatch.path,
    pathLabel: toTreePath(firstMatch.path, rootPath),
  }
}

function appendSearchGroups(
  groups: readonly WorkspaceSearchFileGroup[],
  matches: readonly WorkspaceSearchMatch[],
  rootPath: string,
  collapsedPaths: readonly string[],
) {
  if (matches.length === 0) return groups
  if (groups.length === 0) {
    return groupSearchMatches(matches, rootPath, collapsedPaths)
  }

  const groupsByPath = new Map(groups.map((group) => [group.path, group]))
  const matchesByPath = searchMatchesByPath(matches)
  const collapsed = new Set(collapsedPaths)

  for (const [path, pathMatches] of matchesByPath) {
    const group = groupsByPath.get(path)
    const nextGroup = group
      ? appendedSearchFileGroup(group, pathMatches, collapsed)
      : searchFileGroup(pathMatches, rootPath, collapsed)
    groupsByPath.set(path, nextGroup)
  }

  return sortedSearchGroups(Array.from(groupsByPath.values()))
}

function searchMatchesByPath(matches: readonly WorkspaceSearchMatch[]) {
  const matchesByPath = new Map<string, WorkspaceSearchMatch[]>()

  for (const match of matches) {
    const pathMatches = matchesByPath.get(match.path)
    if (pathMatches) {
      pathMatches.push(match)
      continue
    }

    matchesByPath.set(match.path, [match])
  }

  return matchesByPath
}

function appendedSearchFileGroup(
  group: WorkspaceSearchFileGroup,
  matches: readonly WorkspaceSearchMatch[],
  collapsedPaths: ReadonlySet<string>,
): WorkspaceSearchFileGroup {
  return {
    ...group,
    collapsed: collapsedPaths.has(group.path),
    count: group.count + contentSearchMatchCount(matches),
    matches: group.matches.concat(matches),
  }
}

function searchGroupsWithCollapsedPaths(
  groups: readonly WorkspaceSearchFileGroup[],
  collapsedPaths: readonly string[],
) {
  if (groups.length === 0) return groups

  const collapsed = new Set(collapsedPaths)
  let changed = false
  const nextGroups = groups.map((group) => {
    const nextCollapsed = collapsed.has(group.path)
    if (nextCollapsed === group.collapsed) return group

    changed = true
    return {
      ...group,
      collapsed: nextCollapsed,
    }
  })

  if (!changed) return groups

  return nextGroups
}

function sortedSearchGroups(groups: WorkspaceSearchFileGroup[]) {
  return groups.sort((a, b) => compareSearchPaths(a.pathLabel, b.pathLabel))
}

function contentMatchCount(match: WorkspaceSearchMatch) {
  return match.kind === 'content' ? 1 : 0
}
