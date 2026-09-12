import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { QueryClient } from '@tanstack/react-query'
import {
  createEditorBufferSession,
  type EditorPreparedDocument,
  type EditorTextBuffer,
} from '@singapor/core'
import { describe, it, vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'

import {
  createEditorActivation,
  createEditorApplyActions,
} from '@/features/editor/state/apply-actions'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { createEditorUiStore } from '@/features/editor/state/ui-state'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import { searchBufferDocumentId } from '@/features/search/utils/buffer-document'
import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import {
  createDefaultWorkbenchPanels,
  openEditorPathInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { CachedWorkspaceSlice, CachedWorkspaceState } from '@/features/workspace/state/cache'
import { createFileOpenIntentServiceOwner } from '@/lib/file-open-intent/state/service'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'

describe('editor workspace state', () => {
  it('opens files as flat editor tabs and records history', () => {
    const { commands, workspaceStore } = editorHarness()

    commands.openFileSurface('/repo/src/app.ts')

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: ['/repo/src/app.ts'],
      openFilePaths: ['/repo/src/app.ts'],
      selectedFilePath: '/repo/src/app.ts',
    })
    expect(workspaceStore.getState().workbenchPanels.editorTabs).toEqual([
      expect.objectContaining({ path: '/repo/src/app.ts' }),
    ])
  })

  it('activates the target before publishing the selected tab', () => {
    const documentStore = createEditorDocumentStore()
    const searchStore = createSearchBufferStore()
    const uiStore = createEditorUiStore()
    const workspaceStore = createEditorWorkspaceStore(cachedWorkspace({}))
    const events: string[] = []
    workspaceStore.subscribe(() => events.push('published'))
    const commands = createEditorApplyActions({
      retainedTextBudget: () => Number.MAX_SAFE_INTEGER,
      activation: {
        activate: (path) => events.push(`activated:${path}`),
        setRoot: () => undefined,
      },
      documentStore,
      searchStore,
      uiStore,
      workspaceStore,
    })

    commands.openFileSurface('/repo/src/app.ts')

    expect(events).toEqual(['activated:/repo/src/app.ts', 'published'])
  })

  it('reopens a tabless dirty buffer before publishing its new selection', () => {
    const path = '/repo/src/app.ts'
    const panels = workbenchPanelsForPaths([path], path)
    const documentStore = createEditorDocumentStore()
    const searchStore = createSearchBufferStore()
    const uiStore = createEditorUiStore()
    const workspaceStore = createEditorWorkspaceStore(cachedWorkspace({ workbenchPanels: panels }))
    const tabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    const document = documentStore.getState().ensureEditorView(tabId, fileResult(path))
    createEditorBufferSession(document.buffer).applyText('dirty')
    const { owner } = fileOpenIntentService(documentStore)
    const commands = createEditorApplyActions({
      retainedTextBudget: () => Number.MAX_SAFE_INTEGER,
      activation: createEditorActivation(owner.activation, documentStore, owner),
      documentStore,
      searchStore,
      uiStore,
      workspaceStore,
    })

    commands.closeTab(tabId)
    expect(documentStore.getState().getLiveEditorDocument(path)?.buffer).toBe(document.buffer)
    let viewAtPublication = null
    const unsubscribe = workspaceStore.subscribe((state) => {
      if (state.selectedFilePath !== path) return
      const activeTabId = state.workbenchPanels.activeEditorTabId
      viewAtPublication = activeTabId ? documentStore.getState().getEditorView(activeTabId) : null
    })

    commands.reopenClosedEditor()
    unsubscribe()

    expect(viewAtPublication).not.toBeNull()
    expect(documentStore.getState().getLiveEditorDocument(path)?.buffer).toBe(document.buffer)
  })

  test.for(['tab', 'definition'] as const)(
    'installs a %s preparation before publishing a new tab',
    async (source) => {
      const path = '/repo/src/prepared.ts'
      const file = fileResult(path)
      const documentStore = createEditorDocumentStore()
      const searchStore = createSearchBufferStore()
      const uiStore = createEditorUiStore()
      const workspaceStore = createEditorWorkspaceStore(cachedWorkspace({}))
      const queryClient = new QueryClient()
      queryClient.setQueryData(fileSnapshotQueryOptions(path).queryKey, file)
      const preparedDocument = preparedDocumentLease()
      const { owner, prepare, service } = fileOpenIntentService(
        documentStore,
        queryClient,
        preparedDocument,
      )
      const commands = createEditorApplyActions({
        retainedTextBudget: () => Number.MAX_SAFE_INTEGER,
        activation: createEditorActivation(owner.activation, documentStore, owner),
        documentStore,
        searchStore,
        uiStore,
        workspaceStore,
      })
      service.prepare({ path, rootPath: '/repo', source })
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
      let preparedAtPublication: EditorPreparedDocument | null = null
      const unsubscribe = workspaceStore.subscribe((state) => {
        if (state.selectedFilePath !== path) return
        const activeTabId = state.workbenchPanels.activeEditorTabId
        preparedAtPublication = activeTabId
          ? (documentStore.getState().getEditorView(activeTabId)?.preparedDocument ?? null)
          : null
      })

      const definition = {
        path,
        uri: `file://${path}`,
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
      }
      if (source === 'definition') commands.openDefinition(definition)
      if (source === 'tab') commands.openFileSurface(path)
      unsubscribe()

      expect(preparedAtPublication).toBe(preparedDocument)
      if (source === 'definition') expect(uiStore.getState().definitionTarget).toEqual(definition)
      owner.disposeNow()
      queryClient.clear()
    },
  )

  it('opens search as an editor tab for the workspace root', () => {
    const { commands, workspaceStore } = editorHarness()
    const searchPath = searchBufferDocumentId('/repo')

    commands.openSearchEditor('/repo')

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: [searchPath],
      openFilePaths: [searchPath],
      selectedFilePath: searchPath,
    })
    expect(workspaceStore.getState().workbenchPanels.editorTabs).toEqual([
      expect.objectContaining({ path: searchPath }),
    ])
  })

  it('selects existing tabs without duplicating open paths', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts', '/repo/src/b.ts'], '/repo/src/a.ts')
    const { commands, workspaceStore } = editorHarness({ workbenchPanels: panels })
    const tab = workspaceStore
      .getState()
      .workbenchPanels.editorTabs.find((candidate) => candidate.path === '/repo/src/b.ts')
    expect(tab).toBeTruthy()

    commands.selectTab('main', tab!.id)

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: ['/repo/src/b.ts'],
      openFilePaths: ['/repo/src/a.ts', '/repo/src/b.ts'],
      selectedFilePath: '/repo/src/b.ts',
    })
  })

  it('closes editor tabs and reopens the most recently closed path', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts', '/repo/src/b.ts'], '/repo/src/b.ts')
    const { commands, workspaceStore } = editorHarness({
      editorHistory: ['/repo/src/b.ts', '/repo/src/a.ts'],
      workbenchPanels: panels,
    })
    const activeTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId
    expect(activeTabId).toBeTruthy()

    commands.closeTab(activeTabId!)

    expect(workspaceStore.getState()).toMatchObject({
      openFilePaths: ['/repo/src/a.ts'],
      recentlyClosedEditorPaths: ['/repo/src/b.ts'],
      selectedFilePath: '/repo/src/a.ts',
    })

    expect(commands.reopenClosedEditor()).toBe(true)
    expect(workspaceStore.getState()).toMatchObject({
      openFilePaths: ['/repo/src/a.ts', '/repo/src/b.ts'],
      recentlyClosedEditorPaths: [],
      selectedFilePath: '/repo/src/b.ts',
    })
  })

  it('renames editor paths across panels, history, and recent closes', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts')
    const { commands, uiStore, workspaceStore } = editorHarness({
      editorHistory: ['/repo/src/a.ts'],
      recentlyClosedEditorPaths: ['/repo/src/a.ts'],
      workbenchPanels: panels,
    })
    uiStore.getState().setDefinitionTarget({
      path: '/repo/src/a.ts',
      range: {
        end: { character: 1, line: 0 },
        start: { character: 0, line: 0 },
      },
      uri: 'file:///repo/src/a.ts',
    })

    commands.renameLiveEditorDocument('/repo/src/a.ts', '/repo/src/renamed.ts')

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: ['/repo/src/renamed.ts'],
      openFilePaths: ['/repo/src/renamed.ts'],
      recentlyClosedEditorPaths: ['/repo/src/renamed.ts'],
      selectedFilePath: '/repo/src/renamed.ts',
    })
    expect(uiStore.getState().definitionTarget?.path).toBe('/repo/src/renamed.ts')
  })

  it('keeps split and pane movement commands inert in the workbench', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts')
    const { commands, workspaceStore } = editorHarness({ workbenchPanels: panels })
    const activeTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId
    expect(activeTabId).toBeTruthy()

    expect(commands.splitTab(activeTabId!, 'horizontal')).toBe(false)
    expect(commands.moveTabToPane(activeTabId!, 'secondary')).toBe(false)
    expect(commands.moveTabToSplit(activeTabId!, 'main', 'right')).toBe(false)
  })

  it('parks the open project on a switch and restores it on the way back', () => {
    const { commands, workspaceStore } = editorHarness({
      editorHistory: ['/repo/src/a.ts'],
      workbenchPanels: workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts'),
    })

    commands.switchRootFolder(pickedDirectory('/other'))

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: [],
      openFilePaths: [],
      selectedFilePath: null,
    })
    expect(workspaceStore.getState().parkedWorkspaces.get('/repo')).toMatchObject({
      editorHistory: ['/repo/src/a.ts'],
    })

    commands.openFileSurface('/other/src/b.ts')
    commands.switchRootFolder(pickedDirectory('/repo'))

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: ['/repo/src/a.ts'],
      openFilePaths: ['/repo/src/a.ts'],
      selectedFilePath: '/repo/src/a.ts',
    })
    expect(workspaceStore.getState().parkedWorkspaces.get('/other')?.editorHistory).toEqual([
      '/other/src/b.ts',
    ])
  })

  test.for(['rename', 'discard'] as const)(
    'a completed %s updates every parked workspace before it is restored',
    (change) => {
      const from = '/repo/src/a.ts'
      const to = '/repo/src/renamed.ts'
      const scroll = { left: 5, top: 480 }
      const slice = {
        editorHistory: [from],
        recentlyClosedEditorPaths: [from],
        scrollPositionByPath: { [from]: scroll },
        workbenchPanels: workbenchPanelsForPaths([from], from),
      }
      const { commands, documentStore, workspaceStore } = editorHarness(slice)
      documentStore.getState().ensureLiveEditorDocument(fileResult(from))
      commands.switchRootFolder(pickedDirectory('/second'))
      commands.openFileSurface(from)
      workspaceStore.setState(slice)
      commands.switchRootFolder(pickedDirectory('/other'))
      commands.openFileSurface('/other/active.ts')

      if (change === 'rename') commands.renameLiveEditorDocument(from, to)
      if (change === 'discard') commands.discardLiveEditorDocument(from)

      const paths = change === 'rename' ? [to] : []
      const scrollPositionByPath = change === 'rename' ? { [to]: scroll } : {}
      expect(workspaceStore.getState().selectedFilePath).toBe('/other/active.ts')
      for (const root of ['/repo', '/second']) {
        const parked = workspaceStore.getState().parkedWorkspaces.get(root)
        expect(parked?.workbenchPanels.editorTabs.map((tab) => tab.path)).toEqual(paths)
        expect(parked).toMatchObject({
          editorHistory: paths,
          recentlyClosedEditorPaths: paths,
          scrollPositionByPath,
        })
        expect(parked?.scrollPositionByPath[from]).toBeUndefined()
      }
      commands.switchRootFolder(pickedDirectory('/repo'))
      expect(workspaceStore.getState()).toMatchObject({
        openFilePaths: paths,
        selectedFilePath: paths[0] ?? null,
        editorHistory: paths,
        recentlyClosedEditorPaths: paths,
        scrollPositionByPath,
      })
      expect(documentStore.getState().hasLiveEditorDocument(from)).toBe(false)
    },
  )

  it('keeps a parked project’s documents and views alive across a switch', () => {
    const { commands, documentStore, workspaceStore } = editorHarness({
      workbenchPanels: workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts'),
    })
    const tabId = workspaceStore.getState().workbenchPanels.activeEditorTabId
    expect(tabId).toBeTruthy()
    documentStore.getState().ensureEditorView(tabId!, fileResult('/repo/src/a.ts'))

    commands.switchRootFolder(pickedDirectory('/other'))

    // Under the old wipe this document and its view were both gone, taking any
    // unsaved edit with them.
    expect(documentStore.getState().hasLiveEditorDocument('/repo/src/a.ts')).toBe(true)
    expect(documentStore.getState().getEditorView(tabId!)).not.toBeNull()
  })

  it('carries search results across a switch and hands them back', () => {
    const { commands, searchStore } = editorHarness()
    searchStore
      .getState()
      .startSearch({ includeContent: true, limit: 20, path: '/repo', query: 'needle' })

    commands.switchRootFolder(pickedDirectory('/other'))
    expect(searchStore.getState().active).toBeNull()

    commands.switchRootFolder(pickedDirectory('/repo'))
    expect(searchStore.getState().active).toMatchObject({ query: 'needle', rootPath: '/repo' })
  })

  it('reorders editor tabs without changing the selected path', () => {
    const panels = workbenchPanelsForPaths(
      ['/repo/src/a.ts', '/repo/src/b.ts', '/repo/src/c.ts'],
      '/repo/src/b.ts',
    )
    const { commands, workspaceStore } = editorHarness({ workbenchPanels: panels })
    const tabId = workspaceStore.getState().workbenchPanels.editorTabs[0]?.id
    expect(tabId).toBeTruthy()

    expect(commands.reorderTab('main', tabId!, 2)).toBe(true)

    expect(workspaceStore.getState().selectedFilePath).toBe('/repo/src/b.ts')
    expect(workspaceStore.getState().workbenchPanels.editorTabs.map((tab) => tab.path)).toEqual([
      '/repo/src/b.ts',
      '/repo/src/c.ts',
      '/repo/src/a.ts',
    ])
  })

  // A keep set built from the closing workspace's panels alone evicts every other
  // project's clean documents.
  it("closing a tab in one project keeps a parked project's clean documents", () => {
    const parkedPath = '/repo/parked.ts'
    const { commands, documentStore, workspaceStore } = editorHarness()

    commands.openFileSurface(parkedPath)
    const parkedTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    documentStore.getState().ensureEditorView(parkedTabId, fileResult(parkedPath))

    commands.switchRootFolder(pickedDirectory('/other'))
    expect(workspaceStore.getState().parkedWorkspaces.has('/repo')).toBe(true)
    expect(documentStore.getState().getLiveEditorDocument(parkedPath)).not.toBeNull()

    const first = '/other/first.ts'
    const second = '/other/second.ts'
    commands.openFileSurface(first)
    const firstTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    documentStore.getState().ensureEditorView(firstTabId, fileResult(first))
    commands.openFileSurface(second)
    const secondTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    documentStore.getState().ensureEditorView(secondTabId, fileResult(second))

    commands.closeTab(secondTabId)

    expect(documentStore.getState().getLiveEditorDocument(parkedPath)).not.toBeNull()
    expect(documentStore.getState().getLiveEditorDocument(first)).not.toBeNull()
  })

  // Both directions matter: without the generous half, a caller handing over a
  // non-binding budget again would pass.
  it('evicts a parked project over the retained-text budget, and keeps it under one', () => {
    const parkedPath = '/repo/parked.ts'

    for (const [budget, evicted] of [
      [500, true],
      [1_073_741_824, false],
    ] as const) {
      const { commands, documentStore, workspaceStore } = editorHarness({}, () => budget)

      commands.openFileSurface(parkedPath)
      const parkedTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
      documentStore
        .getState()
        .ensureEditorView(parkedTabId, fileResult(parkedPath, 'x'.repeat(1000)))

      commands.switchRootFolder(pickedDirectory('/other'))

      expect(documentStore.getState().getLiveEditorDocument(parkedPath) === null).toBe(evicted)
    }
  })
})

function editorHarness(
  slice: Partial<CachedWorkspaceSlice> = {},
  // The registry maximum, not MAX_SAFE_INTEGER: no test should pin a budget the
  // production path cannot produce.
  retainedTextBudget: () => number = () => 1_073_741_824,
) {
  const documentStore = createEditorDocumentStore()
  const searchStore = createSearchBufferStore()
  const uiStore = createEditorUiStore()
  const workspaceStore = createEditorWorkspaceStore(cachedWorkspace(slice))
  const commands = createEditorApplyActions({
    retainedTextBudget,
    activation: { activate: () => undefined, setRoot: () => undefined },
    documentStore,
    searchStore,
    uiStore,
    workspaceStore,
  })

  return { commands, documentStore, searchStore, uiStore, workspaceStore }
}

function cachedWorkspace(slice: Partial<CachedWorkspaceSlice>): CachedWorkspaceState {
  const rootFolder = pickedDirectory('/repo')

  return {
    chatModePanels: createDefaultChatModePanels(),
    rootFolder,
    searchBuffers: {},
    uiMode: 'workbench',
    workbenchLayout: createDefaultWorkbenchLayout(),
    worktreeIdByRootPath: {},
    workspaceOrder: [rootFolder.path],
    workspaces: {
      [rootFolder.path]: {
        editorHistory: [],
        recentlyClosedEditorPaths: [],
        scrollPositionByPath: {},
        workbenchPanels: createDefaultWorkbenchPanels(),
        ...slice,
      },
    },
  }
}

function workbenchPanelsForPaths(paths: readonly string[], activePath: string | null) {
  let panels = createDefaultWorkbenchPanels()
  for (const path of paths) panels = openEditorPathInWorkbenchPanels(panels, path)
  if (!activePath) return panels

  return openEditorPathInWorkbenchPanels(panels, activePath)
}

function fileResult(path: string, content = 'const a = 1') {
  return {
    birthtimeMs: 0,
    content,
    mtimeMs: 0,
    path,
    size: content.length,
    type: 'file' as const,
    version: 'v1',
  }
}

function fileOpenIntentService(
  documentStore: ReturnType<typeof createEditorDocumentStore>,
  queryClient = new QueryClient(),
  preparedDocument = preparedDocumentLease(),
) {
  const prepare = vi.fn((buffer: EditorTextBuffer) => ({ buffer, preparedDocument }))
  const owner = createFileOpenIntentServiceOwner({
    getLiveDocument: (path) => documentStore.getState().getLiveEditorDocument(path),
    getRetainedScrollPosition: () => null,
    isActive: () => false,
    mountedEditors: {
      has: () => false,
      subscribe: () => () => undefined,
    },
    preparer: {
      environment: {
        configurationTag: ['test'],
        highlighterProvider: null,
        structuralProvider: null,
      },
      prepare: (buffer) => ({
        ...prepare(buffer),
        documentConfigurationTag: [],
        stages: [],
      }),
      reconfigure: () => ({ documentConfigurationTag: [], stages: [] }),
    },
    prefetchRelated: () => undefined,
    queryClient,
    subscribeLiveDocuments: (listener) => documentStore.subscribe(() => listener()),
  })
  owner.setRoot('/repo')
  owner.connect()
  return { owner, prepare, service: owner.service }
}

function preparedDocumentLease(): EditorPreparedDocument {
  return {
    dispose: vi.fn(),
    estimatedBytes: 1,
    runtimeSessionIds: () => ({ highlighter: [], structural: [] }),
    startStage: vi.fn(() => null),
    take: vi.fn(() => null),
  }
}

function pickedDirectory(path: string): PickedFsEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').filter(Boolean).at(-1) ?? path,
    path,
    size: 1,
    type: 'directory',
    version: 'test:1:1',
  }
}
