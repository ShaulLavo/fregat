import {
  groupLeaf,
  groupTree,
  groupBranch,
  groupTab,
} from '../../../../test/factories/editor-groups'
import { editorTabRecordsForWorkbenchPanels } from '@/features/workbench/utils/panels'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import {
  testTabContents,
  testNullableTabContent,
  testTabContent,
  testScrollPositions,
} from '../../../../test/factories/document-targets'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import {
  createDefaultWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { FileResult, PickedFsEntry } from '@/lib/file-system-types'
import type {
  CachedSearchBufferState,
  CachedWorkspaceSlice,
  CachedWorkspaceState,
} from '@/features/workspace/state/cache'
import {
  subscribeWorkspaceCachePersistence,
  type WorkspaceCacheWriters,
} from '@/features/workspace/hooks/use-cache-persistence'

type CacheWrite =
  | {
      chatModePanels: CachedWorkspaceState['chatModePanels']
      key: 'chatModePanels'
    }
  | {
      key: 'uiMode'
      uiMode: CachedWorkspaceState['uiMode']
    }
  | {
      key: 'rootFolder'
      rootFolder: PickedFsEntry | null
    }
  | {
      key: 'searchBuffer'
      rootPath: string
      searchBuffer: CachedSearchBufferState | null
    }
  | {
      key: 'workbenchLayout'
      workbenchLayout: CachedWorkspaceState['workbenchLayout']
    }
  | {
      key: 'workspaceIndex'
      rootPaths: readonly string[]
    }
  | {
      key: 'workspaceSlice'
      rootPath: string
      slice: CachedWorkspaceSlice
    }
describe('workspace cache persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not persist every streaming search match batch', () => {
    const { searchStore, unsubscribe, writes } = harness()
    const runId = searchStore.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: '/repo',
      query: 'needle',
    })

    vi.runAllTimers()
    expect(writeKeys(writes)).toEqual(['searchBuffer'])
    expect(lastCacheWrite(writes, 'searchBuffer')?.searchBuffer).toMatchObject({
      query: 'needle',
      resultsQuery: '',
      totalCount: 0,
    })

    searchStore.getState().appendEvents(runId, [
      {
        match: { kind: 'content', path: '/repo/src/app.ts', source: 'disk', type: 'file' },
        type: 'match',
      },
    ])

    vi.runAllTimers()
    expect(writeKeys(writes)).toEqual(['searchBuffer'])

    searchStore.getState().appendEvent(runId, {
      count: 1,
      path: '/repo',
      query: 'needle',
      truncated: false,
      type: 'done',
    })

    vi.runAllTimers()
    expect(writeKeys(writes)).toEqual(['searchBuffer', 'searchBuffer'])
    expect(lastCacheWrite(writes, 'searchBuffer')).toMatchObject({
      rootPath: '/repo',
      searchBuffer: {
        matches: [expect.objectContaining({ path: '/repo/src/app.ts' })],
        query: 'needle',
        resultsQuery: 'needle',
        totalCount: 1,
      },
    })

    unsubscribe()
  })

  it('ignores transient workspace picker and denormalized selection state', () => {
    const { unsubscribe, workspaceStore, writes } = harness()

    workspaceStore.getState().setPickerOpen(true)
    vi.runAllTimers()
    expect(writes).toHaveLength(0)

    workspaceStore.setState({
      openTabContents: testTabContents(['/repo/src/a.ts']),
      selectedTabContent: testNullableTabContent('/repo/src/a.ts'),
    })
    vi.runAllTimers()
    expect(writes).toHaveLength(0)

    workspaceStore
      .getState()
      .setWorkbenchPanels(
        openEditorContentInWorkbenchPanels(
          workspaceStore.getState().workbenchPanels,
          testTabContent('/repo/src/a.ts'),
        ),
      )
    vi.runAllTimers()
    expect(writeKeys(writes)).toEqual(['workspaceSlice'])
    expect(lastCacheWrite(writes, 'workspaceSlice')).toMatchObject({
      rootPath: '/repo',
      slice: {
        workbenchPanels: {
          editorGroups: { root: { tabs: [{ content: testTabContent('/repo/src/a.ts') }] } },
        },
      },
    })

    unsubscribe()
  })

  it('writes only the cache key owned by the changed workspace field', () => {
    const { unsubscribe, workspaceStore, writes } = harness()

    // Must differ from DEFAULT_DIFF_VIEW_MODE, or the store short-circuits and
    // there is no change for the persistence hook to write.
    vi.runAllTimers()

    writes.length = 0

    writes.length = 0
    workspaceStore.getState().setEditorHistory(testTabContents(['/repo/src/a.ts']))
    vi.runAllTimers()
    expect(writeKeys(writes)).toEqual(['workspaceSlice'])
    expect(lastCacheWrite(writes, 'workspaceSlice')).toMatchObject({
      rootPath: '/repo',
      slice: { editorHistory: testTabContents(['/repo/src/a.ts']) },
    })

    unsubscribe()
  })

  it('files a switched-away project under its own key and records the new order', () => {
    const { unsubscribe, workspaceStore, writes } = harness()
    workspaceStore.getState().setEditorHistory(testTabContents(['/repo/src/a.ts']))
    vi.runAllTimers()
    writes.length = 0

    workspaceStore.getState().switchWorkspace(pickedDirectory('/other'))
    vi.runAllTimers()

    // The parked slice is the same object the active writer already stored, so the
    // switch costs an index write and a first write for the newly opened project.
    expect(lastCacheWrite(writes, 'workspaceIndex')?.rootPaths).toEqual(['/other', '/repo'])
    expect(cacheWrites(writes, 'workspaceSlice').map((write) => write.rootPath)).toEqual(['/other'])

    unsubscribe()
  })

  it('keeps writing a parked project’s results to that project’s key', () => {
    const { searchStore, unsubscribe, workspaceStore, writes } = harness()
    searchStore.getState().startSearch({
      includeContent: true,
      limit: 20,
      path: '/repo',
      query: 'needle',
    })
    vi.runAllTimers()
    writes.length = 0

    workspaceStore.getState().switchWorkspace(pickedDirectory('/other'))
    searchStore.getState().switchWorkspace('/other')
    searchStore.getState().setQuery('/other', 'haystack')
    vi.runAllTimers()

    expect(cacheWrites(writes, 'searchBuffer').map((write) => write.rootPath)).toEqual(['/other'])
    expect(lastCacheWrite(writes, 'searchBuffer')?.searchBuffer).toMatchObject({
      query: 'haystack',
      rootPath: '/other',
    })

    unsubscribe()
  })

  it('writes editor scroll positions into the workspace slice keyed by path', () => {
    const { documentStore, unsubscribe, workspaceStore, writes } = harness()
    workspaceStore
      .getState()
      .setWorkbenchPanels(
        openEditorContentInWorkbenchPanels(
          workspaceStore.getState().workbenchPanels,
          testTabContent('/repo/src/a.ts'),
        ),
      )
    vi.runAllTimers()
    writes.length = 0

    const tab = editorTabRecordsForWorkbenchPanels(workspaceStore.getState().workbenchPanels)[0]
    expect(tab).toBeTruthy()
    documentStore.getState().ensureEditorView(tabId(tab!.id), fileResult('/repo/src/a.ts'))
    documentStore.getState().setEditorViewScrollPosition(tabId(tab!.id), { left: 0, top: 240 })
    vi.runAllTimers()
    expect(lastCacheWrite(writes, 'workspaceSlice')?.slice.reopenScrollPositions).toEqual(
      testScrollPositions({
        '/repo/src/a.ts': { left: 0, top: 240 },
      }),
    )
    unsubscribe()
  })
  it('flushes each view before workspace switching and restores each scroll independently', () => {
    const { documentStore, workspaceStore, writes, unsubscribe } = harness()
    const first = groupTab('view-first', '/repo/src/a.ts')
    const second = groupTab('view-second', '/repo/src/a.ts')
    const state = workspaceStore.getState()
    state.setWorkbenchPanels({
      ...state.workbenchPanels,
      editorGroups: groupTree(
        groupBranch('split', 'horizontal', [
          { node: groupLeaf('left', [first]), size: 50 },
          { node: groupLeaf('right', [second]), size: 50 },
        ]),
        'right',
      ),
    })
    documentStore.getState().ensureEditorView(first.id, fileResult('/repo/src/a.ts'))
    documentStore.getState().ensureEditorView(second.id, fileResult('/repo/src/a.ts'))
    documentStore
      .getState()
      .setEditorViewScrollPosition(first.id, { left: 10, top: 140 }, { left: 10, top: 100 })
    documentStore
      .getState()
      .setEditorViewScrollPosition(second.id, { left: 0, top: 820 }, { left: 0, top: 700 })
    workspaceStore.getState().switchWorkspace(pickedDirectory('/other'))
    unsubscribe()
    const slice = writes.findLast(
      (write) => write.key === 'workspaceSlice' && write.rootPath === '/repo',
    )
    if (!slice || slice.key !== 'workspaceSlice')
      return expect.unreachable('Outgoing workspace was not persisted')
    expect(slice.slice.reopenScrollPositions).toEqual([
      { content: first.content, position: { left: 0, top: 700 } },
    ])
    expect(slice.slice.viewScrollPositions).toEqual([
      { tabId: first.id, position: { left: 10, top: 140 } },
      { tabId: second.id, position: { left: 0, top: 820 } },
    ])
    const restored = createEditorDocumentStore({
      scrollPositionSeeds: slice.slice.reopenScrollPositions,
      viewScrollPositionSeeds: slice.slice.viewScrollPositions,
    })
    expect(
      restored.getState().ensureEditorView(first.id, fileResult('/repo/src/a.ts')).scrollPosition,
    ).toEqual({ left: 10, top: 140 })
    expect(
      restored.getState().ensureEditorView(second.id, fileResult('/repo/src/a.ts')).scrollPosition,
    ).toEqual({ left: 0, top: 820 })
  })
})

function harness() {
  const documentStore = createEditorDocumentStore()
  const workspaceStore = createEditorWorkspaceStore(cachedWorkspace())
  const searchStore = createSearchBufferStore()
  const writes: CacheWrite[] = []
  const unsubscribe = subscribeWorkspaceCachePersistence({
    storage: testScopedStorage,
    cacheWriters: recordingCacheWriters(writes),
    documentStore,
    searchStore,
    workspaceStore,
  })

  return { documentStore, searchStore, unsubscribe, workspaceStore, writes }
}

function cachedWorkspace(): CachedWorkspaceState {
  return {
    chatModePanels: createDefaultChatModePanels(),
    rootFolder: pickedDirectory('/repo'),
    searchBuffers: {},
    uiMode: 'workbench',
    workbenchLayout: createDefaultWorkbenchLayout(),
    worktreeIdByRootPath: {},
    workspaceOrder: ['/repo'],
    workspaces: {
      '/repo': {
        viewScrollPositions: [],
        editorHistory: testTabContents([]),
        recentlyClosedTabs: testTabContents([]),
        reopenScrollPositions: testScrollPositions({}),
        workbenchPanels: createDefaultWorkbenchPanels(),
      },
    },
  }
}

function pickedDirectory(path: string): PickedFsEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').filter(Boolean).at(-1) ?? path,
    path: filesystemPath(path),
    size: 1,
    type: 'directory',
    version: 'test:1:1',
  }
}

function fileResult(path: string): FileResult {
  return {
    content: `contents of ${path}`,
    mtimeMs: 1,
    path: filesystemPath(path),
    size: 1,
    version: `test:${path}`,
  }
}

function recordingCacheWriters(writes: CacheWrite[]): WorkspaceCacheWriters {
  return {
    chatModePanels: (chatModePanels) => writes.push({ chatModePanels, key: 'chatModePanels' }),
    rootFolder: (rootFolder) => writes.push({ key: 'rootFolder', rootFolder }),
    searchBuffer: (rootPath, searchBuffer) =>
      writes.push({ key: 'searchBuffer', rootPath, searchBuffer }),
    uiMode: (uiMode) => writes.push({ key: 'uiMode', uiMode }),
    workbenchLayout: (workbenchLayout) => writes.push({ key: 'workbenchLayout', workbenchLayout }),
    workspaceIndex: (rootPaths) =>
      writes.push({ key: 'workspaceIndex', rootPaths: Array.from(rootPaths) }),
    workspaceSlice: (rootPath, slice) => writes.push({ key: 'workspaceSlice', rootPath, slice }),
  }
}

function writeKeys(writes: readonly CacheWrite[]) {
  return writes.map((write) => write.key)
}

function lastCacheWrite<TKey extends CacheWrite['key']>(writes: readonly CacheWrite[], key: TKey) {
  return cacheWrites(writes, key).at(-1)
}

function cacheWrites<TKey extends CacheWrite['key']>(
  writes: readonly CacheWrite[],
  key: TKey,
): Extract<
  CacheWrite,
  {
    key: TKey
  }
>[] {
  return writes.filter(
    (
      write,
    ): write is Extract<
      CacheWrite,
      {
        key: TKey
      }
    > => write.key === key,
  )
}
