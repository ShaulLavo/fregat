import type { EditorOpenSampleResetResult } from '@/features/editor/state/performance-trace'
import { activeEditorTab as selectedGroupTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { filesystemPath, fileDocumentKey, tabId } from '@/lib/documents/utils/identity'
import { testTabContent } from '../../../../test/factories/document-targets'
import type { TabContent } from '@/lib/documents/utils/types'
import '@workspace/ui/globals.css'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ForesightManager } from 'js.foresight'
import { createBrowserWorkspace } from '../../../../test/factories/browser-workspace'
import { holdWallClock } from '../../../../test/factories/wall-clock'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useEditorUiStoreApi, type EditorUiStoreApi } from '@/features/editor/state/ui-state'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { type EditorCommands } from '@/features/editor/state/commands'
import {
  useEditorDocumentStoreApi,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import {
  resetEditorColorThemeStore,
  syncEditorThemeSelection,
} from '@/features/editor/state/color-theme-store'
import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-recording'
import {
  awaitEditorSyntaxRuntimeSessionIdle,
  awaitEditorSyntaxWorkerIdleFences,
  disposeEditorSyntaxHighlighting,
  editorHighlighterProvider,
} from '@/features/editor/state/syntax-highlighting'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
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
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { removeEditorVisibleSnapshotCacheForPath } from '@/lib/editor-visible-snapshot-cache'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import {
  captureTokenPaint,
  sourceTokenPaintWindow,
  tokenPaintMismatch,
  resolveTokenPaintRuns,
  type TokenPaintReference,
  type TokenPaintObservation,
} from '../../../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'
import { AppProviders, seedHtmlTheme } from '../../../../test/render'
import {
  installDelayedFileReadClient,
  type DelayedFileReadClient,
} from '../../../../test/factories/delayed-file-read-client'

const PATH = filesystemPath('repo/src/editor-tab-a.ts')
const ROOT_PATH = filesystemPath('repo')
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
  vi.unstubAllEnvs()
  await disposeEditorSyntaxHighlighting()
  resetEditorColorThemeStore()
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark', 'light')
  localStorage.clear()
  performance.clearMarks()
  performance.clearMeasures()
})

test(
  'calibrates complete tokens in two known-good real app views',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    installBenchmarkTrace()
    const queryClient = await mountHarness()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    await ensureFileSnapshotQuery(queryClient, PATH)
    await activateAndCaptureFirstFrame()
    await awaitEditorSyntaxWorkerIdleFences()
    await expect.poll(() => currentTokenPaint().runs.length, { timeout: 10_000 }).toBeGreaterThan(2)
    const harness = requiredRuntime()
    const groups = harness.workspaceStore.getState().workbenchPanels.editorGroups
    const tab = selectedGroupTab(groups)
    if (!tab) throw new RangeError('known-good split tab unavailable')
    const sessions = workerRuntimeSessionIds('shiki')
    const reference = currentTokenReference()
    expect(
      await harness.commands.placeTab({
        tabId: tab.id,
        mode: 'copy',
        target: { kind: 'edge', groupId: groups.activeGroupId, edge: 'right' },
      }),
    ).toMatchObject({ status: 'applied' })
    await nextAnimationFrame()
    const split = allEditorGroups(harness.workspaceStore.getState().workbenchPanels.editorGroups)
    expect(split).toHaveLength(2)
    for (const group of split) {
      const frame = currentTokenPaint(
        `[data-prepared-open-group="${group.id}"] .editor-virtualized-viewport`,
      )
      expect(tokenPaintMismatch(frame, reference)).toBeNull()
    }
    expect(workerRuntimeSessionIds('shiki')).toEqual(sessions)
  },
)

test.for([
  { delay: 0, prepared: true, opening: 'promotes a ready real Foresight prediction' },
  { delay: 200, prepared: true, opening: 'promotes a ready real Foresight prediction' },
  { delay: 2_000, prepared: true, opening: 'promotes a ready real Foresight prediction' },
  // The preparation's 30-second lifetime expires; the canonical document stays warm.
  { delay: 35_000, prepared: false, opening: 'warmly reopens after Foresight preparation expires' },
])(
  '$opening after $delay ms without duplicate worker work',
  { timeout: 30_000 },
  async ({ delay, prepared }) => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    installBenchmarkTrace()
    await mountHarness()
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()

    expect(await harness.commands.openSearchEditor(ROOT_PATH)).toEqual({ status: 'applied' })
    const sampleId = await beginBenchmarkSampleWhenReady()
    await expect.poll(registeredForesightTarget).toMatchObject({
      meta: { path: PATH, rootPath: ROOT_PATH, tabId: 'prepared-open-browser-target' },
      name: expect.stringContaining('editor-tab:'),
    })
    performance.clearMarks('editor.worker.request')
    holdWallClock()
    await triggerForesightIntent()
    await expect
      .poll(preparationRequestTypes, { timeout: 20_000 })
      .toEqual(expect.arrayContaining(['open', 'parse', 'queryRange']))
    await awaitEditorSyntaxWorkerIdleFences()
    await Promise.resolve()
    const preparedAnalyses = [...harness.documentStore.getState().enumerateEditorAnalyses()]
    expect(preparedAnalyses).toHaveLength(1)
    const preparedAnalysis = preparedAnalyses[0]!
    const preparedSessions = preparedAnalysis
      .inspectRetention()
      .entries.map((entry) => entry.runtimeSessionId)
    expect(preparedSessions).toHaveLength(2)
    vi.setSystemTime(Date.now() + delay)

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
    await awaitEditorSyntaxWorkerIdleFences()
    expect(firstFrame.tokens).not.toBeNull()
    expect(
      tokenPaintMismatch(requiredTokenPaint(firstFrame.tokens), currentTokenReference()),
    ).toBeNull()

    expect(
      harness.documentStore.getState().getLiveEditorDocument(fileDocumentKey(PATH))?.analysis,
    ).toBe(preparedAnalysis)
    expect(
      preparedAnalysis.inspectRetention().entries.map((entry) => entry.runtimeSessionId),
    ).toEqual(preparedSessions)

    expect(postActivationTransferRequestTypes()).toEqual([])
    expect(performance.getEntriesByName('editor.file_open.buffer_built')).toEqual([])
    expect(performance.getEntriesByName('editor.file_open.file_read')).toHaveLength(
      delay < FILE_SNAPSHOT_STALE_MS ? 0 : 1,
    )
    expect(performance.getEntriesByName('editor.authoritative_text_paint')).toHaveLength(1)
    const sample = await resetBenchmarkSample(sampleId)
    if (prepared) {
      expect(attachmentDiagnostic()?.detail).toMatchObject({
        highlighter: 'ready',
        prepared: true,
        structural: 'ready',
      })
      expect(postActivationStructuralDiagnostics()).toEqual([])
      assertDistinctJoinedRuntimeIds(sample)
      return
    }
    expect(attachmentDiagnostic()?.detail).toMatchObject({ prepared: false })
    expect(postActivationStructuralDiagnostics()).toEqual([
      'editor.syntax.session_created',
      'editor.syntax.session_created',
    ])
    expect(sample.joinedHighlighterRuntimeSessionIds).toEqual([])
    expect(sample.joinedStructuralRuntimeSessionIds).toEqual([])
  },
)

test('calibrates complete source token paint against a delayed partial install', async () => {
  seedHtmlTheme('dark')
  resetEditorColorThemeStore()
  syncEditorThemeSelection('dark', 'dark-plus')
  editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
  const queryClient = await mountHarness()
  await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
  await ensureFileSnapshotQuery(queryClient, PATH)
  await activateAndCaptureFirstFrame()
  await awaitEditorSyntaxWorkerIdleFences()
  await expect.poll(() => currentTokenPaint().runs.length, { timeout: 10_000 }).toBeGreaterThan(2)
  const reference = currentTokenReference()
  expect(tokenPaintMismatch(currentTokenPaint(), reference)).toBeNull()
  const restore = delayTokenInstall()
  try {
    await nextAnimationFrame()
    const partial = currentTokenPaint()
    expect(partial.runs).toHaveLength(1)
    expect(tokenPaintMismatch(partial, reference)).toBe('token offsets or styles')
    await nextAnimationFrame()
    expect(tokenPaintMismatch(currentTokenPaint(), reference)).toBe('token offsets or styles')
  } finally {
    restore()
  }
  await nextAnimationFrame()
  expect(tokenPaintMismatch(currentTokenPaint(), reference)).toBeNull()
  assertPaintedDecorations(reference)
})

test(
  'keeps complete current tokens on immediate repeated retained revisits',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    installBenchmarkTrace()
    const queryClient = await mountHarness()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    await ensureFileSnapshotQuery(queryClient, PATH)
    await activateAndCaptureFirstFrame()
    await awaitEditorSyntaxWorkerIdleFences()
    await expect.poll(() => currentTokenPaint().runs.length, { timeout: 10_000 }).toBeGreaterThan(2)
    const reference = currentTokenReference()
    const sessions = workerRuntimeSessionIds('shiki')
    const structuralSessions = workerRuntimeSessionIds('tree-sitter')
    for (let revisit = 0; revisit < 6; revisit++) {
      await requiredRuntime().commands.openSearchEditor(ROOT_PATH)
      removeEditorVisibleSnapshotCacheForPath(environmentScopedStorage(activeEnvironmentId()), {
        path: PATH,
        rootPath: ROOT_PATH,
      })
      const frame = await activateAndCaptureFirstFrame()
      expect(tokenPaintMismatch(requiredTokenPaint(frame.tokens), reference)).toBeNull()
      expect(frame.tokens?.rows.every((row) => row.presentation === 'live')).toBe(true)
    }
    expect(workerRuntimeSessionIds('shiki')).toEqual(sessions)
    expect(workerRuntimeSessionIds('tree-sitter')).toEqual(structuralSessions)
  },
)

test(
  'shares complete current tokens between two app views and preserves the remaining view',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    installBenchmarkTrace()
    const queryClient = await mountHarness()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    await ensureFileSnapshotQuery(queryClient, PATH)
    await activateAndCaptureFirstFrame()
    await awaitEditorSyntaxWorkerIdleFences()
    await expect.poll(() => currentTokenPaint().runs.length, { timeout: 10_000 }).toBeGreaterThan(2)
    const harness = requiredRuntime()
    const retained = harness.documentStore.getState().getLiveEditorDocument(fileDocumentKey(PATH))
    if (!retained) throw new RangeError('split token paint document unavailable')
    createEditorBufferSession(retained.buffer).applyText(
      Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index}\n`).join(''),
    )
    await nextAnimationFrame()
    await awaitEditorSyntaxWorkerIdleFences()
    await nextAnimationFrame()
    await expect.poll(() => currentHighlighterRead().kind, { timeout: 10_000 }).toBe('ready')
    console.info('split-analysis-ready', JSON.stringify(currentHighlighterRead()))
    const reference = currentTokenReference()
    const groups = harness.workspaceStore.getState().workbenchPanels.editorGroups
    const originalTab = selectedGroupTab(groups)
    if (!originalTab) throw new RangeError('split token paint tab unavailable')
    const sessions = workerRuntimeSessionIds('shiki')
    const result = await harness.commands.placeTab({
      tabId: originalTab.id,
      mode: 'copy',
      target: { kind: 'edge', groupId: groups.activeGroupId, edge: 'right' },
    })
    expect(result.status).toBe('applied')
    await nextAnimationFrame()
    const views = Object.values(harness.documentStore.getState().viewsByTabId)
    expect(views).toHaveLength(2)
    expect(views[0]?.view).not.toBe(views[1]?.view)
    expect(views[0]?.documentKey).toBe(views[1]?.documentKey)
    const splitGroups = allEditorGroups(
      harness.workspaceStore.getState().workbenchPanels.editorGroups,
    )
    const first = splitGroups[0]
    const second = splitGroups[1]
    if (!first || !second) throw new RangeError('split token paint groups unavailable')
    const firstSelector = `[data-prepared-open-group="${first.id}"] .editor-virtualized-viewport`
    const secondSelector = `[data-prepared-open-group="${second.id}"] .editor-virtualized-viewport`
    const firstFrame = currentTokenPaint(firstSelector)
    const secondFrame = currentTokenPaint(secondSelector)
    console.info(
      'split-token-diff',
      JSON.stringify({
        firstRuns: firstFrame.runs.length,
        secondRuns: secondFrame.runs.length,
        firstOnly: firstFrame.runs
          .filter(
            (run) =>
              !secondFrame.runs.some((other) => JSON.stringify(run) === JSON.stringify(other)),
          )
          .slice(0, 5),
        secondOnly: secondFrame.runs
          .filter(
            (run) =>
              !firstFrame.runs.some((other) => JSON.stringify(run) === JSON.stringify(other)),
          )
          .slice(0, 5),
      }),
    )
    const firstMismatch = tokenPaintMismatch(firstFrame, reference)
    const secondMismatch = tokenPaintMismatch(secondFrame, reference)
    console.info(
      'split-independent-oracles',
      JSON.stringify({
        firstMismatch,
        secondMismatch,
        sourceLength: reference.source.length,
        referenceRanges: reference.runs.length,
      }),
    )
    expect(firstMismatch).toBeNull()
    expect(secondMismatch).toBeNull()
    expect(workerRuntimeSessionIds('shiki')).toEqual(sessions)
    const secondViewport = document
      .querySelector(secondSelector)
      ?.closest<HTMLElement>('.editor-virtualized')
    if (!secondViewport) throw new RangeError('split token paint viewport unavailable')
    secondViewport.scrollTop = 600
    secondViewport.dispatchEvent(new Event('scroll'))
    await nextAnimationFrame()
    await awaitEditorSyntaxWorkerIdleFences()
    const lowerFrame = currentTokenPaint(secondSelector)
    expect(lowerFrame.rows[0]?.start).toBeGreaterThan(firstFrame.rows.at(-1)?.end ?? 0)
    expect(tokenPaintMismatch(lowerFrame, reference)).toBeNull()
    expect(tokenPaintMismatch(currentTokenPaint(firstSelector), reference)).toBeNull()
    const copiedTab = second.tabs.find((tab) => tab.id !== originalTab.id)
    if (!copiedTab) throw new RangeError('split token paint copied tab unavailable')
    const firstController = harness.uiStore.getState().controllersByTabId.get(originalTab.id)
    const secondController = harness.uiStore.getState().controllersByTabId.get(copiedTab.id)
    if (!firstController || !secondController)
      throw new RangeError('split editing controllers unavailable')
    firstController.commands.setSelection(3)
    secondController.commands.setSelection(lowerFrame.rows[0]!.start + 3)
    for (const [editing, other, selector, replacement] of [
      [firstController, secondController, firstSelector, '"mapped"'],
      [secondController, firstController, secondSelector, '""'],
    ] as const) {
      const row = currentTokenPaint(selector).rows[0]!
      expect(row.text.indexOf('= ')).toBeGreaterThan(0)
      const offset = row.start + row.text.indexOf('= ') + 2
      const revision = retained.buffer.getRevision()
      const replacementText = replacement
      const delta = replacementText.length - (row.end - offset)
      const otherSelection = other.getEditor()?.getSelections()
      const scroll = [firstController, secondController].map((controller) =>
        controller.getEditor()?.getScrollPosition(),
      )
      editing.commands.edit({
        from: offset,
        to: row.end,
        text: replacementText,
      })
      expect(retained.buffer.getRevision()).toBe(revision + 1)
      expect(retained.buffer.materializeFullText().slice(offset, row.end + delta)).toBe(
        replacementText,
      )
      await nextAnimationFrame()
      await awaitEditorSyntaxWorkerIdleFences()
      await expect.poll(() => currentHighlighterRead().kind).toBe('ready')
      const current = currentTokenReference()
      await expect
        .poll(() => tokenPaintMismatch(currentTokenPaint(firstSelector), current))
        .toBeNull()
      await expect
        .poll(() => tokenPaintMismatch(currentTokenPaint(secondSelector), current))
        .toBeNull()
      expect(otherSelection).toBeDefined()
      const shift = (position: number) => (position >= row.end ? position + delta : position)
      expect(other.getEditor()?.getSelections()).toEqual(
        otherSelection?.map((selection) => ({
          ...selection,
          anchorOffset: shift(selection.anchorOffset),
          headOffset: shift(selection.headOffset),
          startOffset: shift(selection.startOffset),
          endOffset: shift(selection.endOffset),
        })),
      )
      expect(
        [firstController, secondController].map((controller) =>
          controller.getEditor()?.getScrollPosition(),
        ),
      ).toEqual(scroll)
      expect(firstController.getEditor()?.getSelections()).not.toEqual(
        secondController.getEditor()?.getSelections(),
      )
      expect(workerRuntimeSessionIds('shiki')).toEqual(sessions)
    }
    await harness.commands.closeTab(copiedTab.id)
    await nextAnimationFrame()
    expect(tokenPaintMismatch(currentTokenPaint(), currentTokenReference())).toBeNull()
  },
)

test(
  'installs a query-ready file before the first browser frame',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    editorDiagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
      diagnostics.push(diagnostic)
    }
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const queryClient = await mountHarness()
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')

    holdWallClock()
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
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    installBenchmarkTrace()
    const queryClient = await mountHarness()
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    delayedFileRead = installDelayedFileReadClient(queryClient)

    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.selectedContent).toEqual(testTabContent(PATH))
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
    // Structural parsing is its own request and can land after the highlight has painted.
    await expect
      .poll(() => workerRuntimeSessionIds('tree-sitter').length, { timeout: 10_000 })
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
  'returns to dirty text and current Undo and Redo tokens with saved paint removed',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const queryClient = await mountHarness()
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()
    await ensureFileSnapshotQuery(queryClient, PATH)
    await activateAndCaptureFirstFrame()
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)

    const retained = harness.documentStore.getState().getLiveEditorDocument(fileDocumentKey(PATH))
    if (!retained) throw new RangeError('retained browser document unavailable')
    const originalText = retained.buffer.materializeFullText()
    await awaitEditorSyntaxWorkerIdleFences()
    const originalReference = currentTokenReference()
    const activeTabId = selectedGroupTab(
      harness.workspaceStore.getState().workbenchPanels.editorGroups,
    )?.id
    if (!activeTabId) throw new RangeError('active browser tab unavailable')
    const controller = harness.uiStore.getState().controllersByTabId.get(activeTabId)
    if (!controller) throw new RangeError('dirty browser controller unavailable')
    const edit = "export const retainedDirty = 'retained dirty browser text'\n"
    controller.commands.edit({ from: 0, to: originalText.length, text: edit })
    await expect.poll(() => currentHighlighterRead().kind).toBe('ready')
    await awaitEditorSyntaxWorkerIdleFences()
    const reference = currentTokenReference()
    expect(await harness.commands.openSearchEditor(ROOT_PATH)).toEqual({ status: 'applied' })
    removeEditorVisibleSnapshotCacheForPath(environmentScopedStorage(activeEnvironmentId()), {
      path: PATH,
      rootPath: ROOT_PATH,
    })
    const queryKey = fileSnapshotQueryOptions(PATH).queryKey
    await queryClient.cancelQueries({ exact: true, queryKey })
    queryClient.removeQueries({ exact: true, queryKey })
    delayedFileRead = installDelayedFileReadClient(queryClient)
    performance.clearMarks('editor.authoritative_text_paint')
    performance.clearMarks('editor.authoritative_highlight_paint')

    const firstFrame = await activateAndCaptureFirstFrame()

    expect(firstFrame.selectedContent).toEqual(testTabContent(PATH))
    expect(firstFrame.text).toContain('retained dirty browser text')
    expect(firstFrame.rowCount).toBeGreaterThan(0)
    expect(tokenPaintMismatch(requiredTokenPaint(firstFrame.tokens), reference)).toBeNull()
    expect(
      harness.documentStore.getState().getLiveEditorDocument(fileDocumentKey(PATH))?.buffer,
    ).toBe(retained.buffer)
    await expect.poll(delayedFileRead.observedStatus).toBe(200)
    // The retained buffer highlights on the worker's clock while the file read is still held.
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)

    delayedFileRead.release()
    await nextAnimationFrame()
    expect(document.querySelector('.editor-virtualized')?.textContent).toContain(
      'retained dirty browser text',
    )
    const returning = harness.uiStore.getState().controllersByTabId.get(activeTabId)
    if (!returning) throw new RangeError('returning dirty controller unavailable')
    for (const [command, expected] of [
      ['undo', originalText],
      ['redo', edit],
    ] as const) {
      expect(returning.commands.dispatchCommand(command)).toBe(true)
      expect(retained.buffer.materializeFullText()).toBe(expected)
      removeEditorVisibleSnapshotCacheForPath(environmentScopedStorage(activeEnvironmentId()), {
        path: PATH,
        rootPath: ROOT_PATH,
      })
      await nextAnimationFrame()
      await awaitEditorSyntaxWorkerIdleFences()
      await expect.poll(() => currentHighlighterRead().kind).toBe('ready')
      const expectedTokens = command === 'undo' ? originalReference : reference
      expect(currentTokenReference().runs).toEqual(expectedTokens.runs)
      await expect
        .poll(() =>
          tokenPaintMismatch(currentTokenPaint(), {
            ...expectedTokens,
            identity: currentTokenReference().identity,
          }),
        )
        .toBeNull()
      expect(currentTokenPaint().rows.every((row) => row.presentation === 'live')).toBe(true)
    }
  },
)

test(
  'adopts pending Tree-sitter beside ready Shiki without duplicate worker requests',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    installBenchmarkTrace()
    await mountHarness()
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()
    expect(await harness.commands.openSearchEditor(ROOT_PATH)).toEqual({ status: 'applied' })
    const sampleId = await beginBenchmarkSampleWhenReady()
    workerRequestGate = installEditorWorkerRequestGate(['queryRange'])
    holdWallClock()

    await triggerForesightIntent()
    await expect.poll(workerRequestGate.heldTypes, { timeout: 20_000 }).toEqual(['queryRange'])
    // Both stages start together; Shiki finishes while Tree-sitter's query is held.
    await expect.poll(() => workerRuntimeSessionIds('shiki').length, { timeout: 10_000 }).toBe(1)
    await Promise.all(workerRuntimeSessionIds('shiki').map(awaitEditorSyntaxRuntimeSessionIdle))
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
    assertDistinctJoinedRuntimeIds(await resetBenchmarkSample(sampleId))
  },
)

test(
  'joins hover work on click and on a repeated activation without a second session or request',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    installBenchmarkTrace()
    await mountHarness()
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
    const harness = requiredRuntime()
    expect(await harness.commands.openSearchEditor(ROOT_PATH)).toEqual({ status: 'applied' })
    const sampleId = await beginBenchmarkSampleWhenReady()
    performance.clearMarks('editor.worker.request')
    workerRequestGate = installEditorWorkerRequestGate(['queryRange'])
    holdWallClock()

    await triggerForesightIntent()
    await expect.poll(workerRequestGate.heldTypes, { timeout: 20_000 }).toEqual(['queryRange'])
    diagnostics = []
    await activateAndCaptureFirstFrame()
    await activateAndCaptureFirstFrame()

    expect(attachmentDiagnostic()?.detail).toMatchObject({ prepared: true })
    workerRequestGate.restore()
    workerRequestGate = null
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)
    await awaitEditorSyntaxWorkerIdleFences()
    expect(workerRuntimeSessionIds('shiki')).toHaveLength(1)
    expect(workerRuntimeSessionIds('tree-sitter')).toHaveLength(1)
    expect(workerRequestCount('shiki', 'open')).toBe(1)
    expect(workerRequestCount('tree-sitter', 'parse')).toBe(1)
    const result = await resetBenchmarkSample(sampleId)
    expect(result.preparedJoins).toBe(1)
    assertDistinctJoinedRuntimeIds(result)
  },
)

test(
  'rejects an invalidated exact lease and lets normal highlighting win',
  { timeout: 30_000 },
  async () => {
    seedHtmlTheme('dark')
    resetEditorColorThemeStore()
    syncEditorThemeSelection('dark', 'dark-plus')
    editorDiagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
      diagnostics.push(diagnostic)
    }
    editorDiagnosticGlobal.__editorPerfTrace = { mark: () => undefined }
    const queryClient = await mountHarness()
    await expect.poll(() => runtime).not.toBeNull()
    await expect.poll(activeThemeIdentity, { timeout: 10_000 }).toBe('dark-plus|dark-plus')
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

    expect(firstFrame.selectedContent).toEqual(testTabContent(PATH))
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
  const registry = createIntentPrefetchRegistry<string>({
    reactivateAfter: FILE_SNAPSHOT_STALE_MS,
  })
  const row = {
    intent: '/repo/src/imperative.ts',
    key: '/repo/src/imperative.ts',
    meta: { treePath: 'src/imperative.ts' },
    name: 'file-tree:src/imperative.ts',
  }

  try {
    registry.sync([{ element: target, row }], (intent) => {
      intents.push(intent)
    })
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

async function mountHarness() {
  const fixture = await createBrowserWorkspace(ROOT_PATH)
  const { queryClient } = fixture
  const host = document.createElement('main')
  host.dataset.workbench = ''
  host.style.height = '240px'
  host.style.position = 'relative'
  host.style.width = '640px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => {
    root?.render(
      <AppProviders
        application={fixture.application}
        navigation={fixture.navigation}
        queryClient={queryClient}
      >
        <EditorStateProvider>
          <PreparedOpenHarness />
        </EditorStateProvider>
      </AppProviders>,
    )
  })
  return queryClient
}

function PreparedOpenHarness() {
  const commands = useEditorCommands()
  const documentStore = useEditorDocumentStoreApi()
  const queryClient = useQueryClient()
  const groups = useEditorWorkspaceState((state) => state.workbenchPanels.editorGroups)
  const workspaceStore = useEditorWorkspaceStoreApi()
  const uiStore = useEditorUiStoreApi()

  useLayoutEffect(() => {
    runtime = { commands, documentStore, queryClient, workspaceStore, uiStore }
    return () => {
      runtime = null
    }
  }, [commands, documentStore, queryClient, workspaceStore, uiStore])

  return (
    <>
      <ThemeIdentity />
      <IntentTarget />
      {allEditorGroups(groups).map((group, index, all) => {
        const tab = group.tabs.find((tab) => tab.id === group.selectedTabId)
        if (!tab) return null
        return (
          <section
            key={group.id}
            data-prepared-open-group={group.id}
            style={{
              height: 240,
              left: (index * 640) / all.length,
              position: 'absolute',
              width: 640 / all.length,
            }}
          >
            <EditorSurfaceTabBody
              active
              content={tab.content}
              rootPath={ROOT_PATH}
              tabId={tab.id}
            />
          </section>
        )
      })}
    </>
  )
}

function IntentTarget() {
  const commands = useEditorCommands()
  const elementRef = useEditorTabIntentPrefetch({
    active: false,
    id: tabId('prepared-open-browser-target'),
    content: testTabContent(PATH),
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
  const { appliedThemeId, appliedThemeContentHash, selectedThemeId } = useEditorColorTheme()
  return (
    <span
      data-active-theme={`${selectedThemeId}|${appliedThemeId}`}
      data-applied-theme={appliedThemeId}
      data-selected-theme={selectedThemeId}
      data-applied-theme-hash={appliedThemeContentHash}
      hidden
    />
  )
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

function workerRequestCount(family: string, type: string): number {
  return performance.getEntriesByName('editor.worker.request', 'mark').filter((entry) => {
    const detail = (entry as PerformanceMark).detail
    return detail?.family === family && detail?.type === type
  }).length
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
        selectedContent: requiredRuntime().workspaceStore.getState().selectedTabContent,
        text: Array.from(
          surface?.querySelectorAll('.editor-virtualized-row') ?? [],
          (row) => row.textContent ?? '',
        ).join('\n'),
        tokens: surface ? tryCurrentTokenPaint() : null,
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

function assertDistinctJoinedRuntimeIds(result: EditorOpenSampleResetResult): void {
  expect(result.joinedHighlighterRuntimeSessionIds).toHaveLength(1)
  expect(result.joinedStructuralRuntimeSessionIds).toHaveLength(1)
  const highlighter = result.joinedHighlighterRuntimeSessionIds[0]
  const structural = result.joinedStructuralRuntimeSessionIds[0]
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
    heldTypes: () => [...new Set(heldRequests.map((request) => request.type))].sort(),
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

type PreparedOpenRuntime = {
  readonly commands: EditorCommands
  readonly documentStore: EditorDocumentStoreApi
  readonly queryClient: QueryClient
  readonly workspaceStore: EditorWorkspaceStoreApi
  readonly uiStore: EditorUiStoreApi
}

type FirstFrameCapture = {
  readonly rowCount: number
  readonly selectedContent: TabContent | null
  readonly text: string
  readonly tokens: TokenPaintObservation | null
  readonly viewportHeight: number
  readonly viewportWidth: number
}

function currentTokenPaint(
  viewportSelector = '.editor-virtualized-viewport',
): TokenPaintObservation {
  return requiredTokenPaint(tryCurrentTokenPaint(viewportSelector))
}

function tryCurrentTokenPaint(
  viewportSelector = '.editor-virtualized-viewport',
): TokenPaintObservation | null {
  const harness = requiredRuntime()
  const viewport = document.querySelector<HTMLElement>(viewportSelector)
  const groupId = viewport?.closest<HTMLElement>('[data-prepared-open-group]')?.dataset
    .preparedOpenGroup
  const group = allEditorGroups(
    harness.workspaceStore.getState().workbenchPanels.editorGroups,
  ).find((group) => group.id === groupId)
  const tab = group?.tabs.find((tab) => tab.id === group.selectedTabId)
  const view = tab ? harness.documentStore.getState().viewsByTabId[tab.id] : null
  const retained = view
    ? harness.documentStore.getState().getLiveEditorDocument(view.documentKey)
    : null
  const inspection = tab
    ? harness.uiStore.getState().controllersByTabId.get(tab.id)?.getSnapshot()
    : null
  if (!retained || !inspection) return null
  if (
    inspection.foldMarkers.length > 0 ||
    inspection.visibleRows.some((row) => !row.firstWrapSegment)
  )
    throw new RangeError('folded and wrapped token paint require calibrated mapping')
  const source = retained.buffer.materializeFullText()
  const frame = captureTokenPaint({
    source,
    viewportSelector,
    rowSelector: '.editor-virtualized-row',
    excludedLayers:
      '.editor-virtualized-selection-layer,.editor-virtualized-hidden-character-layer,.editor-virtualized-fold-placeholder,.editor-virtualized-gutter-row',
    highlightPrefix: 'editor-shared-token-',
  })
  return {
    ...frame,
    window: sourceTokenPaintWindow({ source, geometryWindow: frame.window }),
    identity: {
      document: retained.analysis.documentId,
      revision: retained.buffer.getRevision(),
      configuration: JSON.stringify(currentHighlighterConfiguration()),
      paintedGeneration: 'unknown',
    },
  }
}

function currentTokenReference(): TokenPaintReference {
  const retained = requiredRuntime()
    .documentStore.getState()
    .getLiveEditorDocument(fileDocumentKey(PATH))
  if (!retained) throw new RangeError('reference source unavailable')
  const configuration = currentHighlighterConfiguration()
  const lease = retained.analysis.borrowHighlighter({
    provider: editorHighlighterProvider(),
    languageId: 'typescript',
    configurationTag: configuration,
  })
  if (!lease) throw new RangeError('reference real worker unavailable')
  try {
    const read = lease.read()
    expect(read.kind).toBe('ready')
    if (read.kind !== 'ready') throw new RangeError('reference real worker unsettled')
    expect(read.revision).toBe(retained.buffer.getRevision())
    const source = read.snapshot.materializeFullText()
    expect(source).toBe(retained.buffer.materializeFullText())
    return {
      source,
      identity: {
        document: retained.analysis.documentId,
        revision: read.revision,
        configuration: JSON.stringify(configuration),
        paintedGeneration: 'unknown',
      },
      expected: 'colored',
      runs: resolveTokenPaintRuns({
        source,
        tokens: read.result.tokens.toTokens(),
        viewportSelector: '.editor-virtualized-viewport',
      }),
    }
  } finally {
    lease.dispose()
  }
}

function currentHighlighterConfiguration() {
  const theme = document.querySelector<HTMLElement>('[data-active-theme]')
  if (!theme?.dataset.selectedTheme) throw new RangeError('token paint configuration unavailable')
  return editorPreparedDocumentTags(
    PATH,
    {
      appliedThemeContentHash: theme.dataset.appliedThemeHash ?? null,
      appliedThemeId: theme.dataset.appliedTheme ?? null,
      selectedThemeId: theme.dataset.selectedTheme,
      syntaxHighlightingEnabled: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
    },
    true,
  ).highlighterConfigurationTag
}

function currentHighlighterRead() {
  const retained = requiredRuntime()
    .documentStore.getState()
    .getLiveEditorDocument(fileDocumentKey(PATH))
  if (!retained) throw new RangeError('token paint analysis unavailable')
  const lease = retained.analysis.borrowHighlighter({
    provider: editorHighlighterProvider(),
    languageId: 'typescript',
    configurationTag: currentHighlighterConfiguration(),
  })
  if (!lease) throw new RangeError('token paint highlighter unavailable')
  try {
    expect(workerRuntimeSessionIds('shiki')).toContain(lease.runtimeSessionId)
    const state = lease.read()
    return {
      kind: state.kind,
      revision: state.revision,
      runtimeSessionId: lease.runtimeSessionId,
      configuration: currentHighlighterConfiguration(),
      tokenCount: state.kind === 'ready' ? state.result.tokens.length : null,
    }
  } finally {
    lease.dispose()
  }
}

function requiredTokenPaint(frame: TokenPaintObservation | null): TokenPaintObservation {
  if (!frame) throw new RangeError('first-frame token paint unavailable')
  return frame
}

function assertPaintedDecorations(reference: TokenPaintReference): void {
  const rules = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes('::highlight(editor-shared-token-'),
    )
  expect(rules.length).toBeGreaterThan(0)
  const originals = rules.map((rule) => rule.style.cssText)
  try {
    for (const decoration of [
      { color: 'rgb(1, 2, 3)', style: 'solid', thickness: '1px' },
      { color: 'rgb(4, 5, 6)', style: 'wavy', thickness: '1px' },
      { color: 'rgb(4, 5, 6)', style: 'wavy', thickness: '3px' },
    ]) {
      assertPaintedDecoration(rules, decoration, reference)
    }
  } finally {
    rules.forEach((rule, index) => {
      rule.style.cssText = originals[index] ?? ''
    })
  }
  expect(tokenPaintMismatch(currentTokenPaint(), reference)).toBeNull()
}

function assertPaintedDecoration(
  rules: readonly CSSStyleRule[],
  decoration: { readonly color: string; readonly style: string; readonly thickness: string },
  reference: TokenPaintReference,
): void {
  for (const rule of rules)
    rule.style.textDecoration = `underline ${decoration.style} ${decoration.color} ${decoration.thickness}`
  const frame = currentTokenPaint()
  expect(frame.runs.length).toBeGreaterThan(2)
  for (const run of frame.runs) {
    expect(run.style.textDecoration).toBe('underline')
    expect(run.style.textDecorationColor).toBe(decoration.color)
    expect(run.style.textDecorationStyle).toBe(decoration.style)
    expect(run.style.textDecorationThickness).toBe(decoration.thickness)
  }
  expect(tokenPaintMismatch(frame, reference)).toBe('token offsets or styles')
}

function delayTokenInstall(): () => void {
  const groups = [...CSS.highlights.entries()]
    .filter(([name]) => name.startsWith('editor-shared-token-'))
    .map(([name, highlight]) => ({ name, highlight, ranges: [...highlight] }))
  const first = groups.find((group) => group.ranges.length > 0)
  const range = first?.ranges[0]
  if (!first || !range) throw new RangeError('token install calibration unavailable')
  for (const group of groups) group.highlight.clear()
  first.highlight.add(range)
  return () => {
    for (const group of groups) restoreGroup(group)
  }

  function restoreGroup(group: (typeof groups)[number]): void {
    group.highlight.clear()
    for (const range of group.ranges) group.highlight.add(range)
    CSS.highlights.set(group.name, group.highlight)
  }
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
  // The trace installs only where client logging is on, as it is in the app it measures.
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
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
