import { decodeTabContent } from '@/lib/documents/utils/storage-codec'
import { TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { filesystemPath, tabId, workspaceRoot } from '@/lib/documents/utils/identity'
import { documentTab, settingsTab } from '@/lib/documents/utils/tabs'
import type { TabContent } from '@/lib/documents/utils/types'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { testWorkspaceAddress } from '../../../../../test/factories/workspace-address'
import {
  documentTargets,
  DOCUMENT_TARGET_CASES,
  DOCUMENT_OLD_OBJECT_ID,
  DOCUMENT_NEW_OBJECT_ID,
  testTabContent,
  testScrollPositions,
  INTERNAL_SETTINGS_DOCUMENT_IDS,
  INVALID_DOCUMENT_IDS,
  INVALID_SETTINGS_SURFACE_IDS,
} from '../../../../../test/factories/document-targets'
import { afterEach, beforeEach, describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'

import type { PickedFsEntry } from '@/lib/file-system-types'
import {
  createDefaultWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
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

  it.each(['', '/repo/nested'])(
    'uses one admission rule for every collection at root %s',
    (rootPath) => {
      const filePath = rootPath === '' ? 'src/a.ts' : '/repo/nested/src/a.ts'
      const admitted = [
        testTabContent(filePath, rootPath),
        settingsTab(),
        documentTab({ kind: 'search', root: workspaceRoot(rootPath) }),
      ]
      const rejected = [
        testTabContent(documentTargets.conflict),
        testTabContent('/other/a.ts'),
        documentTab({ kind: 'search', root: workspaceRoot('/other') }),
      ]
      const contents = [...admitted, ...rejected]
      writeRootFolderCache(testScopedStorage, pickedDirectory(rootPath))
      writeWorkspaceSliceCache(testScopedStorage, rootPath, {
        editorHistory: contents,
        recentlyClosedTabs: contents,
        reopenScrollPositions: contents.map((content) => ({
          content,
          position: { left: 4, top: 80 },
        })),
        workbenchPanels: panelsForContents(contents, admitted[2]!),
      })
      const restored = readWorkspaceCache(testScopedStorage).workspaces[rootPath]
      expect(restored?.editorHistory).toEqual(admitted)
      expect(restored?.recentlyClosedTabs).toEqual(admitted)
      expect(restored?.workbenchPanels.editorTabs.map((tab) => tab.content)).toEqual(admitted)
      expect(restored?.reopenScrollPositions).toEqual(
        admitted.map((content) => ({ content, position: { left: 4, top: 80 } })),
      )
    },
  )

  it.each([
    ...INVALID_DOCUMENT_IDS,
    ...INVALID_SETTINGS_SURFACE_IDS,
    ...INTERNAL_SETTINGS_DOCUMENT_IDS,
  ])('rejects untyped reserved content %s from stored history', (path) => {
    writeRootFolderCache(testScopedStorage, pickedDirectory(''))
    testScopedStorage.setItem(
      workspaceSliceStorageKey(''),
      JSON.stringify({ ...emptyWorkspaceSlice(), editorHistory: [path] }),
    )
    expect(readWorkspaceCache(testScopedStorage).workspaces['']?.editorHistory).toEqual([])
    expect(testScopedStorage.getItem(workspaceSliceStorageKey(''))).toBeNull()
  })

  it.each([documentTargets.checkpointSession, documentTargets.checkpointTurn])(
    'persists multi-file checkpoint %s under its workspace owner',
    (path) => {
      const rootPath = '/repo/nested'
      const content = testTabContent(path, rootPath)
      const slice: CachedWorkspaceSlice = {
        editorHistory: [content],
        recentlyClosedTabs: [content],
        reopenScrollPositions: [{ content, position: { left: 4, top: 80 } }],
        workbenchPanels: panelsForContents([content], content),
      }
      writeRootFolderCache(testScopedStorage, pickedDirectory(rootPath))
      writeWorkspaceSliceCache(testScopedStorage, rootPath, slice)
      expect(readWorkspaceCache(testScopedStorage).workspaces[rootPath]).toEqual(slice)
      writeWorkspaceSliceCache(testScopedStorage, '/other', slice)
      writeWorkspaceIndexCache(testScopedStorage, [rootPath, '/other'])
      expect(readWorkspaceCache(testScopedStorage).workspaces['/other']).toEqual(
        emptyWorkspaceSlice(),
      )
    },
  )

  it('promotes the first restored editor tab when the selection was unset', () => {
    const slice = {
      ...emptyWorkspaceSlice(),
      workbenchPanels: {
        ...workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts'], null),
        activeEditorTabId: null,
      },
    }
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', slice)

    const restored = readWorkspaceCache(testScopedStorage).workspaces['/repo']
    expect(restored?.workbenchPanels.editorTabs).toHaveLength(2)
    expect(restored?.workbenchPanels.activeEditorTabId).toBe(
      restored?.workbenchPanels.editorTabs[0]?.id,
    )
  })

  it('keeps duplicate tab IDs and selection while projecting scroll per content', () => {
    const file = testTabContent(documentTargets.file)
    const comparison = testTabContent(documentTargets.savedComparison)
    const slice: CachedWorkspaceSlice = {
      editorHistory: [file, settingsTab()],
      recentlyClosedTabs: [comparison],
      reopenScrollPositions: [
        { content: file, position: { left: 8, top: 320 } },
        { content: settingsTab(), position: { left: 0, top: 40 } },
      ],
      workbenchPanels: {
        ...createDefaultWorkbenchPanels(),
        activeEditorTabId: tabId('duplicate-2'),
        editorTabs: [
          { id: tabId('duplicate-1'), content: file },
          { id: tabId('duplicate-2'), content: file },
        ],
      },
    }
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', slice)
    expect(readWorkspaceCache(testScopedStorage).workspaces['/repo']).toEqual(slice)
    expect(cachedSlice('/repo')).toMatchObject({
      reopenScrollPositions: [
        {
          content: { kind: 'document', document: { kind: 'file', relativePath: 'src/a.ts' } },
          position: { left: 8, top: 320 },
        },
        { content: { kind: 'settings' }, position: { left: 0, top: 40 } },
      ],
      recentlyClosedTabs: [
        { kind: 'document', document: { kind: 'compare-saved', file: { path: '/repo/src/a.ts' } } },
      ],
    })
  })

  it('persists every durable editor tab through the same ordered collection and selection', () => {
    const contents = DOCUMENT_TARGET_CASES.filter(
      (entry) => entry.rootPath === '/repo' && entry.kind !== 'conflict',
    ).map((entry) => testTabContent(entry.path, entry.rootPath))
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    for (const selected of contents) {
      const panels = panelsForContents(contents, selected)
      writeWorkspaceSliceCache(testScopedStorage, '/repo', {
        ...emptyWorkspaceSlice(),
        workbenchPanels: panels,
        recentlyClosedTabs: contents,
      })
      const restored = readWorkspaceCache(testScopedStorage).workspaces['/repo']!
      expect(restored.workbenchPanels).toEqual(panels)
      expect(restored.recentlyClosedTabs).toEqual(contents)
    }
  })

  it('preserves an explicitly empty comparison side when the other side names a snapshot', () => {
    const content = documentTab({
      kind: 'git-diff',
      source: {
        kind: 'snapshot',
        path: filesystemPath('/repo/a.ts'),
        oldObjectId: '',
        newObjectId: DOCUMENT_NEW_OBJECT_ID,
      },
    })
    const slice: CachedWorkspaceSlice = { ...emptyWorkspaceSlice(), editorHistory: [content] }
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', slice)
    expect(readWorkspaceCache(testScopedStorage).workspaces['/repo']).toEqual(slice)
  })

  it.each([
    { kind: 'settings', path: 'unexpected' },
    { kind: 'document', document: { kind: 'settings-json', target: 'user' } },
    { kind: 'document', document: { kind: 'file', relativePath: '../outside.ts' } },
    { kind: 'document', document: { kind: 'file', relativePath: '/outside.ts' } },
    { kind: 'document', document: { kind: 'git-ref', source: { path: '/repo/a.ts', ref: '' } } },
    {
      kind: 'document',
      document: { kind: 'git-diff', source: { kind: 'snapshot', path: '/repo/a.ts' } },
    },
    {
      kind: 'document',
      document: {
        kind: 'git-diff',
        source: {
          kind: 'checkpoint-session',
          owner: '/repo',
          sessionId: TEST_SESSION_ID,
          fromTurnCount: 2,
          toTurnCount: 1,
        },
      },
    },
  ])('rejects malformed stored descriptors without creating a document: %j', (stored) => {
    expect(decodeTabContent(stored, workspaceRoot('/repo'))).toBeNull()
  })

  it('stores ordinary files relatively while preserving comparison metadata', () => {
    const file = testTabContent('/repo/src/readme.md')
    const comparison = testTabContent(documentTargets.snapshot)
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    const slice: CachedWorkspaceSlice = {
      editorHistory: [comparison, file],
      recentlyClosedTabs: [file],
      reopenScrollPositions: [],
      workbenchPanels: panelsForContents([file, comparison], comparison),
    }
    writeWorkspaceSliceCache(testScopedStorage, '/repo', slice)
    expect(readWorkspaceCache(testScopedStorage).workspaces['/repo']).toEqual(slice)
    expect(cachedSlice('/repo')).toMatchObject({
      workbenchPanels: {
        editorTabs: [
          {
            content: {
              kind: 'document',
              document: { kind: 'file', relativePath: 'src/readme.md' },
            },
          },
          {
            content: {
              kind: 'document',
              document: {
                kind: 'git-diff',
                source: {
                  kind: 'snapshot',
                  path: '/repo/src/a.ts',
                  oldPath: '/repo/src/old.ts',
                  oldObjectId: DOCUMENT_OLD_OBJECT_ID,
                  newObjectId: DOCUMENT_NEW_OBJECT_ID,
                  status: 'renamed',
                },
              },
            },
          },
        ],
      },
    })
  })

  it('rejects another workspace source even when the tab is selected', () => {
    const foreign = testTabContent(documentTargets.snapshot)
    const file = testTabContent('/other/src/a.ts')
    writeRootFolderCache(testScopedStorage, pickedDirectory('/other'))
    writeWorkspaceSliceCache(testScopedStorage, '/other', {
      editorHistory: [foreign],
      recentlyClosedTabs: [foreign],
      reopenScrollPositions: [{ content: foreign, position: { left: 0, top: 40 } }],
      workbenchPanels: panelsForContents([foreign, file], foreign),
    })
    const restored = readWorkspaceCache(testScopedStorage).workspaces['/other']!
    expect(restored.editorHistory).toEqual([])
    expect(restored.recentlyClosedTabs).toEqual([])
    expect(restored.reopenScrollPositions).toEqual([])
    expect(restored.workbenchPanels.editorTabs.map((tab) => tab.content)).toEqual([file])
    expect(restored.workbenchPanels.activeEditorTabId).toBe(
      restored.workbenchPanels.editorTabs[0]?.id,
    )
  })

  it('restores a written slice and its workspace identity unchanged', () => {
    const contents = [testTabContent('/repo/src/a.ts'), testTabContent('/repo/src/b.ts')]
    const slice: CachedWorkspaceSlice = {
      editorHistory: contents,
      recentlyClosedTabs: [testTabContent('/repo/src/closed.ts')],
      reopenScrollPositions: testScrollPositions({ '/repo/src/a.ts': { left: 8, top: 320 } }),
      workbenchPanels: panelsForContents(contents, contents[1]!),
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
    panels = {
      ...panels,
      activeGitTab: 'graph',
      gitCommitDetailsOpen: false,
      gitChangesOpen: { staged: false, worktree: false },
      gitHistory: {
        refName: 'refs/heads/topic',
        search: 'an older commit',
        selected: '1234567890123456789012345678901234567890',
        expanded: true,
        pageCount: 3,
        scrollTop: 780,
        detailsScrollTop: 120,
      },
    }

    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      workbenchPanels: panels,
    })

    expect(cachedSlice('/repo')).toMatchObject({
      workbenchPanels: {
        activeBottomTab: 'problems',
        activeGitTab: 'graph',
        gitCommitDetailsOpen: false,
        gitChangesOpen: panels.gitChangesOpen,
        gitHistory: panels.gitHistory,
        activeSidebarTab: 'git',
      },
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
    expect(
      cached.workspaces['/other']?.workbenchPanels.editorTabs.map((tab) => tab.content),
    ).toEqual([testTabContent('/other/src/b.ts')])
  })

  it('leads with the open root even when the index has not caught up', () => {
    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceIndexCache(testScopedStorage, ['/other'])

    expect(readWorkspaceCache(testScopedStorage).workspaceOrder).toEqual(['/repo', '/other'])
  })

  it('deletes the storage of projects that fall off the index', () => {
    writeWorkspaceSliceCache(testScopedStorage, '/other', {
      ...emptyWorkspaceSlice(),
      editorHistory: [testTabContent('/other/src/b.ts')],
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
      editorHistory: [testTabContent('/repo/src/readme.md')],
    })
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])
    testScopedStorage.setItem(
      searchBufferStorageKey('/repo'),
      JSON.stringify({ rootPath: '/repo' }),
    )

    const cached = readWorkspaceCache(testScopedStorage)

    expect(scopedHas(searchBufferStorageKey('/repo'))).toBe(false)
    expect(cached.searchBuffers).toEqual({})
    expect(cached.workspaces['/repo']?.editorHistory).toEqual([
      testTabContent('/repo/src/readme.md'),
    ])
  })

  it('keeps a project’s tabs when its search results are too big to write', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: fakeLocalStorage({ failingSetKeys: new Set([searchBufferStorageKey('/repo')]) }),
    })

    writeRootFolderCache(testScopedStorage, pickedDirectory('/repo'))
    writeWorkspaceSliceCache(testScopedStorage, '/repo', {
      ...emptyWorkspaceSlice(),
      editorHistory: [testTabContent('/repo/src/readme.md')],
    })
    writeSearchBufferCache(testScopedStorage, '/repo', emptySearchBuffer('/repo'))
    writeWorkspaceIndexCache(testScopedStorage, ['/repo'])

    const cached = readWorkspaceCache(testScopedStorage)

    expect(cached.searchBuffers).toEqual({})
    expect(cached.workspaces['/repo']?.editorHistory).toEqual([
      testTabContent('/repo/src/readme.md'),
    ])
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

function cachedSlice(rootPath: string): unknown {
  return JSON.parse(testScopedStorage.getItem(workspaceSliceStorageKey(rootPath)) ?? 'null')
}

function pickedDirectory(path: string): PickedFsEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: 'repo',
    path: filesystemPath(path),
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
    cacheVersion: 5,
    contentVersion: 'stat:1:1',
    rootPath,
    path: `${rootPath}/src/app.ts`,
    themeId: 'dark-plus',
    paint: 'opaque-native-paint',
  }
}

function workbenchPanelsForPaths(paths: readonly string[], activePath: string | null) {
  let panels = createDefaultWorkbenchPanels()
  for (const path of paths)
    panels = openEditorContentInWorkbenchPanels(panels, testTabContent(path))
  if (!activePath) return panels

  return openEditorContentInWorkbenchPanels(panels, testTabContent(activePath))
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

function panelsForContents(contents: readonly TabContent[], active: TabContent) {
  let panels = createDefaultWorkbenchPanels()
  for (const content of contents) panels = openEditorContentInWorkbenchPanels(panels, content)
  return openEditorContentInWorkbenchPanels(panels, active)
}
