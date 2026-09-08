import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { testWorkspaceAddress } from '../../../../../test/factories/workspace-address'
import { afterEach, beforeEach, describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'

import type { PickedFsEntry } from '@/lib/file-system-types'
import { conflictDiffDocumentId } from '@/features/editor/utils/conflict-diff-document'
import { settingsDocumentId } from '@/features/settings/utils/document'
import { refDocumentId } from '@/features/git/utils/ref-document'
import { compareSavedDocumentId } from '@/features/editor/utils/compare-saved-document'
import { snapshotDiffDocumentId } from '@/features/git/utils/diff-document'
import type { FileDiff } from '@/features/git/utils/types'
import { searchBufferDocumentId } from '@/features/search/utils/buffer-document'
import {
  createDefaultWorkbenchPanels,
  openEditorPathInWorkbenchPanels,
  setWorkbenchBottomTab,
  setWorkbenchSidebarTab,
} from '@/features/workbench/utils/panels'
import {
  WORKSPACE_CACHE_STORAGE_KEYS,
  WORKSPACE_SLICE_LIMIT,
  emptyWorkspaceSlice,
  readWorkspaceCache,
  searchBufferStorageKey,
  workspaceSliceStorageKey,
  type CachedSearchBufferState,
  type CachedWorkspaceSlice,
  writeRootFolderCache,
  writeChatModePanelsCache,
  writeSearchBufferCache,
  writeSessionSelectionCache,
  writeUiModeCache,
  writeWorkbenchLayoutCache,
  writeWorkspaceIndexCache,
  writeWorkspaceSliceCache,
} from '@/features/workspace/state/cache'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { DEFAULT_WORKSPACE_UI_MODE } from '@/lib/ui-mode'
import {
  EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
  writeEditorVisibleSnapshotCache,
  type CachedEditorVisibleSnapshot,
} from '@/lib/editor-visible-snapshot-cache'

const STORE = new Map<string, string>()

describe('workspace cache', () => {
  beforeEach(() => {
    STORE.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: fakeLocalStorage(),
    })
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage
  })

  it('persists every durable editor tab through the same ordered collection and selection', () => {
    const paths = [
      '/repo/main.ts',
      settingsDocumentId(),
      searchBufferDocumentId('/repo'),
      refDocumentId({ path: '/repo/main.ts', ref: 'HEAD' }),
      compareSavedDocumentId('/repo/main.ts'),
    ]
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    for (const selected of paths) {
      const panels = workbenchPanelsForPaths(paths, selected)
      writeWorkspaceSliceCache(testScopedStorage, '/repo', {
        ...emptyWorkspaceSlice(),
        workbenchPanels: panels,
        recentlyClosedEditorPaths: paths,
      })
      const restored = readWorkspaceCache(testScopedStorage).workspaces['/repo']!
      expect(restored.workbenchPanels).toEqual(panels)
      expect(restored.recentlyClosedEditorPaths).toEqual(paths)
    }
  })

  it('persists git diff tabs when their backing file is in the workspace', () => {
    const diffPath = snapshotDiffDocumentId(snapshotDiff('/repo/src/app.ts'))

    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      editorHistory: [diffPath, '/repo/src/readme.md'],
      recentlyClosedEditorPaths: ['/repo/src/closed.ts'],
      scrollPositionByPath: {},
      workbenchPanels: workbenchPanelsForPaths(['/repo/src/readme.md', diffPath], diffPath),
    })
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    expect(readWorkspaceCache(testScopedStorage).workspaces['/repo']).toMatchObject({
      editorHistory: [diffPath, '/repo/src/readme.md'],
      recentlyClosedEditorPaths: ['/repo/src/closed.ts'],
    })
    // Stored file paths are workspace-relative. A diff document id is not a workspace
    // path, so it is stored whole — its portable form is an address token, not a slice.
    expect(cachedSlice('/repo').workbenchPanels.editorTabs.map((tab) => tab.path)).toEqual([
      './src/readme.md',
      diffPath,
    ])
  })

  it('restores files and synthetic tabs at the configured filesystem root', () => {
    const diffPath = snapshotDiffDocumentId(snapshotDiff('src/app.ts'))
    const searchPath = searchBufferDocumentId('')
    writeRootFolderCache(testScopedStorage, pickedDirectory(''))
    writeWorkspaceSliceCache(testScopedStorage, '', {
      ...emptyWorkspaceSlice(),
      editorHistory: ['src/app.ts', diffPath, searchPath, 'settings:', '/outside.ts'],
      workbenchPanels: workbenchPanelsForPaths(['src/app.ts', diffPath, searchPath], diffPath),
    })

    expect(readWorkspaceCache(testScopedStorage).workspaceOrder).toEqual([''])
    expect(readWorkspaceCache(testScopedStorage).workspaces['']?.editorHistory).toEqual([
      'src/app.ts',
      diffPath,
      searchPath,
      'settings:',
    ])
    expect(cachedSlice('').workbenchPanels.editorTabs.map((tab) => tab.path)).toEqual([
      './src/app.ts',
      diffPath,
      searchPath,
    ])
  })

  it('filters paths that belong to another workspace out of the slice that owns them', () => {
    const diffPath = snapshotDiffDocumentId(snapshotDiff('/other/src/app.ts'))

    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      editorHistory: [diffPath, conflictDiffDocumentId('conflict-1')],
      recentlyClosedEditorPaths: ['/other/src/closed.ts'],
      scrollPositionByPath: {},
      workbenchPanels: workbenchPanelsForPaths([diffPath, '/repo/src/a.ts'], diffPath),
    })

    expect(cachedSlice('/repo')).toMatchObject({
      editorHistory: [],
      recentlyClosedEditorPaths: [],
    })
    expect(cachedSlice('/repo').workbenchPanels.editorTabs.map((tab) => tab.path)).toEqual([
      './src/a.ts',
    ])
  })

  it('persists scroll positions for workspace paths only', () => {
    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      scrollPositionByPath: {
        '/other/src/elsewhere.ts': { left: 0, top: 40 },
        '/repo/src/app.ts': { left: 8, top: 320 },
      },
    })

    expect(cachedSlice('/repo').scrollPositionByPath).toEqual({
      './src/app.ts': { left: 8, top: 320 },
    })
  })

  it('keeps a search editor tab only for the workspace it searches', () => {
    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      editorHistory: [searchBufferDocumentId('/repo'), searchBufferDocumentId('/other')],
    })

    expect(cachedSlice('/repo').editorHistory).toEqual([searchBufferDocumentId('/repo')])
  })

  // The filter runs in both directions and only understands absolute paths, so
  // relativizing inside it would make every restored path fail the workspace test and
  // empty the slice on the first reload — silently, since an empty-but-valid slice is
  // not a schema miss. This is the test that fails if the two directions are ever fused.
  it('restores a written slice unchanged, with every path absolute again', () => {
    const slice: CachedWorkspaceSlice = {
      editorHistory: ['/repo/src/a.ts', '/repo/src/b.ts'],
      recentlyClosedEditorPaths: ['/repo/src/closed.ts'],
      scrollPositionByPath: { '/repo/src/a.ts': { left: 8, top: 320 } },
      workbenchPanels: workbenchPanelsForPaths(
        ['/repo/src/a.ts', '/repo/src/b.ts'],
        '/repo/src/b.ts',
      ),
    }

    const workspaceAddress = testWorkspaceAddress('/repo')
    writeRootFolderCache(testScopedStorage, { ...pickedDirectory('/repo'), workspaceAddress })
    writeWorkspaceSliceCache(testScopedStorage, '/repo', slice)
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    expect(readWorkspaceCache(testScopedStorage).workspaces['/repo']).toEqual(slice)
    expect(readWorkspaceCache(testScopedStorage).rootFolder?.workspaceAddress).toEqual(
      workspaceAddress,
    )
  })

  it('sweeps superseded cache versions, which nothing else can reach', () => {
    const stale = 'platform.workspace-state.v17.workspace:/repo'
    testScopedStorage.setItem(stale, JSON.stringify(emptyWorkspaceSlice()))
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))

    readWorkspaceCache(testScopedStorage)

    expect(testScopedStorage.getItem(stale)).toBeNull()
    expect(readWorkspaceCache(testScopedStorage).rootFolder?.path).toBe('/repo')
  })

  it('rejects a cached workspace ID paired with another folder path', () => {
    writeRootFolderCache(testScopedStorage, {
      ...pickedDirectory('/alias'),
      workspaceAddress: testWorkspaceAddress('/actual'),
    })

    expect(readWorkspaceCache(testScopedStorage).rootFolder).toBeNull()
  })

  it('persists fixed panel tabs', () => {
    let panels = workbenchPanelsForPaths(['/repo/src/a.ts', '/repo/src/b.ts'], '/repo/src/b.ts')
    panels = setWorkbenchSidebarTab(panels, 'git')
    panels = setWorkbenchBottomTab(panels, 'problems')

    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      workbenchPanels: panels,
    })

    expect(cachedSlice('/repo').workbenchPanels).toMatchObject({
      activeBottomTab: 'problems',
      activeSidebarTab: 'git',
    })
  })

  it('restores every remembered project, not just the open one', () => {
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      workbenchPanels: workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts'),
    })
    writeWorkspaceSliceCache(testScopedStorage, '/other', {
      ...emptyWorkspaceSlice(),
      workbenchPanels: workbenchPanelsForPaths(['/other/src/b.ts'], '/other/src/b.ts'),
    })
    writeWorkspaceIndexCache(testScopedStorage, ['/repo', '/other'])

    const cached = readWorkspaceCache(testScopedStorage)

    expect(cached.workspaceOrder).toEqual(['/repo', '/other'])
    expect(cached.workspaces['/other']?.workbenchPanels.editorTabs.map((tab) => tab.path)).toEqual([
      '/other/src/b.ts',
    ])
  })

  it('leads with the open root even when the index has not caught up', () => {
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceIndexCache(testScopedStorage, ['/other'])

    expect(readWorkspaceCache(testScopedStorage).workspaceOrder).toEqual(['/repo', '/other'])
  })

  it('deletes the storage of projects that fall off the index', () => {
    writeWorkspaceSliceCache(testScopedStorage, '/other', {
      ...emptyWorkspaceSlice(),
      editorHistory: ['/other/src/b.ts'],
    })
    writeSearchBufferCache(testScopedStorage, '/other', emptySearchBuffer('/other'))
    writeEditorVisibleSnapshotCache(testScopedStorage, cachedEditorVisibleSnapshot('/other'))
    writeWorkspaceIndexCache(testScopedStorage, ['/repo', '/other'])

    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    expect(scopedHas(workspaceSliceStorageKey('/other'))).toBe(false)
    expect(scopedHas(searchBufferStorageKey('/other'))).toBe(false)
    expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(
      false,
    )
  })

  it('leaves a visible snapshot for another root when evicting a workspace', () => {
    writeEditorVisibleSnapshotCache(testScopedStorage, cachedEditorVisibleSnapshot('/kept'))
    writeWorkspaceIndexCache(testScopedStorage, ['/repo', '/other'])

    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(true)
  })

  it('remembers at most the slice limit', () => {
    const rootPaths = Array.from(
      { length: WORKSPACE_SLICE_LIMIT + 3 },
      (_, index) => `/repo-${index}`,
    )
    for (const rootPath of rootPaths) {
      writeWorkspaceSliceCache(testScopedStorage, rootPath, emptyWorkspaceSlice())
    }

    writeWorkspaceIndexCache(testScopedStorage, rootPaths)

    expect(readWorkspaceCache(testScopedStorage).workspaceOrder).toEqual(
      rootPaths.slice(0, WORKSPACE_SLICE_LIMIT),
    )
    expect(scopedHas(workspaceSliceStorageKey(rootPaths[WORKSPACE_SLICE_LIMIT]!))).toBe(false)
  })

  it('persists cached search buffer metadata under the workspace it searched', () => {
    const buffer = cachedSearchBuffer('/repo')

    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeSearchBufferCache(testScopedStorage, '/repo', buffer)
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    expect(readWorkspaceCache(testScopedStorage).searchBuffers['/repo']).toEqual(buffer)
  })

  it('refuses to file a search buffer under a workspace it does not belong to', () => {
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeSearchBufferCache(testScopedStorage, '/repo', emptySearchBuffer('/other'))
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    expect(readWorkspaceCache(testScopedStorage).searchBuffers).toEqual({})
    expect(scopedHas(searchBufferStorageKey('/repo'))).toBe(false)
  })

  it('drops only the invalid cache entry while restoring valid workspace state', () => {
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      editorHistory: ['/repo/src/readme.md'],
    })
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])
    testScopedStorage.setItem(
      searchBufferStorageKey('/repo'),
      JSON.stringify({ rootPath: '/repo' }),
    )

    const cached = readWorkspaceCache(testScopedStorage)

    expect(scopedHas(searchBufferStorageKey('/repo'))).toBe(false)
    expect(cached.searchBuffers).toEqual({})
    expect(cached.workspaces['/repo']?.editorHistory).toEqual(['/repo/src/readme.md'])
  })

  it('keeps a project’s tabs when its search results are too big to write', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: fakeLocalStorage({ failingSetKeys: new Set([searchBufferStorageKey('/repo')]) }),
    })

    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      editorHistory: ['/repo/src/readme.md'],
    })
    writeSearchBufferCache(testScopedStorage, '/repo', emptySearchBuffer('/repo'))
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    const cached = readWorkspaceCache(testScopedStorage)

    expect(cached.searchBuffers).toEqual({})
    expect(cached.workspaces['/repo']?.editorHistory).toEqual(['/repo/src/readme.md'])
  })

  it('keeps workspace-independent entries in their own keys', () => {
    writeChatModePanelsCache(createDefaultChatModePanels())
    writeUiModeCache(DEFAULT_WORKSPACE_UI_MODE)
    writeWorkbenchLayoutCache(createDefaultWorkbenchLayout())
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeSessionSelectionCache(testScopedStorage, { kind: 'auto' })
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    expect(new Set(STORE.keys())).toEqual(
      new Set(
        Object.entries(WORKSPACE_CACHE_STORAGE_KEYS).map(([name, key]) =>
          ['uiMode', 'workbenchLayout', 'chatModePanels'].includes(name)
            ? key
            : `env:${testScopedStorage.environmentId}|${key}`,
        ),
      ),
    )
  })
})

function cachedSlice(rootPath: string): CachedWorkspaceSlice {
  return JSON.parse(
    testScopedStorage.getItem(workspaceSliceStorageKey(rootPath)) ?? 'null',
  ) as CachedWorkspaceSlice
}

function snapshotDiff(path: string): FileDiff & { newObjectId: string; oldObjectId: string } {
  return {
    hunks: [],
    newObjectId: 'b'.repeat(40),
    oldObjectId: 'a'.repeat(40),
    patch: '',
    path,
    staged: false,
  }
}

function pickedDirectory(path: string): PickedFsEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: 'repo',
    path,
    size: 1,
    type: 'directory',
    version: 'test:1:1',
  }
}

function cachedSearchBuffer(rootPath: string): CachedSearchBufferState {
  return {
    ...emptySearchBuffer(rootPath),
    caseSensitive: true,
    collapsedPaths: ['/repo/src/app.ts'],
    excludeGlobText: '*.test.ts',
    includeGlobText: 'src/**/*.ts',
    matchMode: 'regex',
    matches: [
      {
        column: 1,
        kind: 'content',
        line: 1,
        path: '/repo/src/app.ts',
        preview: 'needle',
        source: 'disk',
        type: 'file',
      },
    ],
    queryHistory: ['needle'],
    replaceHistory: ['pin'],
    replaceText: 'pin',
    replaceVisible: true,
    resultsQuery: 'needle',
    resultsSearchQuery: {
      caseSensitive: true,
      excludeGlobs: ['*.test.ts'],
      includeContent: true,
      includeGlobs: ['src/**/*.ts'],
      limit: 200,
      matchMode: 'regex',
      path: rootPath,
      query: 'needle',
    },
    totalCount: 1,
  }
}

function emptySearchBuffer(rootPath: string): CachedSearchBufferState {
  return {
    activeResultId: null,
    caseSensitive: false,
    collapsedPaths: [],
    excludeGlobText: '',
    filtersVisible: false,
    includeGlobText: '',
    matchMode: 'literal',
    matches: [],
    query: 'needle',
    queryHistory: [],
    replaceHistory: [],
    replaceText: '',
    replaceVisible: false,
    resultsQuery: '',
    resultsSearchQuery: null,
    rootPath,
    totalCount: 0,
    truncated: false,
    warnings: [],
    wholeWord: false,
  }
}

function cachedEditorVisibleSnapshot(rootPath: string): CachedEditorVisibleSnapshot {
  return {
    cacheVersion: 4,
    contentVersion: 'stat:1:1',
    rootPath,
    path: `${rootPath}/src/app.ts`,
    themeId: 'dark-plus',
    snapshot: {
      paintLayers: [],
      kind: 'editor-visible',
      schemaVersion: 1,
      documentId: 'document-1',
      languageId: 'typescript',
      theme: null,
      textVersion: 1,
      initialHighlightStatus: 'plain',
      metrics: { rowHeight: 20, characterWidth: 8 },
      lineCount: 1,
      contentWidth: 0,
      totalHeight: 20,
      gutterWidth: 0,
      gutterLayout: { fixedWidth: 0, lanes: [] },
      tabSize: 2,
      viewport: {
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 0,
        scrollWidth: 0,
        clientHeight: 0,
        clientWidth: 0,
        borderBoxHeight: null,
        borderBoxWidth: null,
        visibleRange: { start: 0, end: 0 },
      },
      rows: [],
    },
  }
}

function workbenchPanelsForPaths(paths: readonly string[], activePath: string | null) {
  let panels = createDefaultWorkbenchPanels()
  for (const path of paths) panels = openEditorPathInWorkbenchPanels(panels, path)
  if (!activePath) return panels

  return openEditorPathInWorkbenchPanels(panels, activePath)
}

type FakeLocalStorageOptions = {
  readonly failingSetKeys?: ReadonlySet<string>
}

function fakeLocalStorage(options: FakeLocalStorageOptions = {}) {
  return {
    getItem: (key: string) => STORE.get(key) ?? null,
    key: (index: number) => Array.from(STORE.keys())[index] ?? null,
    get length() {
      return STORE.size
    },
    removeItem: (key: string) => {
      STORE.delete(key)
    },
    setItem: (key: string, value: string) => {
      if (options.failingSetKeys?.has(key.slice(key.indexOf('|') + 1)))
        throw new DOMException('localStorage quota exceeded')

      STORE.set(key, value)
    },
  }
}

function scopedHas(key: string) {
  return testScopedStorage.getItem(key) !== null
}
