import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import { testDocumentRef } from '../../../../test/factories/document-targets'
import type { DocumentRef } from '@/lib/documents/utils/types'
import { filesystemPath } from '@/lib/documents/utils/identity'
import '@workspace/ui/globals.css'
import '@singapore-editor/core/style.css'
import type { QueryClient } from '@tanstack/react-query'
import {
  DEFAULT_SETTING_VALUES,
  type SettingsSnapshot,
  type SettingsValues,
} from '@workspace/contracts'
import type { GitStatusEntry } from '@workspace/tree'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { ForesightManager } from 'js.foresight'
import { createBrowserWorkspace } from '../../../../test/factories/browser-workspace'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { type EditorCommands } from '@/features/editor/state/commands'
import {
  useEditorDocumentStoreApi,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import {
  awaitEditorSyntaxWorkerIdleFences,
  disposeEditorShikiWorkerOwner,
  disposeEditorTreeSitterSyntaxProvider,
} from '@/features/editor/state/syntax-highlighting'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
  type EditorWorkspaceStore,
  type EditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { EditorSurfaceTabBody } from '@/features/workbench/components/editor-surface-tab-body'
import { TreePane } from '@/features/workspace/components/tree-pane'
import {
  FileTreeActionsContext,
  type FileTreeActions,
  type TreeToolbarActions,
} from '@/features/workspace/providers/actions-context'
import { useCommand } from '@/keymap/hooks/use-command'
import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import { FocusService } from '@/lib/focus/state/service'
import type { TreeEntry, TreeResult } from '@/lib/file-system-types'
import { treeModel, type TreeModel } from '@/lib/tree-model'
import { AppProviders, seedBootMirrorTheme } from '../../../../test/render'

const ROOT_PATH = 'repo'
const PREPARED_ROOT_PATH = 'repo'
const DEEP_FILE_PATH = `${ROOT_PATH}/src/file-79.ts`
const PREPARED_FILE_PATH = `${PREPARED_ROOT_PATH}/src/editor-tab-a.ts`
const SHALLOW_FILE_PATH = `${ROOT_PATH}/src/file-0.ts`
const UNLOADED_FILE_PATH = `${ROOT_PATH}/src/unloaded/deep.ts`

// The identity row above the tree is not mounted here; the tree publishes its
// actions and the test invokes them the way that row would.
let treeToolbar: TreeToolbarActions | null = null

const fileTreeActions: FileTreeActions = {
  loadDirectory: () => {},
  prefetchDirectory: () => {},
  publishToolbar: (actions) => {
    treeToolbar = actions
  },
  publishVisibleItemCount: () => {},
}

let root: Root | null = null
let treeCommandBus: PlatformCommandBus | null = null
let treeDocumentStore: EditorDocumentStoreApi | null = null
let treeEditorCommands: EditorCommands | null = null
let treeWorkspaceStore: EditorWorkspaceStoreApi | null = null

afterEach(async () => {
  flushSync(() => root?.unmount())
  root = null
  treeCommandBus = null
  treeToolbar = null
  treeDocumentStore = null
  treeEditorCommands = null
  treeWorkspaceStore = null
  await Promise.all([disposeEditorShikiWorkerOwner(), disposeEditorTreeSitterSyntaxProvider()])
  document.body.replaceChildren()
  delete document.documentElement.dataset.density
  localStorage.clear()
  performance.clearMarks()
  performance.clearMeasures()
  editorDiagnosticGlobal.__editorPerfTrace = undefined
})

test(
  'a real Shadow DOM file row predicts and activates a prepared editor tab',
  { timeout: 30_000 },
  async () => {
    await mountTreePane(new FocusService(), {
      editorMounted: true,
      model: preparedNavigatorModel(),
      rootPath: PREPARED_ROOT_PATH,
    })
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const shadowRoot = await fileTreeShadowRoot()
    await expect.poll(treeRuntimeIsReady).toBe(true)

    const directoryRow = rowButton(shadowRoot, 'src/')
    expect(directoryRow).not.toBeNull()
    directoryRow!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    await expect.poll(() => rowButton(shadowRoot, 'src/editor-tab-a.ts')).not.toBeNull()
    const row = rowButton(shadowRoot, 'src/editor-tab-a.ts')!
    await expect
      .poll(() => ForesightManager.instance.getManagerData.registeredElements.get(row))
      .toMatchObject({
        meta: { treePath: 'src/editor-tab-a.ts' },
        name: 'file-tree:src/editor-tab-a.ts',
      })

    performance.clearMarks('editor.file_open.file_read')
    performance.clearMarks('editor.worker.request')
    await triggerForesightElement(row)
    await expect
      .poll(() => performance.getEntriesByName('editor.file_open.file_read').length)
      .toBe(1)
    await expect
      .poll(preparationRequestTypes, { timeout: 20_000 })
      .toEqual(expect.arrayContaining(['open', 'parse', 'queryRange']))
    await awaitEditorSyntaxWorkerIdleFences()

    const activationPublication = observePreparedSelectionPublication(PREPARED_FILE_PATH)
    const workspaceBeforeActivation = requiredTreeWorkspaceStore().getState()
    expect(
      workspaceBeforeActivation.workbenchPanels.editorTabs.some(
        (tab) => tabFileResource(tab.content)?.path === PREPARED_FILE_PATH,
      ),
    ).toBe(false)
    const firstFrame = await activateTreeRowAndCaptureFirstFrame(row)

    expect(firstFrame.selectedPath).toBe(PREPARED_FILE_PATH)
    expect(firstFrame.text).toContain("export const editorTabA = 'real browser fixture A'")
    expect(firstFrame.rowCount).toBeGreaterThan(0)
    expect(activationPublication.read()).toMatchObject({
      documentId: fileDocumentKey(filesystemPath(PREPARED_FILE_PATH)),
      prepared: true,
      selectedPath: PREPARED_FILE_PATH,
    })
    activationPublication.stop()
  },
)

test('the live navigator retains search, consumes requested focus, reveals, and creates at root', async () => {
  const focusService = new FocusService()
  const fixture = await mountTreePane(focusService, { treeMounted: false })
  await expect.poll(() => treeCommandBus).not.toBeNull()

  const focusTicket = treeCommandBus!.dispatch('workspace.focusFileTree', invocation())
  expect(focusTicket.claimed).toBe(true)
  renderTreePane(focusService, fixture)

  const shadowRoot = await fileTreeShadowRoot()
  await expect.poll(() => activeTreePath(shadowRoot)).toBe('src/')
  await expect(focusTicket.completion).resolves.toEqual({ status: 'handled' })

  // The filter field is the tree's second header row, always on screen.
  const searchInput = searchField(shadowRoot)
  searchInput.focus()
  await expect.poll(() => shadowRoot.activeElement).toBe(searchInput)
  typeSearch(searchInput, 'file-7')
  await expect.poll(() => searchContainer(shadowRoot).dataset.open).toBe('true')

  clickToolbarButton('Outside tree')
  expect(searchInput.value).toBe('file-7')
  expect(searchContainer(shadowRoot).dataset.open).toBe('true')

  searchInput.focus()
  await expect.poll(() => searchInput.getAttribute('aria-activedescendant')).not.toBeNull()
  const firstMatch = searchInput.getAttribute('aria-activedescendant')
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
  await expect.poll(() => searchInput.getAttribute('aria-activedescendant')).not.toBe(firstMatch)
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }))
  await expect.poll(() => searchInput.getAttribute('aria-activedescendant')).toBe(firstMatch)

  searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  await expect.poll(() => searchContainer(shadowRoot).dataset.open).toBe('false')

  searchInput.focus()
  typeSearch(searchInput, 'file-0')
  await expect.poll(() => searchContainer(shadowRoot).dataset.open).toBe('true')
  clickToolbarButton('Select deep file')
  await expect.poll(() => selectedFilePathText()).toBe(DEEP_FILE_PATH)
  revealActiveFile()
  await expect.poll(() => searchContainer(shadowRoot).dataset.open).toBe('false')
  await expect.poll(() => activeTreePath(shadowRoot)).toBe('src/file-79.ts')
  expect(treeScroller(shadowRoot).scrollTop).toBeGreaterThan(0)

  const treeHost = document.querySelector('file-tree-container')
  clickToolbarButton('Mark deep file modified')
  await expect
    .poll(() => rowButton(shadowRoot, 'src/file-79.ts')?.dataset.itemGitStatus)
    .toBe('modified')
  const scroller = treeScroller(shadowRoot)
  scroller.scrollTop = 0
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
  await expect.poll(() => treeRow(shadowRoot, 'src/')?.dataset.itemContainsGitChange).toBe('true')
  clickToolbarButton('Clear git status')
  await expect
    .poll(() => treeRow(shadowRoot, 'src/')?.dataset.itemContainsGitChange)
    .toBeUndefined()
  revealActiveFile()
  await expect
    .poll(() => rowButton(shadowRoot, 'src/file-79.ts')?.dataset.itemGitStatus)
    .toBeUndefined()
  expect(document.querySelector('file-tree-container')).toBe(treeHost)

  clickToolbarButton('Select unloaded file')
  await expect.poll(() => selectedFilePathText()).toBe(UNLOADED_FILE_PATH)
  revealActiveFile()
  await expect.poll(() => activeTreePath(shadowRoot)).toBe('src/')

  treeToolbar!.createFile()
  await expect.poll(() => renameField(shadowRoot)).toBeTruthy()
  const renameInput = renameField(shadowRoot)!
  expect(renameInput.value).toBe('untitled')
  renameInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  await expect.poll(() => renameField(shadowRoot)).toBeNull()

  treeToolbar!.createFolder()
  await expect.poll(() => renameField(shadowRoot)?.value).toBe('new folder')
  renameField(shadowRoot)?.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  )
  await expect.poll(() => renameField(shadowRoot)).toBeNull()
})

test('a failed command-bus tree reveal rejects without changing focus ownership', async () => {
  const focusService = new FocusService()
  await mountTreePane(focusService, {
    commandSnapshot: { activeDocument: testDocumentRef(UNLOADED_FILE_PATH) },
  })

  await fileTreeShadowRoot()
  await expect.poll(() => treeCommandBus).not.toBeNull()
  const focusTicket = treeCommandBus!.dispatch('workspace.focusFileTree', invocation())
  await expect(focusTicket.completion).resolves.toEqual({ status: 'handled' })
  const owner = focusService.getSnapshot().currentOwner
  expect(owner?.id).toEqual({ kind: 'file-tree', rootPath: ROOT_PATH })

  const revealTicket = treeCommandBus!.dispatch('workspace.revealActiveFileInTree', invocation())

  expect(revealTicket.claimed).toBe(true)
  await expect(revealTicket.completion).resolves.toEqual({
    reason: 'handler-declined',
    status: 'unhandled',
  })
  expect(focusService.getSnapshot().currentOwner?.token).toBe(owner?.token)
})

test('selecting an editor tab expands and smoothly reveals its file without stealing focus', async () => {
  await mountTreePane()

  const shadowRoot = await fileTreeShadowRoot()
  const scroller = treeScroller(shadowRoot)

  clickToolbarButton('Select deep file')
  await expect.poll(() => selectedFilePathText()).toBe(DEEP_FILE_PATH)
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)

  clickToolbarButton('Select shallow file')
  await expect.poll(() => selectedFilePathText()).toBe(SHALLOW_FILE_PATH)
  await expect
    .poll(
      () =>
        scroller.scrollTop <= (rowButton(shadowRoot, 'src/')?.getBoundingClientRect().height ?? 0),
    )
    .toBe(true)
  await expect
    .poll(() => rowIsVisibleInScroller(rowButton(shadowRoot, 'src/file-0.ts'), scroller))
    .toBe(true)

  // With sticky folders on, an ancestor scrolled past the top exists only as
  // its sticky row, so the collapse has to go through whichever row is mounted.
  const sourceDirectory = treeRow(shadowRoot, 'src/')
  expect(sourceDirectory).not.toBeNull()
  sourceDirectory!.focus()
  sourceDirectory!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
  await expect.poll(() => treeRow(shadowRoot, 'src/')?.getAttribute('aria-expanded')).toBe('false')

  const requestedScrolls = observeScrollRequests(scroller)
  const selectDeepTabButton = toolbarButton('Select deep tab')
  selectDeepTabButton.focus()
  selectDeepTabButton.click()

  await expect.poll(() => selectedFilePathText()).toBe(DEEP_FILE_PATH)
  // Expanded again: a child row is mounted. The directory row itself may be
  // the sticky copy by now, which carries no expansion state of its own.
  await expect
    .poll(() => shadowRoot.querySelector('button[data-item-path^="src/file-"]'))
    .not.toBeNull()
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
  const smoothRequest = requestedScrolls.findLast((request) => request.behavior === 'smooth')
  expect(smoothRequest?.top).toBeTypeOf('number')
  if (typeof smoothRequest?.top !== 'number') return

  scroller.scrollTop = smoothRequest.top
  await expect
    .poll(() => rowIsVisibleInScroller(rowButton(shadowRoot, 'src/file-79.ts'), scroller))
    .toBe(true)
  expect(document.activeElement).toBe(selectDeepTabButton)
})

test('live density changes preserve the compact and cozy tree geometry and typography', async () => {
  const { queryClient } = await mountTreePane(new FocusService(), { density: 'compact' })

  const shadowRoot = await fileTreeShadowRoot()
  const treeHost = document.querySelector<HTMLElement>('file-tree-container')
  expect(treeHost).not.toBeNull()
  expect(treeHost!.style.getPropertyValue('--trees-font-family-override')).toBe(
    'var(--workbench-tree-font-family)',
  )
  expect(treeHost!.style.getPropertyValue('--trees-font-size-override')).toBe(
    'var(--workbench-tree-font-size)',
  )

  await expect
    .poll(() => treeDensityMetrics(shadowRoot))
    .toEqual({
      fontFamily: resolvedRootFontFamily('--font-ui'),
      fontSize: '12.5px',
      height: 20,
    })

  setWorkbenchDensity(queryClient, 'cozy')

  await expect
    .poll(() => treeDensityMetrics(shadowRoot))
    .toEqual({
      fontFamily: resolvedRootFontFamily('--font-mono'),
      fontSize: '12px',
      height: 24,
    })
})

function TreePaneHarness({
  editorMounted = false,
  initialModel = navigatorModel(),
  rootPath = ROOT_PATH,
}: {
  readonly editorMounted?: boolean
  readonly initialModel?: TreeModel
  readonly rootPath?: string
}) {
  const { selectFile, selectTab } = useEditorCommands()
  const selectedFilePath = useEditorWorkspaceState((state) =>
    state.selectedTabContent ? (tabFileResource(state.selectedTabContent)?.path ?? null) : null,
  )
  const workbenchPanels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const [gitStatus, setGitStatus] = useState<readonly GitStatusEntry[]>([])
  const [model] = useState(initialModel)
  const deepTab = workbenchPanels.editorTabs.find(
    (tab) => tabFileResource(tab.content)?.path === DEEP_FILE_PATH,
  )
  const activeTab = activeEditorTab(workbenchPanels)

  return (
    <>
      <button aria-label='Outside tree' type='button'>
        Outside
      </button>
      <button
        aria-label='Select deep file'
        type='button'
        onClick={() => selectFile(filesystemPath(DEEP_FILE_PATH))}
      >
        Select deep file
      </button>
      <button
        aria-label='Select shallow file'
        type='button'
        onClick={() => selectFile(filesystemPath(SHALLOW_FILE_PATH))}
      >
        Select shallow file
      </button>
      <button
        aria-label='Select deep tab'
        disabled={!deepTab}
        type='button'
        onClick={() => {
          if (!deepTab) return

          selectTab('main', deepTab.id)
        }}
      >
        Select deep tab
      </button>
      <button
        aria-label='Select unloaded file'
        type='button'
        onClick={() => selectFile(filesystemPath(UNLOADED_FILE_PATH))}
      >
        Select unloaded file
      </button>
      <button
        aria-label='Mark deep file modified'
        type='button'
        onClick={() => setGitStatus([{ path: 'src/file-79.ts', status: 'modified' }])}
      >
        Mark modified
      </button>
      <button aria-label='Clear git status' type='button' onClick={() => setGitStatus([])}>
        Clear status
      </button>
      <output data-selected-file-path>{selectedFilePath}</output>
      <div className='h-[180px] w-[360px]'>
        <TreePane
          gitStatus={gitStatus}
          rootPath={filesystemPath(rootPath)}
          state={{ data: model, status: 'ready' }}
        />
      </div>
      {editorMounted && activeTab ? (
        <div className='h-[240px] w-[640px]'>
          <EditorSurfaceTabBody
            active
            content={activeTab.content}
            rootPath={filesystemPath(rootPath)}
            tabId={activeTab.id}
          />
        </div>
      ) : null}
    </>
  )
}

function TreeCommandBusCapture() {
  const { bus } = useCommand()

  useEffect(() => {
    treeCommandBus = bus
    return () => {
      if (treeCommandBus === bus) treeCommandBus = null
    }
  }, [bus])

  return null
}

function TreeRuntimeCapture() {
  const commands = useEditorCommands()
  const documentStore = useEditorDocumentStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()

  useEffect(() => {
    treeDocumentStore = documentStore
    treeEditorCommands = commands
    treeWorkspaceStore = workspaceStore
    return () => {
      if (treeDocumentStore === documentStore) treeDocumentStore = null
      if (treeEditorCommands === commands) treeEditorCommands = null
      if (treeWorkspaceStore === workspaceStore) treeWorkspaceStore = null
    }
  }, [commands, documentStore, workspaceStore])

  return null
}

async function mountTreePane(
  focusService: FocusService = new FocusService(),
  options: {
    readonly density?: SettingsValues['workbench.density']
    readonly commandSnapshot?: { readonly activeDocument: DocumentRef | null }
    readonly editorMounted?: boolean
    readonly model?: TreeModel
    readonly rootPath?: string
    readonly treeMounted?: boolean
  } = {},
) {
  seedBootMirrorTheme('dark')
  const fixture = await createBrowserWorkspace(options.rootPath ?? ROOT_PATH)
  if (options.density) setWorkbenchDensity(fixture.queryClient, options.density)
  const host = document.createElement('main')
  document.body.append(host)
  root = createRoot(host)

  renderTreePane(focusService, fixture, options)
  return fixture
}

function renderTreePane(
  focusService: FocusService,
  fixture: Awaited<ReturnType<typeof createBrowserWorkspace>>,
  options: {
    readonly density?: SettingsValues['workbench.density']
    readonly commandSnapshot?: { readonly activeDocument: DocumentRef | null }
    readonly editorMounted?: boolean
    readonly model?: TreeModel
    readonly rootPath?: string
    readonly treeMounted?: boolean
  } = {},
) {
  const rootPath = options.rootPath ?? ROOT_PATH
  flushSync(() => {
    root?.render(
      <AppProviders
        application={fixture.application}
        navigation={fixture.navigation}
        command={{ rootPath, snapshot: options.commandSnapshot }}
        focusService={focusService}
        queryClient={fixture.queryClient}
      >
        <EditorStateProvider>
          <TreeCommandBusCapture />
          <TreeRuntimeCapture />
          <FileTreeActionsContext value={fileTreeActions}>
            {options.treeMounted === false ? null : (
              <div data-workbench=''>
                <TreePaneHarness
                  editorMounted={options.editorMounted}
                  initialModel={options.model}
                  rootPath={filesystemPath(rootPath)}
                />
              </div>
            )}
          </FileTreeActionsContext>
        </EditorStateProvider>
      </AppProviders>,
    )
  })
}

function invocation() {
  return { source: { caller: 'tree-pane-browser', kind: 'programmatic' } } as const
}

function navigatorModel() {
  const children = Array.from({ length: 80 }, (_, index) =>
    file(`${ROOT_PATH}/src/file-${index}.ts`),
  )
  const model = treeModel(tree(ROOT_PATH, [directory(`${ROOT_PATH}/src`, children)]), ROOT_PATH)
  model.loadedDirectoryPaths.add('src')

  return model
}

function preparedNavigatorModel() {
  const sourceDirectory = directory(`${PREPARED_ROOT_PATH}/src`, [file(PREPARED_FILE_PATH)])
  const model = treeModel(tree(PREPARED_ROOT_PATH, [sourceDirectory]), PREPARED_ROOT_PATH)
  model.loadedDirectoryPaths.add('src')
  return model
}

function tree(path: string, entries: TreeEntry[]): TreeResult {
  return { entries, path: filesystemPath(path) }
}

function directory(path: string, children: TreeEntry[]): TreeEntry {
  return { ...entry(path), children, type: 'directory' }
}

function file(path: string): TreeEntry {
  return { ...entry(path), type: 'file' }
}

function entry(path: string) {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 1,
    version: `browser:1:${path}`,
  }
}

async function fileTreeShadowRoot() {
  await expect.poll(() => document.querySelector('file-tree-container')?.shadowRoot).toBeTruthy()

  return document.querySelector('file-tree-container')!.shadowRoot!
}

function clickToolbarButton(label: string) {
  const button = toolbarButton(label)
  button.click()
}

function toolbarButton(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button).not.toBeNull()

  return button!
}

function searchField(shadowRoot: ShadowRoot) {
  const input = shadowRoot.querySelector<HTMLInputElement>('[data-file-tree-search-input]')
  expect(input).not.toBeNull()

  return input!
}

function renameField(shadowRoot: ShadowRoot) {
  return shadowRoot.querySelector<HTMLInputElement>('[data-item-rename-input]')
}

function rowButton(shadowRoot: ShadowRoot, path: string) {
  return shadowRoot.querySelector<HTMLButtonElement>(
    `button[data-item-path="${path}"]:not([data-file-tree-sticky-row="true"])`,
  )
}

async function triggerForesightElement(target: HTMLElement): Promise<void> {
  await expect
    .poll(() => ForesightManager.instance.getManagerData.loadedModules.desktopHandler)
    .toBe(true)
  const bounds = target.getBoundingClientRect()
  dispatchPointerMove(bounds.left + bounds.width / 2, bounds.bottom + 100)
  await nextAnimationFrame()
  dispatchPointerMove(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
  await nextAnimationFrame()
}

async function activateTreeRowAndCaptureFirstFrame(row: HTMLButtonElement) {
  const firstFrame = new Promise<TreeActivationFirstFrame>((resolve) => {
    requestAnimationFrame(() => {
      const surface = document.querySelector<HTMLElement>('.editor-virtualized')
      resolve({
        rowCount: document.querySelectorAll('.editor-virtualized-row').length,
        selectedPath: selectedFilePathText(),
        text: Array.from(
          surface?.querySelectorAll('.editor-virtualized-row') ?? [],
          (row) => row.textContent ?? '',
        ).join('\n'),
      })
    })
  })
  row.click()
  return firstFrame
}

function preparationRequestTypes(): string[] {
  return performance
    .getEntriesByName('editor.worker.request', 'mark')
    .map((entry) => (entry as PerformanceMark).detail?.type)
    .filter((type): type is string => typeof type === 'string')
}

function observePreparedSelectionPublication(path: string) {
  const documentStore = requiredTreeDocumentStore()
  const workspaceStore = requiredTreeWorkspaceStore()
  let publication: PreparedSelectionPublication | null = null
  const stop = workspaceStore.subscribe(
    (state) =>
      state.selectedTabContent ? (tabFileResource(state.selectedTabContent)?.path ?? null) : null,
    (selectedPath, previousPath) => {
      if (selectedPath !== path || previousPath === path) return

      const tab = activeTabForPath(workspaceStore.getState(), path)
      if (!tab) return

      const view = documentStore.getState().viewsByTabId[tab.id]
      publication = {
        documentId: view?.documentKey ?? null,
        prepared: view?.preparedDocument !== null && view?.preparedDocument !== undefined,
        selectedPath,
        tabId: tab.id,
      }
    },
  )
  return { read: () => publication, stop }
}

function activeTabForPath(state: EditorWorkspaceStore, path: string) {
  const activeTab = activeEditorTab(state.workbenchPanels)
  if (!activeTab || tabFileResource(activeTab.content)?.path !== path) return null
  return activeTab
}

function activeEditorTab(panels: EditorWorkspaceStore['workbenchPanels']) {
  const activeTabId = panels.activeEditorTabId
  if (!activeTabId) return null
  return panels.editorTabs.find((tab) => tab.id === activeTabId) ?? null
}

function dispatchPointerMove(clientX: number, clientY: number): void {
  document.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX, clientY, pointerType: 'mouse' }),
  )
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function requiredTreeDocumentStore(): EditorDocumentStoreApi {
  if (!treeDocumentStore) throw new RangeError('file-tree document store unavailable')
  return treeDocumentStore
}

function requiredTreeWorkspaceStore(): EditorWorkspaceStoreApi {
  if (!treeWorkspaceStore) throw new RangeError('file-tree workspace store unavailable')
  return treeWorkspaceStore
}

function treeRuntimeIsReady(): boolean {
  return Boolean(treeDocumentStore && treeEditorCommands && treeWorkspaceStore)
}

function treeRow(shadowRoot: ShadowRoot, path: string) {
  return shadowRoot.querySelector<HTMLButtonElement>(`button[data-item-path="${path}"]`)
}

function searchContainer(shadowRoot: ShadowRoot) {
  return shadowRoot.querySelector<HTMLElement>('[data-file-tree-search-container]')!
}

function treeScroller(shadowRoot: ShadowRoot) {
  return shadowRoot.querySelector<HTMLElement>('[data-file-tree-virtualized-scroll="true"]')!
}

function treeDensityMetrics(shadowRoot: ShadowRoot) {
  const row = rowButton(shadowRoot, 'src/')
  if (!row) return null

  const style = getComputedStyle(row)
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    height: row.getBoundingClientRect().height,
  }
}

function resolvedRootFontFamily(variable: '--font-mono' | '--font-ui') {
  const probe = document.createElement('span')
  probe.style.fontFamily = `var(${variable})`
  document.body.append(probe)
  const fontFamily = getComputedStyle(probe).fontFamily
  probe.remove()

  return fontFamily
}

function setWorkbenchDensity(
  queryClient: QueryClient,
  density: SettingsValues['workbench.density'],
) {
  document.documentElement.dataset.density = density
  queryClient.setQueryData(settingsKeys.document(), settingsSnapshot(density))
}

function settingsSnapshot(density: SettingsValues['workbench.density']): SettingsSnapshot {
  return {
    diagnostics: [],
    layers: [],
    serverVersion: { epoch: 'tree-pane-test', sequence: density === 'cozy' ? 1 : 2 },
    values: { ...DEFAULT_SETTING_VALUES, 'workbench.density': density },
  }
}

function observeScrollRequests(scroller: HTMLElement) {
  const requests: ScrollToOptions[] = []
  const scrollTo = scroller.scrollTo.bind(scroller)
  scroller.scrollTo = ((optionsOrX?: ScrollToOptions | number, y?: number) => {
    if (typeof optionsOrX === 'number') {
      scrollTo(optionsOrX, y ?? 0)
      return
    }

    requests.push(optionsOrX ?? {})
    scrollTo(optionsOrX)
  }) as typeof scroller.scrollTo

  return requests
}

function rowIsVisibleInScroller(row: HTMLElement | null, scroller: HTMLElement) {
  if (!row) return false

  const rowBounds = row.getBoundingClientRect()
  const scrollerBounds = scroller.getBoundingClientRect()
  return rowBounds.top >= scrollerBounds.top && rowBounds.bottom <= scrollerBounds.bottom
}

function typeSearch(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
}

function revealActiveFile() {
  expect(treeToolbar).not.toBeNull()
  treeToolbar!.revealActiveFile()
}

function selectedFilePathText() {
  return document.querySelector('output[data-selected-file-path]')?.textContent ?? null
}

function activeTreePath(shadowRoot: ShadowRoot) {
  const activeElement = shadowRoot.activeElement
  if (!(activeElement instanceof HTMLElement)) return null

  return activeElement.dataset.itemPath ?? null
}

type TreeActivationFirstFrame = {
  readonly rowCount: number
  readonly selectedPath: string | null
  readonly text: string
}

type PreparedSelectionPublication = {
  readonly documentId: string | null
  readonly prepared: boolean
  readonly selectedPath: string
  readonly tabId: string
}

const editorDiagnosticGlobal = globalThis as typeof globalThis & {
  __editorPerfTrace?: { readonly mark: () => void }
}
