import '@workspace/ui/globals.css'
import '@singapor/core/style.css'
import '@singapor/gutters/style.css'
import { createEditorBufferSession } from '@singapor/core'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { ForesightManager } from 'js.foresight'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { useEditorCommands, type EditorCommands } from '@/features/editor/state/commands'
import {
  useEditorDocumentStoreApi,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import {
  resetEditorColorThemeStore,
  setSelectedEditorThemeId,
} from '@/features/editor/state/color-theme-store'
import {
  installEditorPerformanceTraceFromUrl,
  type EditorOpenSampleResetResult,
} from '@/features/editor/state/performance-trace'
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
import { EditorSurfaceTabBody } from '@/features/workbench/components/editor-surface-tab-body'
import { useEditorTabIntentPrefetch } from '@/features/workspace/hooks/use-tab-intent-prefetch'
import { createIntentPrefetchRegistry } from '@/features/workspace/utils/intent-prefetch-registry'
import {
  ensureFileSnapshotQuery,
  fileSnapshotQueryOptions,
  FILE_SNAPSHOT_STALE_MS,
} from '@/lib/file-snapshot-query-cache'
import type { FileResult } from '@/lib/file-system-types'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'
import {
  installDelayedFileReadClient,
  type DelayedFileReadClient,
} from '../../../../test/factories/delayed-file-read-client'

const PATH = 'repo/src/editor-tab-a.ts'
const ROOT_PATH = 'repo'
const originalUrl = window.location.href
let root: Root | null = null
let runtime: PreparedOpenRuntime | null = null
let diagnostics: EditorDiagnostic[] = []
let delayedFileRead: DelayedFileReadClient | null = null
let workerRequestGate: EditorWorkerRequestGate | null = null

afterEach(async () => {
  workerRequestGate?.restore()
  workerRequestGate = null
  delayedFileRead?.restore()
  delayedFileRead = null
  if (root) flushSync(() => root?.unmount())
  root = null
  runtime = null
  diagnostics = []
  editorDiagnosticGlobal.__editorPerfTrace?.stop?.()
  editorDiagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = null
  editorDiagnosticGlobal.__editorPerfTrace = undefined
  history.replaceState(null, '', originalUrl)
  await Promise.all([disposeEditorShikiWorkerOwner(), disposeEditorTreeSitterSyntaxProvider()])
  resetEditorColorThemeStore()
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark', 'light')
  localStorage.clear()
  performance.clearMarks()
  performance.clearMeasures()
})

test(
  'promotes a real Foresight tab prediction in the first browser frame without duplicate work',
  { timeout: 30_000 },
  async () => {
    seedBootMirrorTheme('dark')
    resetEditorColorThemeStore()
    setSelectedEditorThemeId('dark', 'dark-plus')
    installBenchmarkTrace()
    const queryClient = createTestQueryClient()
    mountHarness(queryClient)
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()

    flushSync(() => {
      harness.commands.switchRootFolder(rootFolder())
      harness.commands.openSearchEditor(ROOT_PATH)
    })
    const sampleId = await beginBenchmarkSampleWhenReady()
    await expect.poll(registeredForesightTarget).toMatchObject({
      meta: { path: PATH, rootPath: ROOT_PATH, tabId: 'prepared-open-browser-target' },
      name: expect.stringContaining('editor-tab:'),
    })
    performance.clearMarks('editor.worker.request')
    await triggerForesightIntent()
    await expect
      .poll(preparationRequestTypes, { timeout: 20_000 })
      .toEqual(expect.arrayContaining(['open', 'parse', 'queryRange']))
    await awaitEditorSyntaxWorkerIdleFences()
    await Promise.resolve()

    diagnostics = []
    performance.clearMarks('editor.worker.request')
    performance.clearMarks('editor.file_open.buffer_built')
    performance.clearMarks('editor.file_open.file_read')
    performance.clearMarks('editor.authoritative_text_paint')
    performance.clearMarks('editor.authoritative_highlight_paint')
    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.text).toContain("export const editorTabA = 'real browser fixture A'")
    expect(firstFrame.rowCount).toBeGreaterThan(0)
    expect(firstFrame.viewportHeight).toBeGreaterThan(0)
    expect(firstFrame.viewportWidth).toBeGreaterThan(0)
    await expect
      .poll(() => document.querySelector('.editor-virtualized')?.textContent, { timeout: 10_000 })
      .toContain("export const editorTabA = 'real browser fixture A'")
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length)
      .toBe(1)

    expect(attachmentDiagnostic()?.detail).toMatchObject({
      highlighter: 'ready',
      prepared: true,
      structural: 'ready',
    })
    expect(postActivationStructuralDiagnostics()).toEqual([])
    expect(postActivationTransferRequestTypes()).toEqual([])
    expect(performance.getEntriesByName('editor.file_open.buffer_built')).toEqual([])
    expect(performance.getEntriesByName('editor.file_open.file_read')).toEqual([])
    expect(performance.getEntriesByName('editor.authoritative_text_paint')).toHaveLength(1)
    assertDistinctTransferredRuntimeIds(await resetBenchmarkSample(sampleId))
  },
)

test(
  'installs a query-ready file before the first browser frame',
  { timeout: 30_000 },
  async () => {
    seedBootMirrorTheme('dark')
    resetEditorColorThemeStore()
    setSelectedEditorThemeId('dark', 'dark-plus')
    editorDiagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
      diagnostics.push(diagnostic)
    }
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const queryClient = createTestQueryClient()
    mountHarness(queryClient)
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()

    flushSync(() => harness.commands.switchRootFolder(rootFolder()))
    await ensureFileSnapshotQuery(queryClient, PATH)
    diagnostics = []
    performance.clearMarks('editor.file_open.file_read')
    performance.clearMarks('editor.authoritative_text_paint')
    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.text).toContain("export const editorTabA = 'real browser fixture A'")
    expect(firstFrame.rowCount).toBeGreaterThan(0)
    expect(firstFrame.viewportHeight).toBeGreaterThan(0)
    expect(firstFrame.viewportWidth).toBeGreaterThan(0)
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_text_paint').length)
      .toBe(1)
    expect(attachmentDiagnostic()?.detail).toMatchObject({ prepared: false })
    expect(performance.getEntriesByName('editor.file_open.file_read')).toEqual([])
  },
)

test(
  'publishes a miss immediately while the real file read remains delayed',
  { timeout: 30_000 },
  async () => {
    seedBootMirrorTheme('dark')
    resetEditorColorThemeStore()
    setSelectedEditorThemeId('dark', 'dark-plus')
    installBenchmarkTrace()
    const queryClient = createTestQueryClient()
    mountHarness(queryClient)
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()
    flushSync(() => harness.commands.switchRootFolder(rootFolder()))
    delayedFileRead = installDelayedFileReadClient(queryClient)

    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.selectedPath).toBe(PATH)
    expect(firstFrame.text).toBe('')
    expect(firstFrame.rowCount).toBe(0)
    await expect.poll(delayedFileRead.observedStatus).toBe(200)
    expect(performance.getEntriesByName('editor.authoritative_text_paint')).toHaveLength(0)

    delayedFileRead.release()
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)
    const highlighterRuntimeSessionIds = workerRuntimeSessionIds('shiki')
    const structuralRuntimeSessionIds = workerRuntimeSessionIds('tree-sitter')
    expect(highlighterRuntimeSessionIds).toHaveLength(1)
    expect(structuralRuntimeSessionIds).toHaveLength(1)
    expect(highlighterRuntimeSessionIds[0]).not.toBe(structuralRuntimeSessionIds[0])
    expect(performance.getEntriesByName('editor.file_open.file_read')).toHaveLength(1)
  },
)

test(
  'reopens retained dirty text before a deliberately delayed file query',
  { timeout: 30_000 },
  async () => {
    seedBootMirrorTheme('dark')
    resetEditorColorThemeStore()
    setSelectedEditorThemeId('dark', 'dark-plus')
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const queryClient = createTestQueryClient()
    mountHarness(queryClient)
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()
    flushSync(() => harness.commands.switchRootFolder(rootFolder()))
    await ensureFileSnapshotQuery(queryClient, PATH)
    await activateAndCaptureFirstFrame()
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)

    const retained = harness.documentStore.getState().getLiveEditorDocument(PATH)
    if (!retained) throw new RangeError('retained browser document unavailable')
    createEditorBufferSession(retained.buffer).applyText('retained dirty browser text')
    const activeTabId = harness.workspaceStore.getState().workbenchPanels.activeEditorTabId
    if (!activeTabId) throw new RangeError('active browser tab unavailable')
    flushSync(() => harness.commands.closeTab(activeTabId))
    const queryKey = fileSnapshotQueryOptions(PATH).queryKey
    await queryClient.cancelQueries({ exact: true, queryKey })
    queryClient.removeQueries({ exact: true, queryKey })
    delayedFileRead = installDelayedFileReadClient(queryClient)
    performance.clearMarks('editor.authoritative_text_paint')
    performance.clearMarks('editor.authoritative_highlight_paint')

    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.selectedPath).toBe(PATH)
    expect(firstFrame.text).toContain('retained dirty browser text')
    expect(firstFrame.rowCount).toBeGreaterThan(0)
    expect(harness.documentStore.getState().getLiveEditorDocument(PATH)?.buffer).toBe(
      retained.buffer,
    )
    await expect.poll(delayedFileRead.observedStatus).toBe(200)
    expect(performance.getEntriesByName('editor.authoritative_highlight_paint')).toHaveLength(0)

    delayedFileRead.release()
    await nextAnimationFrame()
    expect(document.querySelector('.editor-virtualized')?.textContent).toContain(
      'retained dirty browser text',
    )
  },
)

test(
  'adopts pending Tree-sitter beside ready Shiki without duplicate worker requests',
  { timeout: 30_000 },
  async () => {
    seedBootMirrorTheme('dark')
    resetEditorColorThemeStore()
    setSelectedEditorThemeId('dark', 'dark-plus')
    installBenchmarkTrace()
    const queryClient = createTestQueryClient()
    mountHarness(queryClient)
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()
    flushSync(() => {
      harness.commands.switchRootFolder(rootFolder())
      harness.commands.openSearchEditor(ROOT_PATH)
    })
    const sampleId = await beginBenchmarkSampleWhenReady()
    workerRequestGate = installEditorWorkerRequestGate(['queryRange'])

    await triggerForesightIntent()
    await expect.poll(workerRequestGate.heldTypes, { timeout: 20_000 }).toEqual(['queryRange'])
    diagnostics = []
    performance.clearMarks('editor.worker.request')
    performance.clearMarks('editor.authoritative_text_paint')
    performance.clearMarks('editor.authoritative_highlight_paint')

    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.text).toContain("export const editorTabA = 'real browser fixture A'")
    expect(firstFrame.rowCount).toBeGreaterThan(0)
    expect(attachmentDiagnostic()?.detail).toMatchObject({
      highlighter: 'ready',
      prepared: true,
      structural: 'pending',
    })
    workerRequestGate.restore()
    workerRequestGate = null
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)
    expect(postActivationTransferRequestTypes()).toEqual([])
    assertDistinctTransferredRuntimeIds(await resetBenchmarkSample(sampleId))
  },
)

test(
  'rejects an invalidated exact lease and lets normal highlighting win',
  { timeout: 30_000 },
  async () => {
    seedBootMirrorTheme('dark')
    resetEditorColorThemeStore()
    setSelectedEditorThemeId('dark', 'dark-plus')
    editorDiagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
      diagnostics.push(diagnostic)
    }
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const queryClient = createTestQueryClient()
    mountHarness(queryClient)
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()
    flushSync(() => harness.commands.switchRootFolder(rootFolder()))
    await triggerForesightIntent()
    await expect
      .poll(preparationRequestTypes, { timeout: 20_000 })
      .toEqual(expect.arrayContaining(['open', 'parse', 'queryRange']))
    await awaitEditorSyntaxWorkerIdleFences()
    const queryKey = fileSnapshotQueryOptions(PATH).queryKey
    const file = queryClient.getQueryData<FileResult>(queryKey)
    if (!file) throw new RangeError('prepared browser file unavailable')
    queryClient.setQueryData(queryKey, { ...file, version: `${file.version}:invalidated` })
    await awaitEditorSyntaxWorkerIdleFences()
    diagnostics = []
    performance.clearMarks('editor.authoritative_highlight_paint')

    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.selectedPath).toBe(PATH)
    expect(firstFrame.text).toContain("export const editorTabA = 'real browser fixture A'")
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)
    expect(attachmentDiagnostic()?.detail).toMatchObject({ prepared: false })
  },
)

test('delivers an imperative row prediction through the real Foresight manager', async () => {
  const target = document.createElement('button')
  target.dataset.imperativeForesightTarget = ''
  target.style.height = '40px'
  target.style.left = '300px'
  target.style.position = 'fixed'
  target.style.top = '120px'
  target.style.width = '180px'
  document.body.append(target)
  const intents: string[] = []
  const registry = createIntentPrefetchRegistry({
    reactivateAfter: FILE_SNAPSHOT_STALE_MS,
    resolveRow: () => ({
      intent: '/repo/src/imperative.ts',
      key: '/repo/src/imperative.ts',
      meta: { treePath: 'src/imperative.ts' },
      name: 'file-tree:src/imperative.ts',
    }),
  })

  try {
    registry.sync([target], (intent) => intents.push(intent))
    expect(ForesightManager.instance.getManagerData.registeredElements.get(target)).toMatchObject({
      meta: { treePath: 'src/imperative.ts' },
      name: 'file-tree:src/imperative.ts',
    })

    await triggerForesightElement(target)
    await expect.poll(() => intents).toEqual(['/repo/src/imperative.ts'])
  } finally {
    registry.clear()
    target.remove()
  }
})

function mountHarness(queryClient: QueryClient): void {
  const host = document.createElement('main')
  host.dataset.workbench = ''
  host.style.height = '240px'
  host.style.position = 'relative'
  host.style.width = '640px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => {
    root?.render(
      <AppProviders command={false} queryClient={queryClient}>
        <EditorStateProvider>
          <PreparedOpenHarness />
        </EditorStateProvider>
      </AppProviders>,
    )
  })
}

function PreparedOpenHarness() {
  const commands = useEditorCommands()
  const documentStore = useEditorDocumentStoreApi()
  const queryClient = useQueryClient()
  const activeTab = useEditorWorkspaceState(activeEditorTab)
  const workspaceStore = useEditorWorkspaceStoreApi()

  useLayoutEffect(() => {
    runtime = { commands, documentStore, queryClient, workspaceStore }
    return () => {
      runtime = null
    }
  }, [commands, documentStore, queryClient, workspaceStore])

  return (
    <>
      <ThemeIdentity />
      <IntentTarget />
      {activeTab ? (
        <EditorSurfaceTabBody
          active
          path={activeTab.path}
          rootPath={ROOT_PATH}
          tabId={activeTab.id}
        />
      ) : null}
    </>
  )
}

function IntentTarget() {
  const commands = useEditorCommands()
  const elementRef = useEditorTabIntentPrefetch({
    active: false,
    id: 'prepared-open-browser-target',
    path: PATH,
  })

  return (
    <button
      data-prepared-open-target=''
      ref={elementRef}
      style={{ height: 40, left: 300, position: 'fixed', top: 120, width: 180 }}
      type='button'
      onClick={() => commands.openFileSurface(PATH)}
    >
      Open prepared fixture
    </button>
  )
}

function ThemeIdentity() {
  const { appliedThemeId, selectedThemeId } = useEditorColorTheme()
  return <span data-active-theme={`${selectedThemeId}|${appliedThemeId}`} hidden />
}

function activeEditorTab(state: EditorWorkspaceStore) {
  const activeTabId = state.workbenchPanels.activeEditorTabId
  if (!activeTabId) return null
  return state.workbenchPanels.editorTabs.find((tab) => tab.id === activeTabId) ?? null
}

function activeThemeIdentity(): string | null {
  return document.querySelector<HTMLElement>('[data-active-theme]')?.dataset.activeTheme ?? null
}

function preparationRequestTypes(): string[] {
  return performance
    .getEntriesByName('editor.worker.request', 'mark')
    .map((entry) => (entry as PerformanceMark).detail?.type)
    .filter((type): type is string => typeof type === 'string')
}

function postActivationTransferRequestTypes(): string[] {
  const transferRequests = new Set(['open', 'parse', 'queryRange', 'edit'])
  return preparationRequestTypes().filter((type) => transferRequests.has(type))
}

function workerRuntimeSessionIds(family: string): string[] {
  return [
    ...new Set(
      performance
        .getEntriesByName('editor.worker.request', 'mark')
        .filter((entry) => (entry as PerformanceMark).detail?.family === family)
        .map((entry) => (entry as PerformanceMark).detail?.runtimeSessionId)
        .filter((runtimeSessionId): runtimeSessionId is string => Boolean(runtimeSessionId)),
    ),
  ]
}

function attachmentDiagnostic(): EditorDiagnostic | undefined {
  return diagnostics.findLast((diagnostic) => diagnostic.name === 'editor.document.attach')
}

function postActivationStructuralDiagnostics(): string[] {
  const structuralNames = new Set(['editor.line_starts.scan', 'editor.syntax.session_created'])
  return diagnostics
    .filter((diagnostic) => structuralNames.has(diagnostic.name))
    .map((diagnostic) => diagnostic.name)
}

function registeredForesightTarget() {
  const target = document.querySelector('[data-prepared-open-target]')
  if (!target) return null

  return ForesightManager.instance.getManagerData.registeredElements.get(target) ?? null
}

async function triggerForesightIntent(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-prepared-open-target]')
  if (!target) throw new RangeError('prepared-open Foresight target unavailable')

  await triggerForesightElement(target)
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

function dispatchPointerMove(clientX: number, clientY: number): void {
  document.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX, clientY, pointerType: 'mouse' }),
  )
}

async function activateAndCaptureFirstFrame() {
  const target = document.querySelector<HTMLButtonElement>('[data-prepared-open-target]')
  if (!target) throw new RangeError('prepared-open activation target unavailable')

  const firstFrame = new Promise<FirstFrameCapture>((resolve) => {
    requestAnimationFrame(() => {
      const surface = document.querySelector<HTMLElement>('.editor-virtualized')
      const viewport = surface?.getBoundingClientRect()
      resolve({
        rowCount: document.querySelectorAll('.editor-virtualized-row').length,
        selectedPath: requiredRuntime().workspaceStore.getState().selectedFilePath,
        text: surface?.textContent ?? '',
        viewportHeight: viewport?.height ?? 0,
        viewportWidth: viewport?.width ?? 0,
      })
    })
  })
  target.click()
  return firstFrame
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function beginBenchmarkSampleWhenReady(): Promise<string> {
  let sampleId: string | null = null
  await expect
    .poll(
      () => {
        if (sampleId) return true
        try {
          sampleId = requiredBenchmarkTrace().beginEditorOpenSample({
            path: PATH,
            rootPath: ROOT_PATH,
          }).sampleId
        } catch (error) {
          if (!benchmarkControlMayStillBeStarting(error)) throw error
          return false
        }
        return true
      },
      { timeout: 10_000 },
    )
    .toBe(true)
  if (!sampleId) throw new RangeError('editor-open benchmark sample unavailable')
  return sampleId
}

async function resetBenchmarkSample(sampleId: string): Promise<EditorOpenSampleResetResult> {
  return requiredBenchmarkTrace().resetEditorOpenSample({
    path: PATH,
    rootPath: ROOT_PATH,
    sampleId,
  })
}

function assertDistinctTransferredRuntimeIds(result: EditorOpenSampleResetResult): void {
  expect(result.transferredHighlighterRuntimeSessionIds).toHaveLength(1)
  expect(result.transferredStructuralRuntimeSessionIds).toHaveLength(1)
  const highlighter = result.transferredHighlighterRuntimeSessionIds[0]
  const structural = result.transferredStructuralRuntimeSessionIds[0]
  expect(highlighter).toBeDefined()
  expect(structural).toBeDefined()
  expect(highlighter).not.toBe(structural)
  expect(result.highlighterRuntimeSessionIds).toContain(highlighter)
  expect(result.structuralRuntimeSessionIds).toContain(structural)
}

function installEditorWorkerRequestGate(
  heldRequestTypes: readonly string[],
): EditorWorkerRequestGate {
  const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage')
  const originalPostMessage = descriptor?.value as Worker['postMessage'] | undefined
  if (!descriptor || typeof originalPostMessage !== 'function') {
    throw new RangeError('Worker postMessage descriptor unavailable')
  }

  const heldTypes = new Set(heldRequestTypes)
  const heldRequests: HeldWorkerRequest[] = []
  let restored = false
  const replacement = function (this: Worker, ...args: Parameters<Worker['postMessage']>): void {
    const type = workerRequestType(args[0])
    if (!type || !heldTypes.has(type)) {
      Reflect.apply(originalPostMessage, this, args)
      return
    }
    heldRequests.push({ args, type, worker: this })
  }
  Object.defineProperty(Worker.prototype, 'postMessage', { ...descriptor, value: replacement })

  return {
    heldTypes: () => [...new Set(heldRequests.map((request) => request.type))].toSorted(),
    restore: () => {
      if (restored) return

      restored = true
      Object.defineProperty(Worker.prototype, 'postMessage', descriptor)
      for (const request of heldRequests) {
        Reflect.apply(originalPostMessage, request.worker, request.args)
      }
      heldRequests.length = 0
    },
  }
}

function workerRequestType(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('payload' in value)) return null
  const payload = value.payload
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return null
  return typeof payload.type === 'string' ? payload.type : null
}

function requiredRuntime(): PreparedOpenRuntime {
  if (!runtime) throw new RangeError('prepared-open runtime unavailable')
  return runtime
}

function rootFolder() {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: ROOT_PATH,
    path: ROOT_PATH,
    size: 0,
    type: 'directory' as const,
    version: 'browser-fixture',
  }
}

type PreparedOpenRuntime = {
  readonly commands: EditorCommands
  readonly documentStore: EditorDocumentStoreApi
  readonly queryClient: QueryClient
  readonly workspaceStore: EditorWorkspaceStoreApi
}

type FirstFrameCapture = {
  readonly rowCount: number
  readonly selectedPath: string | null
  readonly text: string
  readonly viewportHeight: number
  readonly viewportWidth: number
}

type EditorWorkerRequestGate = {
  readonly heldTypes: () => readonly string[]
  readonly restore: () => void
}

type HeldWorkerRequest = {
  readonly args: Parameters<Worker['postMessage']>
  readonly type: string
  readonly worker: Worker
}

type EditorDiagnostic = {
  readonly detail?: Readonly<Record<string, unknown>>
  readonly name: string
}

type EditorDiagnosticSink =
  | ((diagnostic: EditorDiagnostic) => void)
  | {
      readonly enabled?: boolean
      readonly record?: (diagnostic: EditorDiagnostic) => void
    }

type EditorPerformanceTrace = {
  beginEditorOpenSample?(request: { readonly path: string; readonly rootPath: string }): {
    readonly sampleId: string
  }
  mark(name: string, detail?: Readonly<Record<string, unknown>>): void
  resetEditorOpenSample?(request: {
    readonly path: string
    readonly rootPath: string
    readonly sampleId: string
  }): Promise<EditorOpenSampleResetResult>
  stop?(): void
}

type EditorBenchmarkTrace = EditorPerformanceTrace & {
  beginEditorOpenSample(request: { readonly path: string; readonly rootPath: string }): {
    readonly sampleId: string
  }
  resetEditorOpenSample(request: {
    readonly path: string
    readonly rootPath: string
    readonly sampleId: string
  }): Promise<EditorOpenSampleResetResult>
}

const editorDiagnosticGlobal = globalThis as typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: EditorDiagnosticSink | null
  __editorPerfTrace?: EditorPerformanceTrace
}

function installBenchmarkTrace(): void {
  history.replaceState(null, '', '/?editorPerfTrace=1')
  installEditorPerformanceTraceFromUrl()
  const traceSink = editorDiagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__
  editorDiagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
    diagnostics.push(diagnostic)
    recordDiagnostic(traceSink, diagnostic)
  }
}

function recordDiagnostic(
  sink: EditorDiagnosticSink | null | undefined,
  diagnostic: EditorDiagnostic,
) {
  if (typeof sink === 'function') {
    sink(diagnostic)
    return
  }
  sink?.record?.(diagnostic)
}

function requiredBenchmarkTrace(): EditorBenchmarkTrace {
  const trace = editorDiagnosticGlobal.__editorPerfTrace
  if (trace?.beginEditorOpenSample && trace.resetEditorOpenSample) {
    return {
      ...trace,
      beginEditorOpenSample: trace.beginEditorOpenSample,
      resetEditorOpenSample: trace.resetEditorOpenSample,
    }
  }

  throw new RangeError('editor-open benchmark trace unavailable')
}

function benchmarkControlMayStillBeStarting(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('benchmark control is unavailable') ||
    error.message.includes('requires a connected owner')
  )
}
