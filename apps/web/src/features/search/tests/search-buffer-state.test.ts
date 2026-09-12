import { expect, test as it } from '../../../../test/fixtures'
const describe = it.describe
import type { WorkspaceSearchMatch } from '@workspace/contracts'

import {
  cachedSearchBufferState,
  createSearchBufferStore,
  searchGroupsForSnapshot,
  type SearchBufferSnapshot,
} from '@/features/search/state/buffer-state'
import {
  expandedSearchResultItems,
  firstSearchResultChildId,
  firstSearchResultId,
  lastSearchResultId,
  parentSearchResultId,
  searchResultActiveMatchPosition,
  searchResultItemById,
  searchResultIdByOffset,
  searchResultItems,
} from '@/features/search/utils/result-items'

describe('search buffer store', () => {
  it('keeps a warning attached to the run instead of failing it', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })

    store.getState().appendEvent(runId, {
      match: {
        kind: 'content',
        path: 'repo/src/app.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(runId, {
      code: 'content-tool-partial-failure',
      message: 'rg could not read part of this workspace.',
      type: 'warning',
    })
    store.getState().appendEvent(runId, {
      count: 1,
      path: 'repo',
      query: 'needle',
      truncated: false,
      type: 'done',
    })

    const snapshot = store.getState().active
    expect(snapshot?.status).toBe('ready')
    expect(snapshot?.error).toBeNull()
    expect(snapshot?.totalCount).toBe(1)
    expect(snapshot?.warnings).toEqual([
      {
        code: 'content-tool-partial-failure',
        message: 'rg could not read part of this workspace.',
        type: 'warning',
      },
    ])
  })

  it('reports one warning per code when providers repeat it', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })
    const warning = {
      code: 'content-tool-partial-failure',
      message: 'rg could not read part of this workspace.',
      type: 'warning',
    } as const

    store.getState().appendEvent(runId, warning)
    store.getState().appendEvent(runId, warning)

    expect(store.getState().active?.warnings).toHaveLength(1)
  })

  it('drops warnings from the previous run when a new search starts', () => {
    const store = createSearchBufferStore()
    const firstRun = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })
    store.getState().appendEvent(firstRun, {
      code: 'file-limit-reached',
      message: 'Stopped after 2 files.',
      type: 'warning',
    })

    store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'other',
    })

    expect(store.getState().active?.warnings).toEqual([])
  })

  it('tracks loading, matches, completion, and grouping', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })

    store.getState().appendEvent(runId, {
      match: {
        kind: 'content',
        path: 'repo/src/app.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(runId, {
      count: 1,
      path: 'repo',
      query: 'needle',
      truncated: false,
      type: 'done',
    })

    const snapshot = store.getState().active
    expect(snapshot).toMatchObject({
      query: 'needle',
      status: 'ready',
      totalCount: 1,
      truncated: false,
    })
    expect(searchGroupsForSnapshot(snapshot)).toEqual([
      expect.objectContaining({
        name: 'app.ts',
        path: 'repo/src/app.ts',
      }),
    ])
  })

  it('hydrates cached search buffer metadata', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      caseSensitive: true,
      excludeGlobs: ['*.test.ts'],
      includeContent: true,
      includeGlobs: ['src/**/*.ts'],
      limit: 20,
      matchMode: 'regex',
      path: 'repo',
      query: 'needle',
      wholeWord: true,
    })
    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/app.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/app.ts', 2, 3), type: 'match' },
    ])
    store.getState().appendEvent(runId, doneEvent('needle', 2))
    store.getState().setReplaceVisible('repo', true)
    store.getState().setReplaceText('repo', 'pin')
    const selectedResultId = store.getState().active?.activeResultId ?? null
    store.getState().collapseAllGroups()
    const collapsedResultId = store.getState().active?.activeResultId ?? null

    const cached = cachedSearchBufferState(store.getState().active)
    const restored = createSearchBufferStore({
      cachedByRootPath: cached ? { [cached.rootPath]: cached } : {},
      rootPath: 'repo',
    })

    expect(selectedResultId).not.toBeNull()
    expect(collapsedResultId).not.toBe(selectedResultId)
    expect(cached?.matches).toHaveLength(2)
    expect(restored.getState().active).toMatchObject({
      activeResultId: collapsedResultId,
      caseSensitive: true,
      excludeGlobText: '*.test.ts',
      filtersVisible: true,
      includeGlobText: 'src/**/*.ts',
      matchMode: 'regex',
      query: 'needle',
      replaceText: 'pin',
      replaceVisible: true,
      resultsQuery: 'needle',
      status: 'ready',
      totalCount: 2,
      wholeWord: true,
    })
    expect(searchGroupsForSnapshot(restored.getState().active)).toEqual([
      expect.objectContaining({
        collapsed: true,
        count: 2,
        path: 'repo/src/app.ts',
      }),
    ])
  })

  it('sorts file groups with VS Code-style path and filename ordering', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))

    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/file-10.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/file-2.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/docs/file-1.ts', 1, 1), type: 'match' },
    ])

    expect(searchGroupsForSnapshot(store.getState().active).map((group) => group.path)).toEqual([
      'repo/docs/file-1.ts',
      'repo/src/file-2.ts',
      'repo/src/file-10.ts',
    ])
  })

  it('ignores stale events from previous runs', () => {
    const store = createSearchBufferStore()
    const staleRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'first',
    })
    const currentRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'second',
    })

    store.getState().appendEvent(staleRunId, {
      match: {
        kind: 'content',
        path: 'repo/stale.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(currentRunId, {
      count: 0,
      path: 'repo',
      query: 'second',
      truncated: false,
      type: 'done',
    })

    expect(store.getState().active).toMatchObject({
      matches: [],
      query: 'second',
      status: 'ready',
    })
  })

  it('keeps previous results visible while a new query is loading', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'first',
    })
    store.getState().appendEvent(firstRunId, {
      match: {
        kind: 'content',
        path: 'repo/first.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(firstRunId, {
      count: 1,
      path: 'repo',
      query: 'first',
      truncated: false,
      type: 'done',
    })

    store.getState().setQuery('repo', 'second')

    expect(store.getState().active).toMatchObject({
      matches: [expect.objectContaining({ path: 'repo/first.ts' })],
      query: 'second',
      resultsQuery: 'first',
      status: 'loading',
    })
  })

  it('keeps snapshot references stable for no-op text updates', () => {
    const store = createSearchBufferStore()
    store.getState().prepareBuffer('repo')
    store.getState().setQuery('repo', 'needle')
    const querySnapshot = store.getState().active

    store.getState().setQuery('repo', 'needle')

    expect(store.getState().active).toBe(querySnapshot)

    store.getState().setReplaceText('repo', 'pin')
    const replaceTextSnapshot = store.getState().active

    store.getState().setReplaceText('repo', 'pin')

    expect(store.getState().active).toBe(replaceTextSnapshot)

    store.getState().setReplaceVisible('repo', true)
    const replaceVisibleSnapshot = store.getState().active

    store.getState().setReplaceVisible('repo', true)

    expect(store.getState().active).toBe(replaceVisibleSnapshot)
  })

  it('keeps previous results visible while search options change', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      matchMode: 'literal',
      path: 'repo',
      query: 'needle',
    })
    store.getState().appendEvent(firstRunId, {
      match: {
        kind: 'content',
        path: 'repo/first.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(firstRunId, {
      count: 1,
      path: 'repo',
      query: 'needle',
      truncated: false,
      type: 'done',
    })

    store.getState().setSearchOptions('repo', { matchMode: 'regex' })

    expect(store.getState().active).toMatchObject({
      matches: [expect.objectContaining({ path: 'repo/first.ts' })],
      matchMode: 'regex',
      resultsQuery: 'needle',
      status: 'loading',
    })
  })

  it('preserves selected search options when a new run starts', () => {
    const store = createSearchBufferStore()

    store.getState().setQuery('repo', 'needle')
    store.getState().setSearchOptions('repo', {
      caseSensitive: true,
      excludeGlobText: '*.test.ts',
      filtersVisible: true,
      includeGlobText: 'src/**/*.ts',
      matchMode: 'regex',
      wholeWord: true,
    })
    store.getState().startSearch({
      caseSensitive: true,
      excludeGlobs: ['*.test.ts'],
      includeContent: true,
      includeGlobs: ['src/**/*.ts'],
      limit: 20,
      matchMode: 'regex',
      path: 'repo',
      query: 'needle',
      wholeWord: true,
    })

    expect(store.getState().active).toMatchObject({
      caseSensitive: true,
      excludeGlobText: '*.test.ts',
      filtersVisible: true,
      includeGlobText: 'src/**/*.ts',
      matchMode: 'regex',
      status: 'loading',
      wholeWord: true,
    })
  })

  it('preserves selected search options when the query is cleared', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      caseSensitive: true,
      excludeGlobs: ['*.test.ts'],
      includeContent: true,
      includeGlobs: ['src/**/*.ts'],
      limit: 20,
      matchMode: 'regex',
      path: 'repo',
      query: 'needle',
      wholeWord: true,
    })

    store.getState().appendEvent(runId, {
      match: {
        kind: 'content',
        path: 'repo/src/app.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().setSearchOptions('repo', {
      caseSensitive: true,
      excludeGlobText: '*.test.ts',
      filtersVisible: true,
      includeGlobText: 'src/**/*.ts',
      matchMode: 'regex',
      wholeWord: true,
    })
    store.getState().setQuery('repo', '')

    expect(store.getState().active).toMatchObject({
      caseSensitive: true,
      excludeGlobText: '*.test.ts',
      filtersVisible: true,
      includeGlobText: 'src/**/*.ts',
      matches: [],
      matchMode: 'regex',
      query: '',
      resultsQuery: '',
      status: 'idle',
      totalCount: 0,
      wholeWord: true,
    })
  })

  it('replaces previous results when options changed for the same query', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      matchMode: 'literal',
      path: 'repo',
      query: 'needle',
    })
    store.getState().appendEvent(firstRunId, {
      match: {
        kind: 'content',
        path: 'repo/literal.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(firstRunId, {
      count: 1,
      path: 'repo',
      query: 'needle',
      truncated: false,
      type: 'done',
    })

    store.getState().setSearchOptions('repo', { matchMode: 'regex' })
    const secondRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      matchMode: 'regex',
      path: 'repo',
      query: 'needle',
    })
    store.getState().appendEvent(secondRunId, {
      match: {
        kind: 'content',
        path: 'repo/regex.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })

    expect(store.getState().active).toMatchObject({
      matches: [expect.objectContaining({ path: 'repo/regex.ts' })],
      resultsQuery: 'needle',
      resultsSearchQuery: expect.objectContaining({ matchMode: 'regex' }),
      status: 'loading',
    })
  })

  it('replaces previous results when the next query returns its first match', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'first',
    })
    store.getState().appendEvent(firstRunId, {
      match: {
        kind: 'content',
        path: 'repo/first.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(firstRunId, {
      count: 1,
      path: 'repo',
      query: 'first',
      truncated: false,
      type: 'done',
    })

    const secondRunId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'second',
    })
    store.getState().appendEvent(secondRunId, {
      match: {
        kind: 'content',
        path: 'repo/second.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })

    expect(store.getState().active).toMatchObject({
      matches: [expect.objectContaining({ path: 'repo/second.ts' })],
      resultsQuery: 'second',
      status: 'loading',
      totalCount: 1,
    })
  })

  it('keeps previous visible rows while a related query streams partial batches', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch(searchQuery('c'))
    const firstMatch = contentMatch('repo/src/app.ts', 1, 1)
    const secondMatch = contentMatch('repo/src/app.ts', 2, 1)
    store
      .getState()
      .appendEvents(firstRunId, [
        { match: firstMatch, type: 'match' },
        { match: secondMatch, type: 'match' },
        doneEvent('c', 2),
      ])

    const previousGroups = searchGroupsForSnapshot(store.getState().active)
    const previousIds = searchResultItems(previousGroups).map((item) => item.id)
    const secondRunId = store.getState().startSearch(searchQuery('co'))
    expect(store.getState().active).toMatchObject({
      status: 'loading',
      totalCount: 2,
    })

    store.getState().appendEvent(secondRunId, {
      match: { ...firstMatch, endColumn: 3, preview: 'const value' },
      type: 'match',
    })

    const streamingGroups = searchGroupsForSnapshot(store.getState().active)
    const streamingItems = searchResultItems(streamingGroups, {
      pendingResultIds: store.getState().active?.pendingResultIds,
    })
    expect(streamingItems.map((item) => item.id)).toEqual(previousIds)
    expect(
      streamingItems.filter((item) => item.type === 'match').map((item) => item.pending),
    ).toEqual([false, true])
    expect(store.getState().active).toMatchObject({
      resultsQuery: 'co',
      totalCount: 1,
    })

    store.getState().appendEvent(secondRunId, {
      match: { ...secondMatch, endColumn: 3, preview: 'const value' },
      type: 'match',
    })
    const fullyConfirmedItems = searchResultItems(
      searchGroupsForSnapshot(store.getState().active),
      {
        pendingResultIds: store.getState().active?.pendingResultIds,
      },
    )
    expect(fullyConfirmedItems.map((item) => item.id)).toEqual(previousIds)
    expect(
      fullyConfirmedItems.filter((item) => item.type === 'match').map((item) => item.pending),
    ).toEqual([false, false])
    expect(store.getState().active).toMatchObject({
      pendingResultIds: [],
      totalCount: 2,
    })

    store.getState().appendEvent(secondRunId, doneEvent('co', 2))
    const readyGroups = searchGroupsForSnapshot(store.getState().active)
    expect(readyGroups).not.toBe(previousGroups)
    expect(searchResultItems(readyGroups).map((item) => item.id)).toEqual(previousIds)
  })

  it('reconciles same-query refreshes without duplicating visible rows', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch(searchQuery('needle'))
    const firstMatch = contentMatch('repo/src/app.ts', 1, 1)
    const secondMatch = contentMatch('repo/src/app.ts', 2, 1)
    store
      .getState()
      .appendEvents(firstRunId, [
        { match: firstMatch, type: 'match' },
        { match: secondMatch, type: 'match' },
        doneEvent('needle', 2),
      ])

    const previousGroups = searchGroupsForSnapshot(store.getState().active)
    const previousIds = searchResultItems(previousGroups).map((item) => item.id)
    const secondRunId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvent(secondRunId, {
      match: { ...firstMatch },
      type: 'match',
    })

    const streamingItems = searchResultItems(searchGroupsForSnapshot(store.getState().active), {
      pendingResultIds: store.getState().active?.pendingResultIds,
    })

    expect(streamingItems.map((item) => item.id)).toEqual(previousIds)
    expect(streamingItems.filter((item) => item.type === 'match')).toHaveLength(2)
    expect(
      streamingItems.filter((item) => item.type === 'match').map((item) => item.pending),
    ).toEqual([false, true])
  })

  it('prunes unconfirmed pending rows when related streaming finishes', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch(searchQuery('c'))
    const firstMatch = contentMatch('repo/src/app.ts', 1, 1)
    const secondMatch = contentMatch('repo/src/app.ts', 2, 1)
    store
      .getState()
      .appendEvents(firstRunId, [
        { match: firstMatch, type: 'match' },
        { match: secondMatch, type: 'match' },
        doneEvent('c', 2),
      ])

    const previousGroups = searchGroupsForSnapshot(store.getState().active)
    const previousMatchIds = searchResultItems(previousGroups)
      .filter((item) => item.type === 'match')
      .map((item) => item.id)
    const secondRunId = store.getState().startSearch(searchQuery('co'))
    store.getState().appendEvent(secondRunId, {
      match: { ...firstMatch, endColumn: 3, preview: 'const value' },
      type: 'match',
    })

    expect(store.getState().active?.pendingResultIds).toContain(previousMatchIds[1])

    store.getState().appendEvent(secondRunId, doneEvent('co', 1))
    const readyMatchIds = searchResultItems(searchGroupsForSnapshot(store.getState().active))
      .filter((item) => item.type === 'match')
      .map((item) => item.id)

    expect(readyMatchIds).toEqual([previousMatchIds[0]])
    expect(store.getState().active).toMatchObject({
      pendingResultIds: [],
      status: 'ready',
      totalCount: 1,
    })
  })

  it('appends batched events and can collapse file groups', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })

    store.getState().appendEvents(runId, [
      {
        match: {
          kind: 'content',
          path: 'repo/src/app.ts',
          source: 'disk',
          type: 'file',
        },
        type: 'match',
      },
      {
        match: {
          kind: 'content',
          path: 'repo/src/app.ts',
          source: 'disk',
          type: 'file',
        },
        type: 'match',
      },
    ])
    store.getState().toggleGroup('repo/src/app.ts')

    expect(searchGroupsForSnapshot(store.getState().active)).toEqual([
      expect.objectContaining({
        collapsed: true,
        count: 2,
        path: 'repo/src/app.ts',
      }),
    ])
  })

  it('renders filename-only hits as one virtual row', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })

    store.getState().appendEvent(runId, {
      match: {
        kind: 'name',
        path: 'repo/src/needle.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })

    expect(searchResultItems(searchGroupsForSnapshot(store.getState().active))).toEqual([
      expect.objectContaining({ type: 'name' }),
    ])
  })

  it('keeps filename hits out of content group counts', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      includeContent: true,
      includeNames: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })

    store.getState().appendEvents(runId, [
      {
        match: {
          kind: 'name',
          path: 'repo/src/needle.ts',
          source: 'disk',
          type: 'file',
        },
        type: 'match',
      },
      {
        match: {
          column: 1,
          endColumn: 7,
          kind: 'content',
          line: 1,
          path: 'repo/src/needle.ts',
          source: 'disk',
          type: 'file',
        },
        type: 'match',
      },
    ])

    const groups = searchGroupsForSnapshot(store.getState().active)
    const items = searchResultItems(groups)

    expect(groups).toEqual([
      expect.objectContaining({
        count: 1,
        matches: [
          expect.objectContaining({ kind: 'name' }),
          expect.objectContaining({ kind: 'content' }),
        ],
      }),
    ])
    expect(items).toEqual([
      expect.objectContaining({
        group: expect.objectContaining({ count: 1 }),
        type: 'group',
      }),
      expect.objectContaining({
        match: expect.objectContaining({ kind: 'content' }),
        type: 'match',
      }),
    ])
  })

  it('persists replace state across reruns and clears replace status on query changes', () => {
    const store = createSearchBufferStore()

    store.getState().prepareBuffer('repo')
    store.getState().setReplaceVisible('repo', true)
    store.getState().setReplaceText('repo', 'pin')
    store.getState().finishReplace(store.getState().startReplace('repo')!, '1 match replaced.')
    store.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })

    expect(store.getState().active).toMatchObject({
      replaceMessage: '1 match replaced.',
      replaceStatus: 'success',
      replaceText: 'pin',
      replaceVisible: true,
    })

    store.getState().setQuery('repo', 'other')

    expect(store.getState().active).toMatchObject({
      query: 'other',
      replaceMessage: null,
      replaceStatus: 'idle',
      replaceText: 'pin',
      replaceVisible: true,
    })
  })

  it('requests a search refresh for the current query', () => {
    const store = createSearchBufferStore()
    store.getState().prepareBuffer('repo')
    store.getState().setQuery('repo', 'needle')
    const before = store.getState().active?.searchRevision

    store.getState().requestSearchRefresh('repo')

    expect(store.getState().active).toMatchObject({
      query: 'needle',
      searchRevision: (before ?? 0) + 1,
      status: 'loading',
    })
  })

  it('requests a search refresh for a whitespace-only query', () => {
    const store = createSearchBufferStore()
    store.getState().prepareBuffer('repo')
    store.getState().setQuery('repo', '  ')
    const before = store.getState().active?.searchRevision

    store.getState().requestSearchRefresh('repo')

    expect(store.getState().active).toMatchObject({
      query: '  ',
      searchRevision: (before ?? 0) + 1,
      status: 'loading',
    })
  })

  it('does not force a stale debounced search when the query is cleared', () => {
    const store = createSearchBufferStore()
    store.getState().prepareBuffer('repo')
    store.getState().setQuery('repo', 'n')
    const before = store.getState().active?.searchRevision

    store.getState().setQuery('repo', '')

    expect(store.getState().active).toMatchObject({
      query: '',
      searchRevision: before,
      status: 'idle',
    })
  })

  it('preserves meaningful search query whitespace in history', () => {
    const store = createSearchBufferStore()
    store.getState().startSearch(searchQuery(' beta '))
    store.getState().setQuery('repo', 'draft')

    store.getState().selectPreviousQuery('repo')

    expect(store.getState().active).toMatchObject({
      query: ' beta ',
      queryHistory: [' beta '],
    })
  })

  it('navigates search query history with a restorable draft', () => {
    const store = createSearchBufferStore()
    store.getState().startSearch(searchQuery('alpha'))
    store.getState().startSearch(searchQuery('beta'))
    store.getState().setQuery('repo', 'draft')

    store.getState().selectPreviousQuery('repo')
    expect(store.getState().active).toMatchObject({
      query: 'beta',
      queryHistoryCursor: 1,
      queryHistoryDraft: 'draft',
      status: 'loading',
    })

    store.getState().selectPreviousQuery('repo')
    expect(store.getState().active).toMatchObject({
      query: 'alpha',
      queryHistoryCursor: 0,
      queryHistoryDraft: 'draft',
    })

    store.getState().selectPreviousQuery('repo')
    expect(store.getState().active).toMatchObject({
      query: 'alpha',
      queryHistoryCursor: 0,
      queryHistoryDraft: 'draft',
    })

    store.getState().selectNextQuery('repo')
    expect(store.getState().active).toMatchObject({
      query: 'beta',
      queryHistoryCursor: 1,
      queryHistoryDraft: 'draft',
    })

    store.getState().selectNextQuery('repo')
    expect(store.getState().active).toMatchObject({
      query: 'draft',
      queryHistoryCursor: null,
      queryHistoryDraft: null,
    })
  })

  it('preserves history order while a historical query reruns', () => {
    const store = createSearchBufferStore()
    store.getState().startSearch(searchQuery('alpha'))
    store.getState().startSearch(searchQuery('beta'))
    store.getState().selectPreviousQuery('repo')

    store.getState().startSearch(searchQuery('alpha'))

    expect(store.getState().active).toMatchObject({
      query: 'alpha',
      queryHistory: ['alpha', 'beta'],
      queryHistoryCursor: 0,
    })

    store.getState().selectNextQuery('repo')

    expect(store.getState().active).toMatchObject({
      query: 'beta',
      queryHistory: ['alpha', 'beta'],
      queryHistoryCursor: 1,
    })
  })

  it('navigates replace text history with a restorable draft', () => {
    const store = createSearchBufferStore()
    store.getState().prepareBuffer('repo')
    store.getState().setReplaceText('repo', 'alpha')
    store.getState().startReplace('repo')
    store.getState().setReplaceText('repo', 'beta')
    store.getState().startReplace('repo')
    store.getState().setReplaceText('repo', 'draft')

    store.getState().selectPreviousReplaceText('repo')
    expect(store.getState().active).toMatchObject({
      replaceHistoryCursor: 1,
      replaceHistoryDraft: 'draft',
      replaceText: 'beta',
    })

    store.getState().selectPreviousReplaceText('repo')
    expect(store.getState().active).toMatchObject({
      replaceHistoryCursor: 0,
      replaceHistoryDraft: 'draft',
      replaceText: 'alpha',
    })

    store.getState().selectPreviousReplaceText('repo')
    expect(store.getState().active).toMatchObject({
      replaceHistoryCursor: 0,
      replaceHistoryDraft: 'draft',
      replaceText: 'alpha',
    })

    store.getState().selectNextReplaceText('repo')
    expect(store.getState().active).toMatchObject({
      replaceHistoryCursor: 1,
      replaceHistoryDraft: 'draft',
      replaceText: 'beta',
    })

    store.getState().selectNextReplaceText('repo')
    expect(store.getState().active).toMatchObject({
      replaceHistoryCursor: null,
      replaceHistoryDraft: null,
      replaceText: 'draft',
    })
  })

  it('preserves replace history order while a historical replacement reruns', () => {
    const store = createSearchBufferStore()
    store.getState().prepareBuffer('repo')
    store.getState().setReplaceText('repo', 'alpha')
    store.getState().startReplace('repo')
    store.getState().setReplaceText('repo', 'beta')
    store.getState().startReplace('repo')
    store.getState().selectPreviousReplaceText('repo')

    store.getState().startReplace('repo')

    expect(store.getState().active).toMatchObject({
      replaceHistory: ['alpha', 'beta'],
      replaceHistoryCursor: 0,
      replaceText: 'alpha',
    })

    store.getState().selectNextReplaceText('repo')

    expect(store.getState().active).toMatchObject({
      replaceHistory: ['alpha', 'beta'],
      replaceHistoryCursor: 1,
      replaceText: 'beta',
    })
  })

  it('preserves meaningful replacement whitespace in history', () => {
    const store = createSearchBufferStore()
    store.getState().prepareBuffer('repo')
    store.getState().setReplaceText('repo', ' beta ')
    store.getState().startReplace('repo')
    store.getState().setReplaceText('repo', 'draft')

    store.getState().selectPreviousReplaceText('repo')

    expect(store.getState().active).toMatchObject({
      replaceHistory: [' beta '],
      replaceText: ' beta ',
    })
  })

  it('keeps stable row ids while result batches append', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))

    store.getState().appendEvent(runId, {
      match: contentMatch('repo/src/app.ts', 1, 2),
      type: 'match',
    })
    const firstItems = searchResultItems(searchGroupsForSnapshot(store.getState().active))
    const firstMatchId = firstItems.find((item) => item.type === 'match')?.id

    store.getState().appendEvent(runId, {
      match: contentMatch('repo/src/app.ts', 2, 4),
      type: 'match',
    })
    const nextItems = searchResultItems(searchGroupsForSnapshot(store.getState().active))

    expect(nextItems.find((item) => item.type === 'match')?.id).toBe(firstMatchId)
  })

  it('keeps unchanged file groups referentially stable while batches append', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    const firstMatch = contentMatch('repo/src/a.ts', 1, 1)
    const secondMatch = contentMatch('repo/src/b.ts', 1, 1)
    store.getState().appendEvents(runId, [
      { match: firstMatch, type: 'match' },
      { match: secondMatch, type: 'match' },
    ])

    const firstGroups = searchGroupsForSnapshot(store.getState().active)
    const firstGroup = groupByPath(firstGroups, 'repo/src/a.ts')
    const secondGroup = groupByPath(firstGroups, 'repo/src/b.ts')
    const secondGroupFirstMatch = secondGroup?.matches[0]

    store.getState().appendEvent(runId, {
      match: contentMatch('repo/src/b.ts', 2, 1),
      type: 'match',
    })

    const nextGroups = searchGroupsForSnapshot(store.getState().active)
    expect(groupByPath(nextGroups, 'repo/src/a.ts')).toBe(firstGroup)
    expect(groupByPath(nextGroups, 'repo/src/b.ts')).not.toBe(secondGroup)
    expect(groupByPath(nextGroups, 'repo/src/b.ts')?.matches[0]).toBe(secondGroupFirstMatch)
  })

  it('keeps streamed result groups stable when the search finishes', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))

    store.getState().appendEvent(runId, {
      match: contentMatch('repo/src/app.ts', 1, 1),
      type: 'match',
    })
    const streamingGroups = searchGroupsForSnapshot(store.getState().active)
    const streamingMatches = store.getState().active?.matches

    store.getState().appendEvent(runId, doneEvent('needle', 1))

    expect(searchGroupsForSnapshot(store.getState().active)).toBe(streamingGroups)
    expect(store.getState().active?.matches).toBe(streamingMatches)
    expect(store.getState().active).toMatchObject({
      status: 'ready',
      totalCount: 1,
    })
  })

  it('returns stored group references instead of rebuilding derived groups', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvent(runId, {
      match: contentMatch('repo/src/app.ts', 1, 1),
      type: 'match',
    })

    const groups = searchGroupsForSnapshot(store.getState().active)
    const items = searchResultItems(groups)
    const firstItem = items[0]

    expect(searchGroupsForSnapshot(store.getState().active)).toBe(groups)
    expect(firstItem?.type).toBe('group')
    if (firstItem?.type !== 'group') {
      throw new Error('Expected a grouped content search result.')
    }
    expect(firstItem.group).toBe(groups[0])
  })

  it('collapses and expands all content result groups', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/a.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/b.ts', 1, 1), type: 'match' },
    ])

    store.getState().collapseAllGroups()

    expect(searchGroupsForSnapshot(store.getState().active)).toEqual([
      expect.objectContaining({ collapsed: true, path: 'repo/src/a.ts' }),
      expect.objectContaining({ collapsed: true, path: 'repo/src/b.ts' }),
    ])

    store.getState().expandAllGroups()

    expect(searchGroupsForSnapshot(store.getState().active)).toEqual([
      expect.objectContaining({ collapsed: false, path: 'repo/src/a.ts' }),
      expect.objectContaining({ collapsed: false, path: 'repo/src/b.ts' }),
    ])
  })

  it('maps the active match to its parent when a group collapses', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/app.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/app.ts', 2, 1), type: 'match' },
    ])

    const expandedItems = expandedSearchResultItems(
      searchGroupsForSnapshot(store.getState().active),
    )
    const selected = expandedItems.find((item) => item.type === 'match' && item.match.line === 2)
    const parentId = parentSearchResultId(expandedItems, selected?.id ?? null)
    store.getState().selectResult(selected?.id ?? null)
    store.getState().toggleGroup('repo/src/app.ts')

    expect(store.getState().active?.activeResultId).toBe(parentId)
  })

  it('keeps duplicate content result ids distinct', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/app.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/app.ts', 1, 1), type: 'match' },
    ])

    const matches = expandedSearchResultItems(
      searchGroupsForSnapshot(store.getState().active),
    ).filter((item) => item.type === 'match')

    expect(matches).toHaveLength(2)
    expect(matches[0]?.id).not.toBe(matches[1]?.id)
  })

  it('remaps an active filename hit when content arrives for the same file', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch({
      includeContent: true,
      includeNames: true,
      limit: 20,
      path: 'repo',
      query: 'needle',
    })

    store.getState().appendEvent(runId, {
      match: {
        kind: 'name',
        path: 'repo/src/needle.ts',
        source: 'disk',
        type: 'file',
      },
      type: 'match',
    })
    store.getState().appendEvent(runId, {
      match: contentMatch('repo/src/needle.ts', 1, 1),
      type: 'match',
    })

    const items = searchResultItems(searchGroupsForSnapshot(store.getState().active))
    const activeItem = searchResultItemById(items, store.getState().active?.activeResultId ?? null)

    expect(activeItem?.type).toBe('match')
  })

  it('prunes collapsed paths that disappear after a rerun', () => {
    const store = createSearchBufferStore()
    const firstRunId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvents(firstRunId, [
      { match: contentMatch('repo/src/a.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/b.ts', 1, 1), type: 'match' },
    ])
    store.getState().appendEvent(firstRunId, doneEvent('needle', 2))
    store.getState().collapseAllGroups()

    const secondRunId = store.getState().startSearch(searchQuery('other'))
    store.getState().appendEvent(secondRunId, {
      match: contentMatch('repo/src/a.ts', 2, 1),
      type: 'match',
    })
    store.getState().appendEvent(secondRunId, doneEvent('other', 1))

    expect(store.getState().active?.collapsedPaths).toEqual(['repo/src/a.ts'])
  })

  it('defaults active selection and wraps next and previous match selection', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/a.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/a.ts', 2, 1), type: 'match' },
      { match: contentMatch('repo/src/b.ts', 1, 1), type: 'match' },
    ])

    expect(activeMatchPosition(store.getState().active)).toEqual({
      index: 1,
      total: 3,
    })

    store.getState().selectNextMatch()
    expect(activeMatchPosition(store.getState().active)).toEqual({
      index: 2,
      total: 3,
    })

    store.getState().selectNextMatch()
    store.getState().selectNextMatch()
    expect(activeMatchPosition(store.getState().active)).toEqual({
      index: 1,
      total: 3,
    })

    store.getState().selectPreviousMatch()
    expect(activeMatchPosition(store.getState().active)).toEqual({
      index: 3,
      total: 3,
    })
  })

  it('expands a collapsed parent when selecting a hidden match', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/app.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/app.ts', 2, 1), type: 'match' },
    ])
    store.getState().collapseAllGroups()

    const hiddenMatch = expandedSearchResultItems(
      searchGroupsForSnapshot(store.getState().active),
    ).find((item) => item.type === 'match' && item.match.line === 2)
    store.getState().selectResult(hiddenMatch?.id ?? null)

    expect(searchGroupsForSnapshot(store.getState().active)).toEqual([
      expect.objectContaining({ collapsed: false, path: 'repo/src/app.ts' }),
    ])
    expect(store.getState().active?.activeResultId).toBe(hiddenMatch?.id)
  })

  it('provides bounded row movement helpers for tree keyboard navigation', () => {
    const store = createSearchBufferStore()
    const runId = store.getState().startSearch(searchQuery('needle'))
    store.getState().appendEvents(runId, [
      { match: contentMatch('repo/src/app.ts', 1, 1), type: 'match' },
      { match: contentMatch('repo/src/app.ts', 2, 1), type: 'match' },
    ])

    const items = searchResultItems(searchGroupsForSnapshot(store.getState().active))
    const groupId = firstSearchResultId(items)
    const childId = firstSearchResultChildId(items, groupId ?? '') ?? null

    expect(searchResultIdByOffset({ activeResultId: null, items, offset: 1 })).toBe(groupId)
    expect(searchResultIdByOffset({ activeResultId: groupId, items, offset: 1 })).toBe(childId)
    expect(parentSearchResultId(items, childId ?? null)).toBe(groupId)
    expect(lastSearchResultId(items)).toBe(items.at(-1)?.id ?? null)
  })
})

function searchQuery(query: string) {
  return {
    includeContent: true,
    limit: 20,
    path: 'repo',
    query,
  }
}

function contentMatch(path: string, line: number, column: number): WorkspaceSearchMatch {
  return {
    column,
    endColumn: column + 6,
    kind: 'content',
    line,
    path,
    preview: 'needle',
    source: 'disk',
    type: 'file',
  }
}

function doneEvent(query: string, count: number) {
  return {
    count,
    path: 'repo',
    query,
    truncated: false,
    type: 'done' as const,
  }
}

function activeMatchPosition(snapshot: SearchBufferSnapshot | null) {
  return searchResultActiveMatchPosition(
    expandedSearchResultItems(searchGroupsForSnapshot(snapshot)),
    snapshot?.activeResultId ?? null,
  )
}

function groupByPath(groups: ReturnType<typeof searchGroupsForSnapshot>, path: string) {
  return groups.find((group) => group.path === path)
}

it('ignores a completion after reset to the same root and leaves its new request running', () => {
  const store = createSearchBufferStore()
  store.getState().prepareBuffer('repo')
  const old = store.getState().startReplace('repo')!
  store.getState().resetBuffer('repo')
  const current = store.getState().startReplace('repo')!
  const before = store.getState().active
  store.getState().finishReplace(old, 'Old result', true)
  store.getState().failReplace(old, 'Old failure')
  expect(store.getState().active).toBe(before)
  expect(store.getState().active?.replaceRequest).toBe(current)
  expect(store.getState().active?.replaceStatus).toBe('running')
})

it('settles an owned parked buffer without altering the selected root', () => {
  const store = createSearchBufferStore()
  store.getState().prepareBuffer('repo')
  const token = store.getState().startReplace('repo')!
  store.getState().switchWorkspace('other')
  const before = store.getState().active
  store.getState().finishReplace(token, 'Done')
  expect(store.getState().active).toBe(before)
  expect(store.getState().parked.get('repo')?.replaceStatus).toBe('success')
  store.getState().switchWorkspace('repo')
  expect(store.getState().active?.replaceRequest).toBeNull()
  expect(store.getState().active?.replaceStatus).toBe('success')
})

it('settles an earlier result generation without refreshing newer search inputs', () => {
  const store = createSearchBufferStore()
  store.getState().prepareBuffer('repo')
  const token = store.getState().startReplace('repo')!
  store.getState().startSearch({ path: 'repo', query: 'new', includeContent: true, limit: 20 })
  const revision = store.getState().active?.searchRevision
  const runId = store.getState().active?.runId
  store.getState().finishReplace(token, 'Old result', true)
  expect(store.getState().active).toMatchObject({
    replaceStatus: 'idle',
    replaceMessage: null,
    replaceRequest: null,
    query: 'new',
    runId,
    searchRevision: revision,
  })
})

it('an old replacement cannot settle a newer request in the same incarnation', () => {
  const store = createSearchBufferStore()
  store.getState().prepareBuffer('repo')
  const first = store.getState().startReplace('repo')!
  store.getState().setReplaceText('repo', 'new')
  const second = store.getState().startReplace('repo')!
  store.getState().finishReplace(first, 'Old', true)
  expect(store.getState().active).toMatchObject({
    replaceRequest: second,
    replaceStatus: 'running',
    replaceMessage: null,
    replaceText: 'new',
  })
  store.getState().finishReplace(second, 'New')
  expect(store.getState().active).toMatchObject({
    replaceRequest: null,
    replaceStatus: 'success',
    replaceMessage: 'New',
  })
})
