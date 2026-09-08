import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import type {
  EditorInitialPaintEvent,
  EditorPlugin,
  EditorTextBuffer,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapor/core'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { editorVisibleSnapshotCounts } from '@/features/workbench/utils/editor-visible-snapshot'
import {
  readEditorVisibleSnapshotCache,
  removeEditorVisibleSnapshotCacheForPath,
  writeEditorVisibleSnapshotCache,
  type CachedEditorVisibleSnapshot,
} from '@/lib/editor-visible-snapshot-cache'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

const CAPTURE_DEBOUNCE_MS = 350
const PRESENTATION_FAIL_SAFE_MS = 1_500

type SnapshotPath = {
  readonly path: string
  readonly rootPath: string
}

type SnapshotTarget = SnapshotPath & {
  readonly contentVersion: string | null
}

type RenderedSnapshotDocument = SnapshotPath & {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
}

type EditorSnapshotThemeIdentity = {
  readonly appliedThemeId: string | null
  readonly committedThemeId: string
  readonly selectedThemeId: string
}

type UseEditorVisibleSnapshotOptions = {
  readonly storage: ScopedStorage
  readonly active: boolean
  readonly fileReadError: boolean
  readonly renderedDocument: RenderedSnapshotDocument | null
  readonly selectedTarget: SnapshotTarget
  readonly theme: EditorSnapshotThemeIdentity
}

type PresentedSnapshot = {
  readonly attempted: boolean
  readonly attemptedIdentities: ReadonlySet<string>
  readonly identity: string
  readonly record: CachedEditorVisibleSnapshot | null
}

type PendingPaintEvent = {
  readonly event: EditorInitialPaintEvent
  readonly paintIdentity: string
}

type EditorVisibleSnapshotPerformanceDiagnostic = {
  readonly detail?: Readonly<Record<string, unknown>>
  readonly durationMs?: number
  readonly name: string
}

type EditorVisibleSnapshotPerformanceGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: {
    readonly enabled: boolean
    record(diagnostic: EditorVisibleSnapshotPerformanceDiagnostic): void
  } | null
  __editorPerfTrace?: {
    mark(name: string, detail?: Readonly<Record<string, unknown>>): void
  }
}

type CaptureRuntime = {
  readonly storage: ScopedStorage
  active: boolean
  appliedThemeId: string | null
  cachedPaintFrame: number | null
  cachedPaintFrameTime: number | null
  captureTimer: ReturnType<typeof setTimeout> | null
  committedThemeId: string
  coreDocumentGeneration: number | null
  disposed: boolean
  generation: number
  livePaintSnapshot: EditorViewSnapshot | null
  latestSnapshot: {
    readonly generation: number
    readonly kind: EditorViewContributionUpdateKind
    readonly snapshot: EditorViewSnapshot
  } | null
  paintFrame: number | null
  paintIdentity: string | null
  pendingPaintEvents: PendingPaintEvent[]
  terminalPaint: PendingPaintEvent | null
  presentationTimer: ReturnType<typeof setTimeout> | null
  renderedDocument: RenderedSnapshotDocument | null
  selectedTarget: SnapshotTarget
  selectedThemeId: string
}

export type EditorVisibleSnapshotBinding = {
  readonly additionalPlugins: readonly EditorPlugin[]
  readonly dismissOverlay: () => void
  readonly onInitialPaint: (event: EditorInitialPaintEvent) => void
  readonly overlayRef: RefObject<HTMLDivElement | null>
  readonly record: CachedEditorVisibleSnapshot | null
}

/** Owns the visual-only capture and handoff for one file editor pane. */
export function useEditorVisibleSnapshot({
  storage,
  active,
  fileReadError,
  renderedDocument,
  selectedTarget,
  theme,
}: UseEditorVisibleSnapshotOptions): EditorVisibleSnapshotBinding {
  const presentationIdentity = cachePresentationIdentity(active, selectedTarget, theme)
  const [presented, setPresented] = useState<PresentedSnapshot>(() =>
    initialPresentedSnapshot(
      storage,
      presentationIdentity,
      active,
      fileReadError,
      renderedDocument,
      selectedTarget,
      theme,
    ),
  )
  if (presented.identity !== presentationIdentity) {
    setPresented(
      initialPresentedSnapshot(
        storage,
        presentationIdentity,
        active,
        fileReadError,
        renderedDocument,
        selectedTarget,
        theme,
        presented.attemptedIdentities,
      ),
    )
  } else if (!presented.attempted && renderedDocument === null) {
    setPresented(
      initialPresentedSnapshot(
        storage,
        presentationIdentity,
        active,
        fileReadError,
        renderedDocument,
        selectedTarget,
        theme,
        presented.attemptedIdentities,
      ),
    )
  } else if (
    presented.record &&
    selectedTarget.contentVersion !== null &&
    presented.record.contentVersion !== selectedTarget.contentVersion
  ) {
    setPresented({ ...presented, record: null })
  }

  const overlayRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<CaptureRuntime | (() => CaptureRuntime)>(() =>
    createCaptureRuntime(storage, active, renderedDocument, selectedTarget, theme),
  )
  const dismissOverlay = useMemo(
    () => (removeTarget?: SnapshotPath) => {
      const overlay = overlayRef.current
      if (overlay) overlay.hidden = true
      const runtime = currentCaptureRuntime(runtimeRef)
      cancelOverlayPresentation(runtime)
      runtime.terminalPaint = null
      if (removeTarget) removeEditorVisibleSnapshotCacheForPath(storage, removeTarget)
      setPresented((current) => {
        if (current.record === null) return current

        return { ...current, attempted: true, record: null }
      })
    },
    [storage],
  )
  // Event handlers must not forward their synthetic event as a cache-removal target.
  const dismissOverlayForInteraction = useMemo(() => () => dismissOverlay(), [dismissOverlay])

  // Plugin identity is part of the editor attachment contract.
  const plugin = useMemo<EditorPlugin>(
    () => ({
      name: 'platform-visible-snapshot',
      activate: (context) =>
        context.registerViewContribution({
          createContribution: () => ({
            dispose: () => flushCapture(currentCaptureRuntime(runtimeRef)),
            update: (snapshot, kind) =>
              acceptSnapshot(currentCaptureRuntime(runtimeRef), snapshot, kind),
          }),
        }),
    }),
    [],
  )
  const additionalPlugins = useMemo<readonly EditorPlugin[]>(() => [plugin], [plugin])
  const onInitialPaintCandidateIdentity = initialPaintCandidateIdentity(
    active,
    renderedDocument,
    selectedTarget,
    theme,
  )
  const onInitialPaintDocumentId = renderedDocument?.documentId ?? null
  const onInitialPaint = (event: EditorInitialPaintEvent) => {
    if (event.documentId !== onInitialPaintDocumentId) return

    acceptInitialPaint(
      currentCaptureRuntime(runtimeRef),
      event,
      onInitialPaintCandidateIdentity,
      dismissOverlayForInteraction,
    )
  }
  const renderedBuffer = renderedDocument?.buffer ?? null
  const renderedDocumentId = renderedDocument?.documentId ?? null
  const renderedPath = renderedDocument?.path ?? null
  const renderedRootPath = renderedDocument?.rootPath ?? null
  const selectedPath = selectedTarget.path
  const selectedRootPath = selectedTarget.rootPath
  const selectedContentVersion = selectedTarget.contentVersion
  const appliedThemeId = theme.appliedThemeId
  const committedThemeId = theme.committedThemeId
  const selectedThemeId = theme.selectedThemeId

  useLayoutEffect(() => {
    const runtime = currentCaptureRuntime(runtimeRef)
    const nextRenderedDocument = renderedSnapshotDocument(
      renderedBuffer,
      renderedDocumentId,
      renderedPath,
      renderedRootPath,
    )
    const nextPaintCandidateIdentity = initialPaintCandidateIdentity(
      active,
      nextRenderedDocument,
      { contentVersion: selectedContentVersion, path: selectedPath, rootPath: selectedRootPath },
      { appliedThemeId, committedThemeId, selectedThemeId },
    )
    const nextTarget = {
      contentVersion: selectedContentVersion,
      path: selectedPath,
      rootPath: selectedRootPath,
    }
    const nextTheme = { appliedThemeId, committedThemeId, selectedThemeId }
    if (!captureRuntimeMatches(runtime, active, nextRenderedDocument, nextTarget, nextTheme)) {
      flushCapture(runtime)
      installCaptureIdentity(runtime, active, nextRenderedDocument, nextTarget, nextTheme)
    }
    if (runtime.paintIdentity !== nextPaintCandidateIdentity) {
      cancelAuthoritativePaint(runtime)
      return
    }
    scheduleAuthoritativePaint(runtime, dismissOverlayForInteraction)
  }, [
    active,
    appliedThemeId,
    committedThemeId,
    dismissOverlayForInteraction,
    renderedBuffer,
    renderedDocumentId,
    renderedPath,
    renderedRootPath,
    selectedPath,
    selectedRootPath,
    selectedContentVersion,
    selectedThemeId,
  ])

  useLayoutEffect(() => {
    const runtime = currentCaptureRuntime(runtimeRef)
    const document = renderedSnapshotDocument(
      renderedBuffer,
      renderedDocumentId,
      renderedPath,
      renderedRootPath,
    )
    if (!document) return

    const { buffer } = document
    const removeDirtySnapshot = () => {
      if (!buffer.isDirty()) return
      if (!renderedDocumentMatches(runtime.renderedDocument, document)) return

      cancelPendingCapture(runtime)
      dismissOverlay(document)
    }
    removeDirtySnapshot()
    return buffer.subscribe(removeDirtySnapshot)
  }, [dismissOverlay, renderedBuffer, renderedDocumentId, renderedPath, renderedRootPath])

  useLayoutEffect(() => {
    if (!fileReadError) return

    const runtime = currentCaptureRuntime(runtimeRef)
    cancelPendingCapture(runtime)
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect -- read errors synchronously invalidate an external cached visual.
    dismissOverlay({ path: selectedPath, rootPath: selectedRootPath })
  }, [dismissOverlay, fileReadError, selectedPath, selectedRootPath])

  const record = presentableRecord(
    presented.record,
    active,
    fileReadError,
    renderedDocument,
    selectedTarget,
    theme,
  )
  useLayoutEffect(() => {
    if (!record) return

    const runtime = currentCaptureRuntime(runtimeRef)
    const startedAt = now()
    const detail = {
      ...editorVisibleSnapshotCounts(record.snapshot),
      contentVersionKnown: runtime.selectedTarget.contentVersion !== null,
      path: record.path,
      rootPath: record.rootPath,
      themeId: record.themeId,
    }
    runtime.cachedPaintFrame = requestAnimationFrame((frameTime) => {
      runtime.cachedPaintFrame = null
      runtime.cachedPaintFrameTime = frameTime
      markEditorVisibleSnapshotPerformance('editor.cached_visible_paint', detail)
      recordEditorVisibleSnapshotPerformance(
        'editor.visible_snapshot.render',
        now() - startedAt,
        detail,
      )
    })
    runtime.presentationTimer = setTimeout(() => dismissOverlay(), PRESENTATION_FAIL_SAFE_MS)
    return () => {
      cancelPresentationTimer(runtime)
      cancelCachedPaint(runtime)
    }
  }, [dismissOverlay, record])

  useEffect(() => addLifecycleFlush(() => flushCapture(currentCaptureRuntime(runtimeRef))), [])

  useLayoutEffect(() => {
    const runtime = currentCaptureRuntime(runtimeRef)
    runtime.disposed = false

    return () => {
      flushCapture(runtime)
      runtime.disposed = true
      cancelPendingCapture(runtime)
      cancelPresentationWork(runtime)
    }
  }, [])

  return {
    additionalPlugins,
    dismissOverlay: dismissOverlayForInteraction,
    onInitialPaint,
    overlayRef,
    record,
  }
}

function currentCaptureRuntime(runtimeRef: {
  current: CaptureRuntime | (() => CaptureRuntime)
}): CaptureRuntime {
  const current = runtimeRef.current
  if (typeof current !== 'function') return current

  const runtime = current()
  runtimeRef.current = runtime
  return runtime
}

function createCaptureRuntime(
  storage: ScopedStorage,
  active: boolean,
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
): CaptureRuntime {
  return {
    storage,
    active,
    appliedThemeId: theme.appliedThemeId,
    cachedPaintFrame: null,
    cachedPaintFrameTime: null,
    captureTimer: null,
    committedThemeId: theme.committedThemeId,
    coreDocumentGeneration: null,
    disposed: false,
    generation: 0,
    livePaintSnapshot: null,
    latestSnapshot: null,
    paintFrame: null,
    paintIdentity: null,
    pendingPaintEvents: [],
    terminalPaint: null,
    presentationTimer: null,
    renderedDocument,
    selectedTarget,
    selectedThemeId: theme.selectedThemeId,
  }
}

function renderedSnapshotDocument(
  buffer: EditorTextBuffer | null,
  documentId: string | null,
  path: string | null,
  rootPath: string | null,
): RenderedSnapshotDocument | null {
  if (!buffer || documentId === null || path === null || rootPath === null) return null

  return { buffer, documentId, path, rootPath }
}

function installCaptureIdentity(
  runtime: CaptureRuntime,
  active: boolean,
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
): void {
  cancelPendingCapture(runtime)
  runtime.generation += 1
  runtime.active = active
  runtime.appliedThemeId = theme.appliedThemeId
  runtime.committedThemeId = theme.committedThemeId
  runtime.cachedPaintFrameTime = null
  runtime.latestSnapshot = null
  runtime.livePaintSnapshot = null
  runtime.renderedDocument = renderedDocument
  runtime.selectedTarget = selectedTarget
  runtime.selectedThemeId = theme.selectedThemeId
}

function captureRuntimeMatches(
  runtime: CaptureRuntime,
  active: boolean,
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
): boolean {
  if (runtime.active !== active) return false
  if (runtime.appliedThemeId !== theme.appliedThemeId) return false
  if (runtime.committedThemeId !== theme.committedThemeId) return false
  if (runtime.selectedThemeId !== theme.selectedThemeId) return false
  if (runtime.selectedTarget.path !== selectedTarget.path) return false
  if (runtime.selectedTarget.rootPath !== selectedTarget.rootPath) return false
  if (runtime.selectedTarget.contentVersion !== selectedTarget.contentVersion) return false

  return renderedDocumentMatches(runtime.renderedDocument, renderedDocument)
}

function renderedDocumentMatches(
  current: RenderedSnapshotDocument | null,
  next: RenderedSnapshotDocument | null,
): boolean {
  if (!current || !next) return current === next
  if (current.buffer !== next.buffer) return false
  if (current.documentId !== next.documentId) return false
  if (current.path !== next.path) return false

  return current.rootPath === next.rootPath
}

function acceptSnapshot(
  runtime: CaptureRuntime,
  snapshot: EditorViewSnapshot,
  kind: EditorViewContributionUpdateKind,
): void {
  if (!captureIdentityMatches(runtime, snapshot)) return

  cancelPendingCapture(runtime)
  runtime.livePaintSnapshot = snapshot
  runtime.latestSnapshot = { generation: runtime.generation, kind, snapshot }
  if (snapshot.initialHighlightStatus === 'loading') return

  const generation = runtime.generation
  runtime.captureTimer = setTimeout(() => flushCapture(runtime, generation), CAPTURE_DEBOUNCE_MS)
}

function flushCapture(runtime: CaptureRuntime, expectedGeneration = runtime.generation): void {
  if (runtime.disposed) return
  if (runtime.generation !== expectedGeneration) return

  cancelCaptureTimer(runtime)
  const pending = runtime.latestSnapshot
  runtime.latestSnapshot = null
  if (!pending || pending.generation !== expectedGeneration) return
  if (!captureIdentityMatches(runtime, pending.snapshot)) return
  if (pending.snapshot.initialHighlightStatus === 'loading') return
  if (pending.snapshot.visibleRows.length === 0) return

  const startedAt = now()
  const captureDetail = {
    syntaxStatus: pending.snapshot.syntaxStatus,
    updateKind: pending.kind,
  }
  const visible = pending.snapshot.toVisibleSnapshot()
  const materializeDurationMs = now() - startedAt
  if (!visible || visible.rows.length === 0) {
    const outcome = visible ? 'empty' : visibleSnapshotUnsupportedOutcome(pending.snapshot)
    recordEditorVisibleSnapshotPerformance(
      'editor.visible_snapshot.materialize',
      materializeDurationMs,
      { ...captureDetail, outcome },
    )
    recordEditorVisibleSnapshotPerformance('editor.visible_snapshot.capture', now() - startedAt, {
      ...captureDetail,
      outcome,
    })
    return
  }

  const rendered = runtime.renderedDocument
  const themeId = runtime.appliedThemeId
  const contentVersion = runtime.selectedTarget.contentVersion
  if (!rendered || !themeId || contentVersion === null) return

  const snapshot = visible.toJSON()
  recordEditorVisibleSnapshotPerformance(
    'editor.visible_snapshot.materialize',
    materializeDurationMs,
    {
      ...editorVisibleSnapshotCounts(snapshot),
      ...captureDetail,
      outcome: 'ready',
    },
  )
  const result = writeEditorVisibleSnapshotCache(runtime.storage, {
    cacheVersion: 4,
    contentVersion,
    path: rendered.path,
    rootPath: rendered.rootPath,
    snapshot,
    themeId,
  })
  recordEditorVisibleSnapshotPerformance('editor.visible_snapshot.capture', now() - startedAt, {
    ...editorVisibleSnapshotCounts(snapshot),
    ...captureDetail,
    outcome: result.status,
    serializedBytes: result.serializedBytes,
  })
}

function captureIdentityMatches(runtime: CaptureRuntime, snapshot: EditorViewSnapshot): boolean {
  if (runtime.disposed) return false
  if (!runtime.active) return false
  const rendered = runtime.renderedDocument
  if (!rendered) return false
  if (runtime.selectedTarget.rootPath !== rendered.rootPath) return false
  if (runtime.selectedTarget.path !== rendered.path) return false
  if (snapshot.documentId !== rendered.documentId) return false
  if (rendered.buffer.isDirty()) return false
  if (!runtime.appliedThemeId) return false
  if (runtime.selectedThemeId !== runtime.committedThemeId) return false

  return runtime.committedThemeId === runtime.appliedThemeId
}

function acceptInitialPaint(
  runtime: CaptureRuntime,
  event: EditorInitialPaintEvent,
  paintIdentity: string | null,
  dismiss: () => void,
): void {
  if (runtime.disposed) return
  if (!paintIdentity) return
  const currentPaintIdentity = initialPaintCandidateIdentity(
    runtime.active,
    runtime.renderedDocument,
    runtime.selectedTarget,
    {
      appliedThemeId: runtime.appliedThemeId,
      committedThemeId: runtime.committedThemeId,
      selectedThemeId: runtime.selectedThemeId,
    },
  )
  if (paintIdentity !== currentPaintIdentity) return

  if (event.phase === 'text') {
    runtime.terminalPaint = null
    runtime.coreDocumentGeneration = event.documentGeneration
    runtime.paintIdentity = paintIdentity
  } else if (
    runtime.paintIdentity !== paintIdentity ||
    runtime.coreDocumentGeneration !== event.documentGeneration
  ) {
    return
  }

  runtime.pendingPaintEvents.push({ event, paintIdentity })
  scheduleAuthoritativePaint(runtime, dismiss)
}

function scheduleAuthoritativePaint(runtime: CaptureRuntime, dismiss: () => void): void {
  if (runtime.pendingPaintEvents.length === 0 && runtime.terminalPaint === null) return
  const currentPaintIdentity = authoritativePaintIdentity(
    runtime.active,
    runtime.renderedDocument,
    runtime.selectedTarget,
    {
      appliedThemeId: runtime.appliedThemeId,
      committedThemeId: runtime.committedThemeId,
      selectedThemeId: runtime.selectedThemeId,
    },
  )
  if (!currentPaintIdentity || runtime.paintIdentity !== currentPaintIdentity) {
    cancelAuthoritativePaintFrame(runtime)
    return
  }
  if (runtime.paintFrame !== null) return

  runtime.paintFrame = requestAnimationFrame((frameTime) =>
    flushInitialPaint(runtime, dismiss, frameTime),
  )
}

function flushInitialPaint(runtime: CaptureRuntime, dismiss: () => void, frameTime: number): void {
  runtime.paintFrame = null
  if (runtime.cachedPaintFrame !== null || runtime.cachedPaintFrameTime === frameTime) {
    runtime.paintFrame = requestAnimationFrame((nextFrameTime) =>
      flushInitialPaint(runtime, dismiss, nextFrameTime),
    )
    return
  }

  const pending = runtime.pendingPaintEvents
  runtime.pendingPaintEvents = []
  const currentPaintIdentity = authoritativePaintIdentity(
    runtime.active,
    runtime.renderedDocument,
    runtime.selectedTarget,
    {
      appliedThemeId: runtime.appliedThemeId,
      committedThemeId: runtime.committedThemeId,
      selectedThemeId: runtime.selectedThemeId,
    },
  )
  for (const item of pending) {
    if (item.paintIdentity !== currentPaintIdentity) continue
    if (item.paintIdentity !== runtime.paintIdentity) continue
    if (item.event.documentGeneration !== runtime.coreDocumentGeneration) continue

    if (item.event.phase === 'text') {
      markEditorVisibleSnapshotPerformance(
        'editor.authoritative_text_paint',
        paintEventDetail(item.event),
      )
      continue
    }

    if (item.event.status !== 'plain') runtime.terminalPaint = item
    if (item.event.status === 'painted' || item.event.status === 'degraded') {
      markEditorVisibleSnapshotPerformance(
        'editor.authoritative_highlight_paint',
        paintEventDetail(item.event),
      )
      continue
    }

    recordEditorVisibleSnapshotPerformance('editor.authoritative_highlight_outcome', 0, {
      ...paintEventDetail(item.event),
      status: item.event.status,
    })
  }

  const terminal = runtime.terminalPaint
  if (!terminal || terminal.paintIdentity !== currentPaintIdentity) return
  if (terminal.event.documentGeneration !== runtime.coreDocumentGeneration) return
  if (terminal.event.phase !== 'highlight-settled') return
  if (terminal.event.status === 'error' || runtime.presentationTimer === null) {
    dismiss()
    return
  }

  const snapshot = runtime.livePaintSnapshot
  if (
    snapshot?.documentId === terminal.event.documentId &&
    snapshot.textVersion === terminal.event.textVersion &&
    snapshot.paintLayers !== null
  ) {
    markEditorVisibleSnapshotPerformance('editor.authoritative_visible_paint', {
      ...paintEventDetail(terminal.event),
      foldMarkers: snapshot.foldMarkers.length,
      paintLayers: snapshot.paintLayers.length,
      paintRectangles: snapshot.paintLayers.reduce(
        (count, layer) => count + layer.rectangles.length,
        0,
      ),
      syntaxStatus: snapshot.syntaxStatus,
    })
    dismiss()
    return
  }

  scheduleAuthoritativePaint(runtime, dismiss)
}

function paintEventDetail(event: EditorInitialPaintEvent): Readonly<Record<string, unknown>> {
  const detail = {
    documentGeneration: event.documentGeneration,
    documentId: event.documentId,
    phase: event.phase,
    textVersion: event.textVersion,
  }
  if (event.phase === 'text') return detail

  return { ...detail, status: event.status }
}

function cancelPendingCapture(runtime: CaptureRuntime): void {
  cancelCaptureTimer(runtime)
  runtime.latestSnapshot = null
}

function cancelCaptureTimer(runtime: CaptureRuntime): void {
  if (runtime.captureTimer === null) return

  clearTimeout(runtime.captureTimer)
  runtime.captureTimer = null
}

function cancelPresentationWork(runtime: CaptureRuntime): void {
  cancelOverlayPresentation(runtime)
  cancelAuthoritativePaint(runtime)
}

function cancelOverlayPresentation(runtime: CaptureRuntime): void {
  cancelPresentationTimer(runtime)
  cancelCachedPaint(runtime)
}

function cancelCachedPaint(runtime: CaptureRuntime): void {
  if (runtime.cachedPaintFrame === null) return

  cancelAnimationFrame(runtime.cachedPaintFrame)
  runtime.cachedPaintFrame = null
}

function cancelPresentationTimer(runtime: CaptureRuntime): void {
  if (runtime.presentationTimer === null) return

  clearTimeout(runtime.presentationTimer)
  runtime.presentationTimer = null
}

function cancelAuthoritativePaint(runtime: CaptureRuntime): void {
  runtime.coreDocumentGeneration = null
  runtime.paintIdentity = null
  runtime.pendingPaintEvents = []
  runtime.terminalPaint = null
  cancelAuthoritativePaintFrame(runtime)
}

function cancelAuthoritativePaintFrame(runtime: CaptureRuntime): void {
  if (runtime.paintFrame === null) return

  cancelAnimationFrame(runtime.paintFrame)
  runtime.paintFrame = null
}

function initialPresentedSnapshot(
  storage: ScopedStorage,
  identity: string,
  active: boolean,
  fileReadError: boolean,
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
  priorAttempts: ReadonlySet<string> = new Set(),
): PresentedSnapshot {
  if (priorAttempts.has(identity)) {
    return { attempted: true, attemptedIdentities: priorAttempts, identity, record: null }
  }

  const eligible =
    active &&
    !fileReadError &&
    cachePresentationMatchesRenderedDocument(renderedDocument, selectedTarget) &&
    theme.selectedThemeId === theme.committedThemeId
  const attempted =
    renderedDocument === null ||
    cachePresentationMatchesRenderedDocument(renderedDocument, selectedTarget)
  const attemptedIdentities = attempted ? new Set([...priorAttempts, identity]) : priorAttempts
  if (!eligible) {
    return { attempted, attemptedIdentities, identity, record: null }
  }

  return {
    attempted: true,
    attemptedIdentities,
    identity,
    record: readEditorVisibleSnapshotCache(storage, {
      path: selectedTarget.path,
      rootPath: selectedTarget.rootPath,
      themeId: theme.committedThemeId,
    }),
  }
}

function cachePresentationMatchesRenderedDocument(
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
): boolean {
  if (!renderedDocument) return true
  if (renderedDocument.buffer.isDirty()) return false
  if (renderedDocument.rootPath !== selectedTarget.rootPath) return false
  return renderedDocument.path === selectedTarget.path
}

function presentableRecord(
  record: CachedEditorVisibleSnapshot | null,
  active: boolean,
  fileReadError: boolean,
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
): CachedEditorVisibleSnapshot | null {
  if (!record || !active || fileReadError) return null
  if (
    selectedTarget.contentVersion !== null &&
    record.contentVersion !== selectedTarget.contentVersion
  )
    return null
  if (record.rootPath !== selectedTarget.rootPath) return null
  if (record.path !== selectedTarget.path) return null
  if (theme.selectedThemeId !== theme.committedThemeId) return null
  if (renderedDocument?.buffer.isDirty()) return null
  if (renderedDocument && record.rootPath !== renderedDocument.rootPath) return null
  if (renderedDocument && record.path !== renderedDocument.path) return null

  return record
}

function cachePresentationIdentity(
  active: boolean,
  target: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
): string {
  return [
    active ? 'active' : 'inactive',
    target.rootPath,
    target.path,
    theme.committedThemeId,
    theme.selectedThemeId,
  ].join('\u0000')
}

function authoritativePaintIdentity(
  active: boolean,
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
): string | null {
  const candidate = initialPaintCandidateIdentity(active, renderedDocument, selectedTarget, theme)
  if (!candidate) return null
  if (theme.appliedThemeId !== theme.committedThemeId) return null

  return candidate
}

function initialPaintCandidateIdentity(
  active: boolean,
  renderedDocument: RenderedSnapshotDocument | null,
  selectedTarget: SnapshotTarget,
  theme: EditorSnapshotThemeIdentity,
): string | null {
  if (!active || !renderedDocument) return null
  if (selectedTarget.rootPath !== renderedDocument.rootPath) return null
  if (selectedTarget.path !== renderedDocument.path) return null
  if (renderedDocument.buffer.isDirty()) return null
  if (theme.selectedThemeId !== theme.committedThemeId) return null

  return [
    renderedDocument.rootPath,
    renderedDocument.path,
    renderedDocument.documentId,
    theme.selectedThemeId,
    theme.committedThemeId,
  ].join('\u0000')
}

function visibleSnapshotUnsupportedOutcome(
  snapshot: EditorViewSnapshot,
): 'pending-paint' | 'unreplayable-plugin-css' | 'unreplayable-widget' {
  if (snapshot.paintLayers === null) return 'pending-paint'

  for (const row of snapshot.visibleRows) {
    if (row.mountedPaintSupport === 'unreplayable-plugin-css') {
      return 'unreplayable-plugin-css'
    }
  }

  return 'unreplayable-widget'
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/** Records a paint boundary for the cold-editor benchmark. */
function markEditorVisibleSnapshotPerformance(
  name: string,
  detail?: Readonly<Record<string, unknown>>,
): void {
  if (typeof performance === 'undefined') return

  performance.mark(name, detail ? { detail } : undefined)
  performanceGlobal().__editorPerfTrace?.mark(name, detail)
}

/** Adds one bounded diagnostic when the optional editor trace is active. */
function recordEditorVisibleSnapshotPerformance(
  name: string,
  durationMs: number,
  detail?: Readonly<Record<string, unknown>>,
): void {
  const sink = performanceGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink?.enabled) return

  sink.record({ detail, durationMs, name })
}

function performanceGlobal(): EditorVisibleSnapshotPerformanceGlobal {
  return globalThis as EditorVisibleSnapshotPerformanceGlobal
}
