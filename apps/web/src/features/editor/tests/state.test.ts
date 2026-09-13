import {
  testContentMatches,
  testTabContents,
  testNullableTabContent,
  testTabContent,
  testDocumentKey,
  testScrollPositions,
  testDocumentRef,
  documentTargets,
} from '../../../../test/factories/document-targets'
import { filesystemPath, tabId as testTabId } from '@/lib/documents/utils/identity'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { QueryClient } from '@tanstack/react-query'
import {
  createEditorBufferSession,
  type EditorPreparedDocument,
  type EditorTextBuffer,
} from '@singapore-editor/core'
import { describe, vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import {
  createEditorActivation,
  createEditorApplyActions,
} from '@/features/editor/state/apply-actions'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { createEditorUiStore } from '@/features/editor/state/ui-state'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import {
  createDefaultWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { CachedWorkspaceSlice, CachedWorkspaceState } from '@/features/workspace/state/cache'
import { createFileOpenIntentServiceOwner } from '@/lib/file-open-intent/state/service'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'

describe('editor workspace state', () => {
  test('opens files as flat editor tabs and records history', () => {
    const { commands, workspaceStore } = editorHarness()
    commands.openFileSurface(filesystemPath('/repo/src/app.ts'))
    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: testTabContents(['/repo/src/app.ts']),
      openTabContents: testTabContents(['/repo/src/app.ts']),
      selectedTabContent: testNullableTabContent('/repo/src/app.ts'),
    })
    expect(workspaceStore.getState().workbenchPanels.editorTabs).toEqual([
      expect.objectContaining({ content: testTabContent('/repo/src/app.ts') }),
    ])
  })
  test('activates the target before publishing the selected tab', () => {
    const documentStore = createEditorDocumentStore()
    const searchStore = createSearchBufferStore()
    const uiStore = createEditorUiStore()
    const workspaceStore = createEditorWorkspaceStore(cachedWorkspace({}))
    const events: string[] = []
    workspaceStore.subscribe(() => events.push('published'))
    const commands = createEditorApplyActions({
      retainedTextBudget: () => Number.MAX_SAFE_INTEGER,
      activation: {
        activate: (content) =>
          events.push(
            `activated:${content.kind === 'document' && content.document.kind === 'file' ? content.document.resource.path : ''}`,
          ),
        setRoot: () => undefined,
      },
      documentStore,
      searchStore,
      uiStore,
      workspaceStore,
    })
    commands.openFileSurface(filesystemPath('/repo/src/app.ts'))
    expect(events).toEqual(['activated:/repo/src/app.ts', 'published'])
  })
  test('reopens a tabless dirty buffer before publishing its new selection', () => {
    const path = '/repo/src/app.ts'
    const panels = workbenchPanelsForPaths([path], path)
    const documentStore = createEditorDocumentStore()
    const searchStore = createSearchBufferStore()
    const uiStore = createEditorUiStore()
    const workspaceStore = createEditorWorkspaceStore(cachedWorkspace({ workbenchPanels: panels }))
    const tabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    const document = documentStore.getState().ensureEditorView(testTabId(tabId), fileResult(path))
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
    commands.closeTab(testTabId(tabId))
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(path))?.buffer).toBe(
      document.buffer,
    )
    let viewAtPublication = null
    const unsubscribe = workspaceStore.subscribe((state) => {
      if (!testContentMatches(state.selectedTabContent, path)) return
      const activeTabId = state.workbenchPanels.activeEditorTabId
      viewAtPublication = activeTabId
        ? documentStore.getState().getEditorView(testTabId(activeTabId))
        : null
    })

    commands.reopenClosedEditor()
    unsubscribe()

    expect(viewAtPublication).not.toBeNull()
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(path))?.buffer).toBe(
      document.buffer,
    )
  })

  test.for(['tab', 'definition'] as const)(
    'installs a %s preparation before publishing a new tab',
    async (source) => {
      const path = filesystemPath('/repo/src/prepared.ts')
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
      service.prepare({ path, rootPath: filesystemPath('/repo'), source })
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
      let preparedAtPublication: EditorPreparedDocument | null = null
      const unsubscribe = workspaceStore.subscribe((state) => {
        if (!testContentMatches(state.selectedTabContent, path)) return
        const activeTabId = state.workbenchPanels.activeEditorTabId
        preparedAtPublication = activeTabId
          ? (documentStore.getState().getEditorView(testTabId(activeTabId))?.preparedDocument ??
            null)
          : null
      })

      const definition = {
        path: filesystemPath(path),
        uri: `file://${path}`,
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
      }
      if (source === 'definition') commands.openDefinition(definition)
      if (source === 'tab') commands.openFileSurface(filesystemPath(path))
      unsubscribe()

      expect(preparedAtPublication).toBe(preparedDocument)
      if (source === 'definition') expect(uiStore.getState().definitionTarget).toEqual(definition)
      owner.disposeNow()
      queryClient.clear()
    },
  )
  test('opens search as an editor tab for the workspace root', () => {
    const { commands, workspaceStore } = editorHarness()
    const searchPath = 'search-buffer:%2Frepo'
    commands.openSearchEditor(filesystemPath('/repo'))
    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: testTabContents([searchPath]),
      openTabContents: testTabContents([searchPath]),
      selectedTabContent: testNullableTabContent(searchPath),
    })
    expect(workspaceStore.getState().workbenchPanels.editorTabs).toEqual([
      expect.objectContaining({ content: testTabContent(searchPath) }),
    ])
  })
  test('selects existing tabs without duplicating open paths', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts', '/repo/src/b.ts'], '/repo/src/a.ts')
    const { commands, workspaceStore } = editorHarness({ workbenchPanels: panels })
    const tab = workspaceStore
      .getState()
      .workbenchPanels.editorTabs.find((candidate) =>
        testContentMatches(candidate.content, '/repo/src/b.ts'),
      )
    expect(tab).toBeTruthy()

    commands.selectTab('main', tab!.id)

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: testTabContents(['/repo/src/b.ts']),
      openTabContents: testTabContents(['/repo/src/a.ts', '/repo/src/b.ts']),
      selectedTabContent: testNullableTabContent('/repo/src/b.ts'),
    })
  })
  test('closes editor tabs and reopens the most recently closed path', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts', '/repo/src/b.ts'], '/repo/src/b.ts')
    const { commands, workspaceStore } = editorHarness({
      editorHistory: testTabContents(['/repo/src/b.ts', '/repo/src/a.ts']),
      workbenchPanels: panels,
    })
    const activeTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId
    expect(activeTabId).toBeTruthy()
    commands.closeTab(testTabId(activeTabId!))
    expect(workspaceStore.getState()).toMatchObject({
      openTabContents: testTabContents(['/repo/src/a.ts']),
      recentlyClosedTabs: testTabContents(['/repo/src/b.ts']),
      selectedTabContent: testNullableTabContent('/repo/src/a.ts'),
    })

    expect(commands.reopenClosedEditor()).toBe(true)
    expect(workspaceStore.getState()).toMatchObject({
      openTabContents: testTabContents(['/repo/src/a.ts', '/repo/src/b.ts']),
      recentlyClosedTabs: testTabContents([]),
      selectedTabContent: testNullableTabContent('/repo/src/b.ts'),
    })
  })
  test('renames editor paths across panels, history, and recent closes', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts')
    const { commands, uiStore, workspaceStore } = editorHarness({
      editorHistory: testTabContents(['/repo/src/a.ts']),
      recentlyClosedTabs: testTabContents(['/repo/src/a.ts']),
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
    commands.renameLiveEditorDocument(
      filesystemPath('/repo/src/a.ts'),
      filesystemPath('/repo/src/renamed.ts'),
    )
    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: testTabContents(['/repo/src/renamed.ts']),
      openTabContents: testTabContents(['/repo/src/renamed.ts']),
      recentlyClosedTabs: testTabContents(['/repo/src/renamed.ts']),
      selectedTabContent: testNullableTabContent('/repo/src/renamed.ts'),
    })
    expect(uiStore.getState().definitionTarget?.path).toBe('/repo/src/renamed.ts')
  })
  test.each([false, true])(
    'preserves encoded comparison targets when renaming a file, parked: %s',
    (parked) => {
      const comparisons = [
        documentTargets.savedComparison,
        documentTargets.reference,
        documentTargets.snapshot,
        documentTargets.checkpointFile,
      ]
      const paths = [documentTargets.file, ...comparisons]
      const panels = workbenchPanelsForPaths(paths, documentTargets.savedComparison)
      const positions = Object.fromEntries(paths.map((path) => [path, { left: 3, top: 120 }]))
      const { commands, documentStore, workspaceStore } = editorHarness({
        editorHistory: testTabContents(paths),
        recentlyClosedTabs: testTabContents(paths),
        reopenScrollPositions: testScrollPositions(positions),
        workbenchPanels: panels,
      })
      const file = documentStore
        .getState()
        .ensureLiveEditorDocument(fileResult(documentTargets.file))
      if (parked) commands.switchRootFolder(pickedDirectory('/other'))
      commands.renameLiveEditorDocument(
        filesystemPath(documentTargets.file),
        filesystemPath('/repo/src/renamed.ts'),
      )
      if (parked) commands.switchRootFolder(pickedDirectory('/repo'))
      const expectedPaths = ['/repo/src/renamed.ts', ...comparisons]
      expect(workspaceStore.getState()).toMatchObject({
        editorHistory: testTabContents(expectedPaths),
        recentlyClosedTabs: testTabContents(expectedPaths),
        openTabContents: testTabContents(expectedPaths),
        selectedTabContent: testNullableTabContent(documentTargets.savedComparison),
        reopenScrollPositions: testScrollPositions(
          Object.fromEntries(expectedPaths.map((path) => [path, { left: 3, top: 120 }])),
        ),
      })
      expect(workspaceStore.getState().workbenchPanels.editorTabs.map((tab) => tab.id)).toEqual(
        panels.editorTabs.map((tab) => tab.id),
      )
      expect(
        documentStore.getState().getLiveEditorDocument(testDocumentKey('/repo/src/renamed.ts'))
          ?.buffer,
      ).toBe(file.buffer)
    },
  )
  test('keeps split and pane movement commands inert in the workbench', () => {
    const panels = workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts')
    const { commands, workspaceStore } = editorHarness({ workbenchPanels: panels })
    const activeTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId
    expect(activeTabId).toBeTruthy()

    expect(commands.splitTab(activeTabId!, 'horizontal')).toBe(false)
    expect(commands.moveTabToPane(activeTabId!, 'secondary')).toBe(false)
    expect(commands.moveTabToSplit(activeTabId!, 'main', 'right')).toBe(false)
  })
  test('parks the open project on a switch and restores it on the way back', () => {
    const { commands, workspaceStore } = editorHarness({
      editorHistory: testTabContents(['/repo/src/a.ts']),
      workbenchPanels: workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts'),
    })

    commands.switchRootFolder(pickedDirectory('/other'))

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: testTabContents([]),
      openTabContents: testTabContents([]),
      selectedTabContent: testNullableTabContent(null),
    })
    expect(workspaceStore.getState().parkedWorkspaces.get('/repo')).toMatchObject({
      editorHistory: testTabContents(['/repo/src/a.ts']),
    })
    commands.openFileSurface(filesystemPath('/other/src/b.ts'))
    commands.switchRootFolder(pickedDirectory('/repo'))

    expect(workspaceStore.getState()).toMatchObject({
      editorHistory: testTabContents(['/repo/src/a.ts']),
      openTabContents: testTabContents(['/repo/src/a.ts']),
      selectedTabContent: testNullableTabContent('/repo/src/a.ts'),
    })
    expect(workspaceStore.getState().parkedWorkspaces.get('/other')?.editorHistory).toEqual(
      testTabContents(['/other/src/b.ts']),
    )
  })
  test('parks and restores the empty filesystem root with its search tab and scroll', () => {
    const panels = workbenchPanelsForPaths(['src/a.ts', 'search-buffer:'], 'search-buffer:')
    const slice: CachedWorkspaceSlice = {
      editorHistory: testTabContents(['search-buffer:', 'src/a.ts']),
      recentlyClosedTabs: testTabContents(['src/closed.ts']),
      reopenScrollPositions: testScrollPositions({ 'search-buffer:': { left: 0, top: 240 } }),
      workbenchPanels: panels,
    }
    const store = createEditorWorkspaceStore({
      ...cachedWorkspace({}),
      rootFolder: pickedDirectory(''),
      workspaceOrder: [''],
      workspaces: { '': slice },
    })
    store.getState().switchWorkspace(pickedDirectory('/other'))
    store.getState().switchWorkspace(pickedDirectory(''))
    expect(store.getState()).toMatchObject(slice)
    expect(store.getState().selectedTabContent).toEqual(testNullableTabContent('search-buffer:'))
  })

  test.for(['rename', 'discard'] as const)(
    'a completed %s updates every parked workspace before it is restored',
    (change) => {
      const from = '/repo/src/a.ts'
      const to = '/repo/src/renamed.ts'
      const scroll = { left: 5, top: 480 }
      const slice = {
        editorHistory: testTabContents([from]),
        recentlyClosedTabs: testTabContents([from]),
        reopenScrollPositions: testScrollPositions({ [from]: scroll }),
        workbenchPanels: workbenchPanelsForPaths([from], from),
      }
      const { commands, documentStore, workspaceStore } = editorHarness(slice)
      documentStore.getState().ensureLiveEditorDocument(fileResult(from))
      commands.switchRootFolder(pickedDirectory('/second'))
      commands.openFileSurface(filesystemPath(from))
      workspaceStore.setState(slice)
      commands.switchRootFolder(pickedDirectory('/other'))
      commands.openFileSurface(filesystemPath('/other/active.ts'))
      if (change === 'rename')
        commands.renameLiveEditorDocument(filesystemPath(from), filesystemPath(to))
      if (change === 'discard') commands.discardLiveEditorDocument(testDocumentRef(from))
      const paths = change === 'rename' ? [to] : []
      const scrollPositionByPath: Record<string, { left: number; top: number }> =
        change === 'rename' ? { [to]: scroll } : {}
      expect(workspaceStore.getState().selectedTabContent).toEqual(
        testNullableTabContent('/other/active.ts'),
      )
      for (const root of ['/repo', '/second']) {
        const parked = workspaceStore.getState().parkedWorkspaces.get(root)
        expect(parked?.workbenchPanels.editorTabs.map((tab) => tab.content)).toEqual(
          testTabContents(paths),
        )
        expect(parked).toMatchObject({
          editorHistory: testTabContents(paths),
          recentlyClosedTabs: testTabContents(paths),
          reopenScrollPositions: testScrollPositions(scrollPositionByPath),
        })
        expect(
          parked?.reopenScrollPositions.some((entry) => testContentMatches(entry.content, from)),
        ).toBe(false)
      }
      commands.switchRootFolder(pickedDirectory('/repo'))
      expect(workspaceStore.getState()).toMatchObject({
        openTabContents: testTabContents(paths),
        selectedTabContent: testNullableTabContent(paths[0] ?? null),
        editorHistory: testTabContents(paths),
        recentlyClosedTabs: testTabContents(paths),
        reopenScrollPositions: testScrollPositions(scrollPositionByPath),
      })
      expect(documentStore.getState().hasLiveEditorDocument(testDocumentKey(from))).toBe(false)
    },
  )
  test('keeps a parked project’s documents and views alive across a switch', () => {
    const { commands, documentStore, workspaceStore } = editorHarness({
      workbenchPanels: workbenchPanelsForPaths(['/repo/src/a.ts'], '/repo/src/a.ts'),
    })
    const tabId = workspaceStore.getState().workbenchPanels.activeEditorTabId
    expect(tabId).toBeTruthy()
    documentStore.getState().ensureEditorView(testTabId(tabId!), fileResult('/repo/src/a.ts'))
    commands.switchRootFolder(pickedDirectory('/other'))

    // Under the old wipe this document and its view were both gone, taking any
    // unsaved edit with them.
    expect(documentStore.getState().hasLiveEditorDocument(testDocumentKey('/repo/src/a.ts'))).toBe(
      true,
    )
    expect(documentStore.getState().getEditorView(testTabId(tabId!))).not.toBeNull()
  })
  test('carries search results across a switch and hands them back', () => {
    const { commands, searchStore } = editorHarness()
    searchStore
      .getState()
      .startSearch({ includeContent: true, limit: 20, path: '/repo', query: 'needle' })

    commands.switchRootFolder(pickedDirectory('/other'))
    expect(searchStore.getState().active).toBeNull()

    commands.switchRootFolder(pickedDirectory('/repo'))
    expect(searchStore.getState().active).toMatchObject({ query: 'needle', rootPath: '/repo' })
  })
  test('reorders editor tabs without changing the selected path', () => {
    const panels = workbenchPanelsForPaths(
      ['/repo/src/a.ts', '/repo/src/b.ts', '/repo/src/c.ts'],
      '/repo/src/b.ts',
    )
    const { commands, workspaceStore } = editorHarness({ workbenchPanels: panels })
    const tabId = workspaceStore.getState().workbenchPanels.editorTabs[0]?.id
    expect(tabId).toBeTruthy()

    expect(commands.reorderTab('main', tabId!, 2)).toBe(true)
    expect(workspaceStore.getState().selectedTabContent).toEqual(
      testNullableTabContent('/repo/src/b.ts'),
    )
    expect(workspaceStore.getState().workbenchPanels.editorTabs.map((tab) => tab.content)).toEqual(
      testTabContents(['/repo/src/b.ts', '/repo/src/c.ts', '/repo/src/a.ts']),
    )
  })

  // A keep set built from the closing workspace's panels alone evicts every other
  // project's clean documents.
  test("closing a tab in one project keeps a parked project's clean documents", () => {
    const parkedPath = '/repo/parked.ts'
    const { commands, documentStore, workspaceStore } = editorHarness()

    commands.openFileSurface(filesystemPath(parkedPath))
    const parkedTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    documentStore.getState().ensureEditorView(parkedTabId, fileResult(parkedPath))

    commands.switchRootFolder(pickedDirectory('/other'))
    expect(
      documentStore.getState().getLiveEditorDocument(testDocumentKey(parkedPath)),
    ).not.toBeNull()

    const first = '/other/first.ts'
    const second = '/other/second.ts'
    commands.openFileSurface(filesystemPath(first))
    const firstTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    documentStore.getState().ensureEditorView(firstTabId, fileResult(first))
    commands.openFileSurface(filesystemPath(second))
    const secondTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    documentStore.getState().ensureEditorView(secondTabId, fileResult(second))

    commands.closeTab(secondTabId)

    expect(
      documentStore.getState().getLiveEditorDocument(testDocumentKey(parkedPath)),
    ).not.toBeNull()
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(first))).not.toBeNull()
  })

  // Both directions matter: without the generous half, a caller handing over a
  // non-binding budget again would pass.
  test('evicts a parked project over the retained-text budget, and keeps it under one', () => {
    const parkedPath = '/repo/parked.ts'

    for (const [budget, evicted] of [
      [500, true],
      [1_073_741_824, false],
    ] as const) {
      const { commands, documentStore, workspaceStore } = editorHarness({}, () => budget)

      commands.openFileSurface(filesystemPath(parkedPath))
      const parkedTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
      documentStore
        .getState()
        .ensureEditorView(parkedTabId, fileResult(parkedPath, 'x'.repeat(1000)))

      commands.switchRootFolder(pickedDirectory('/other'))

      const retained = documentStore.getState().getLiveEditorDocument(testDocumentKey(parkedPath))
      expect(retained === null).toBe(evicted)
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
        editorHistory: testTabContents([]),
        recentlyClosedTabs: testTabContents([]),
        reopenScrollPositions: testScrollPositions({}),
        workbenchPanels: createDefaultWorkbenchPanels(),
        ...slice,
      },
    },
  }
}

function workbenchPanelsForPaths(paths: readonly string[], activePath: string | null) {
  let panels = createDefaultWorkbenchPanels()
  for (const path of paths)
    panels = openEditorContentInWorkbenchPanels(panels, testTabContent(path))
  if (!activePath) return panels
  return openEditorContentInWorkbenchPanels(panels, testTabContent(activePath))
}

function fileResult(path: string, content = 'const a = 1') {
  return {
    birthtimeMs: 0,
    content,
    mtimeMs: 0,
    path: filesystemPath(path),
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
    getLiveDocument: (path) =>
      documentStore.getState().getLiveEditorDocument(testDocumentKey(path)),
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
  owner.setRoot(filesystemPath('/repo'))
  owner.connect()
  return { owner, prepare, service: owner.service }
}

function preparedDocumentLease(): EditorPreparedDocument {
  return {
    dispose: vi.fn(),
    estimatedBytes: 1,
    fallbackReady: Promise.resolve(true),
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
    path: filesystemPath(path),
    size: 1,
    type: 'directory',
    version: 'test:1:1',
  }
}
