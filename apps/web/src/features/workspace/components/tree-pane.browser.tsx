import '@workspace/ui/globals.css'
import '@singapor/core/style.css'
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

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { useEditorCommands, type EditorCommands } from '@/features/editor/state/commands'
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
} from '@/features/workspace/providers/actions-context'
import { useCommand } from '@/keymap/hooks/use-command'
import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import { FocusService } from '@/lib/focus/state/service'
import type { TreeEntry, TreeResult } from '@/lib/file-system-types'
import { treeModel, type TreeModel } from '@/lib/tree-model'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'

const ROOT_PATH = '/repo'
const PREPARED_ROOT_PATH = 'repo'
const DEEP_FILE_PATH = `${ROOT_PATH}/src/file-79.ts`
const PREPARED_FILE_PATH = `${PREPARED_ROOT_PATH}/src/editor-tab-a.ts`
const SHALLOW_FILE_PATH = `${ROOT_PATH}/src/file-0.ts`
const UNLOADED_FILE_PATH = `${ROOT_PATH}/src/unloaded/deep.ts`

const fileTreeActions: FileTreeActions = {
  loadDirectory: () => {},
  prefetchDirectory: () => {},
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
    mountTreePane(new FocusService(), createTestQueryClient(), {
      editorMounted: true,
      model: preparedNavigatorModel(),
      rootPath: PREPARED_ROOT_PATH,
    })
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const shadowRoot = await fileTreeShadowRoot()
    await expect.poll(treeRuntimeIsReady).toBe(true)
    flushSync(() => requiredTreeEditorCommands().switchRootFolder(preparedRootFolder()))

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
        (tab) => tab.path === PREPARED_FILE_PATH,
      ),
    ).toBe(false)
    const firstFrame = await activateTreeRowAndCaptureFirstFrame(row)

    expect(firstFrame.selectedPath).toBe(PREPARED_FILE_PATH)
    expect(firstFrame.text).toContain("export const editorTabA = 'real browser fixture A'")
    expect(firstFrame.rowCount).toBeGreaterThan(0)
    expect(activationPublication.read()).toMatchObject({
      documentId: PREPARED_FILE_PATH,
      prepared: true,
      selectedPath: PREPARED_FILE_PATH,
    })
    activationPublication.stop()
  },
)

test('the live navigator retains search, consumes requested focus, reveals, and creates at root', async () => {
  const focusService = new FocusService()
  const queryClient = createTestQueryClient()
  mountTreePane(focusService, queryClient, { treeMounted: false })
  await expect.poll(() => treeCommandBus).not.toBeNull()

  const focusTicket = treeCommandBus!.dispatch('workspace.focusFileTree', invocation())
  expect(focusTicket.claimed).toBe(true)
  renderTreePane(focusService, queryClient)

  const shadowRoot = await fileTreeShadowRoot()
  await expect.poll(() => activeTreePath(shadowRoot)).toBe('src/')
  await expect(focusTicket.completion).resolves.toEqual({ status: 'handled' })

  clickToolbarButton('Filter files')
  const searchInput = searchField(shadowRoot)
  await expect.poll(() => shadowRoot.activeElement).toBe(searchInput)
  typeSearch(searchInput, 'file-7')
  await expect.poll(() => matchCountText()).toBe('11 matches')

  clickToolbarButton('Outside tree')
  expect(searchInput.value).toBe('file-7')
  expect(searchContainer(shadowRoot).dataset.open).toBe('true')

  const firstMatch = searchInput.getAttribute('aria-activedescendant')
  expect(firstMatch).not.toBeNull()
  clickToolbarButton('Next file match')
  await expect.poll(() => searchInput.getAttribute('aria-activedescendant')).not.toBe(firstMatch)
  clickToolbarButton('Previous file match')
  await expect.poll(() => searchInput.getAttribute('aria-activedescendant')).toBe(firstMatch)

  clickToolbarButton('Clear file filter')
  await expect.poll(() => searchInput.value).toBe('')
  await expect.poll(() => shadowRoot.activeElement).toBe(searchInput)
  expect(document.querySelector('output[aria-live="polite"]')).toBeNull()

  clickToolbarButton('Close file filter')
  await expect.poll(() => searchContainer(shadowRoot).dataset.open).toBe('false')
  clickToolbarButton('Filter files')
  await expect.poll(() => shadowRoot.activeElement).toBe(searchInput)
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  await expect.poll(() => searchContainer(shadowRoot).dataset.open).toBe('false')

  clickToolbarButton('Filter files')
  await expect.poll(() => shadowRoot.activeElement).toBe(searchInput)
  typeSearch(searchInput, 'file-0')
  await expect.poll(() => matchCountText()).toBe('1 match')
  clickToolbarButton('Select deep file')
  await expect.poll(() => selectedFilePathText()).toBe(DEEP_FILE_PATH)
  clickToolbarButton('Reveal active file in tree')
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
  clickToolbarButton('Reveal active file in tree')
  await expect
    .poll(() => rowButton(shadowRoot, 'src/file-79.ts')?.dataset.itemGitStatus)
    .toBeUndefined()
  expect(document.querySelector('file-tree-container')).toBe(treeHost)

  clickToolbarButton('Select unloaded file')
  await expect.poll(() => selectedFilePathText()).toBe(UNLOADED_FILE_PATH)
  clickToolbarButton('Reveal active file in tree')
  await expect.poll(() => activeTreePath(shadowRoot)).toBe('src/')

  clickToolbarButton('New file at workspace root')
  await expect.poll(() => renameField(shadowRoot)).toBeTruthy()
  const renameInput = renameField(shadowRoot)!
  expect(renameInput.value).toBe('untitled')
  renameInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  await expect.poll(() => renameField(shadowRoot)).toBeNull()

  clickToolbarButton('New folder at workspace root')
  await expect.poll(() => renameField(shadowRoot)?.value).toBe('new folder')
  renameField(shadowRoot)?.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  )
  await expect.poll(() => renameField(shadowRoot)).toBeNull()
})

test('a failed command-bus tree reveal rejects without changing focus ownership', async () => {
  const focusService = new FocusService()
  mountTreePane(focusService, createTestQueryClient(), {
    commandSnapshot: { activeFilePath: UNLOADED_FILE_PATH },
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
  mountTreePane()

  const shadowRoot = await fileTreeShadowRoot()
  const scroller = treeScroller(shadowRoot)

  clickToolbarButton('Select deep file')
  await expect.poll(() => selectedFilePathText()).toBe(DEEP_FILE_PATH)
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)

  clickToolbarButton('Select shallow file')
  await expect.poll(() => selectedFilePathText()).toBe(SHALLOW_FILE_PATH)
  await expect.poll(() => scroller.scrollTop).toBeLessThanOrEqual(20)

  const sourceDirectory = rowButton(shadowRoot, 'src/')
  expect(sourceDirectory).not.toBeNull()
  sourceDirectory!.focus()
  sourceDirectory!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
  await expect
    .poll(() => rowButton(shadowRoot, 'src/')?.getAttribute('aria-expanded'))
    .toBe('false')

  const requestedScrolls = observeScrollRequests(scroller)
  const selectDeepTabButton = toolbarButton('Select deep tab')
  selectDeepTabButton.focus()
  selectDeepTabButton.click()

  await expect.poll(() => selectedFilePathText()).toBe(DEEP_FILE_PATH)
  await expect.poll(() => rowButton(shadowRoot, 'src/')?.getAttribute('aria-expanded')).toBe('true')
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
  const queryClient = createTestQueryClient()
  setWorkbenchDensity(queryClient, 'compact')
  mountTreePane(new FocusService(), queryClient)

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
  const selectedFilePath = useEditorWorkspaceState((state) => state.selectedFilePath)
  const workbenchPanels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const [gitStatus, setGitStatus] = useState<readonly GitStatusEntry[]>([])
  const [model] = useState(initialModel)
  const deepTab = workbenchPanels.editorTabs.find((tab) => tab.path === DEEP_FILE_PATH)
  const activeTab = activeEditorTab(workbenchPanels)

  return (
    <>
      <button aria-label='Outside tree' type='button'>
        Outside
      </button>
      <button
        aria-label='Select deep file'
        type='button'
        onClick={() => selectFile(DEEP_FILE_PATH)}
      >
        Select deep file
      </button>
      <button
        aria-label='Select shallow file'
        type='button'
        onClick={() => selectFile(SHALLOW_FILE_PATH)}
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
        onClick={() => selectFile(UNLOADED_FILE_PATH)}
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
          rootPath={rootPath}
          state={{ data: model, status: 'ready' }}
        />
      </div>
      {editorMounted && activeTab ? (
        <div className='h-[240px] w-[640px]'>
          <EditorSurfaceTabBody
            active
            path={activeTab.path}
            rootPath={rootPath}
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

function mountTreePane(
  focusService: FocusService = new FocusService(),
  queryClient: QueryClient = createTestQueryClient(),
  options: {
    readonly commandSnapshot?: { readonly activeFilePath: string | null }
    readonly editorMounted?: boolean
    readonly model?: TreeModel
    readonly rootPath?: string
    readonly treeMounted?: boolean
  } = {},
) {
  seedBootMirrorTheme('dark')
  const host = document.createElement('main')
  document.body.append(host)
  root = createRoot(host)

  renderTreePane(focusService, queryClient, options)
}

function renderTreePane(
  focusService: FocusService,
  queryClient: QueryClient,
  options: {
    readonly commandSnapshot?: { readonly activeFilePath: string | null }
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
        command={{ rootPath, snapshot: options.commandSnapshot }}
        focusService={focusService}
        queryClient={queryClient}
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
                  rootPath={rootPath}
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

function preparedRootFolder() {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: PREPARED_ROOT_PATH,
    path: PREPARED_ROOT_PATH,
    size: 0,
    type: 'directory' as const,
    version: 'tree-pane-browser-fixture',
  }
}

function tree(path: string, entries: TreeEntry[]): TreeResult {
  return { entries, path }
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
    path,
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
        text: surface?.textContent ?? '',
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
    (state) => state.selectedFilePath,
    (selectedPath, previousPath) => {
      if (selectedPath !== path || previousPath === path) return

      const tab = activeTabForPath(workspaceStore.getState(), path)
      if (!tab) return

      const view = documentStore.getState().viewsByTabId[tab.id]
      publication = {
        documentId: view?.documentId ?? null,
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
  if (activeTab?.path !== path) return null
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

function requiredTreeEditorCommands(): EditorCommands {
  if (!treeEditorCommands) throw new RangeError('file-tree editor commands unavailable')
  return treeEditorCommands
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

function matchCountText() {
  return document.querySelector('output[aria-live="polite"]')?.textContent?.trim() ?? null
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
