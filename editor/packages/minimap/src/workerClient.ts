import { computeFrameLayout, computeRenderLayout, visibleDocumentLineRange } from './layout'
import type { TextEdit } from '@singapore-editor/core/document'
import type { EditorTokenStore } from '@singapore-editor/core/syntax'
import { createError } from '@singapore-editor/core/logging/evlog'
import type {
  EditorContributionChange,
  EditorMinimapDecoration,
  EditorResolvedSelection,
  EditorViewportSnapshot,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  createEditorSecondaryViewProjection,
  EditorSecondaryViewScheduler,
  type EditorSecondaryViewTextProjection,
} from '@singapore-editor/core/secondary-views'
import { parseCssColor, RGBA_BLACK, RGBA_WHITE, transparent } from './color'
import type {
  MinimapBaseStyles,
  MinimapDocumentEditPayload,
  MinimapDocumentPayload,
  MinimapDocumentSummaryPatch,
  MinimapDocumentSummaryPayload,
  MinimapMetrics,
  MinimapSelection,
  MinimapToken,
  MinimapTokenPatch,
  MinimapViewport,
  MinimapWorkerRequest,
  MinimapWorkerResponse,
  ResolvedMinimapOptions,
  RGBA8,
} from './types'

const MINIMAP_UPDATE_QUIET_DELAY_MS = 120
const MINIMAP_UPDATE_MAX_DELAY_MS = 300
const MINIMAP_FRAME_FLUSH_KEY = 'minimap.flush.frame'
const MINIMAP_QUIET_FLUSH_KEY = 'minimap.flush.quiet'
const MINIMAP_RENDER_KEY = 'minimap.render'

export type MinimapHost = {
  readonly root: HTMLDivElement
  readonly colorScope: HTMLElement
  readonly mainCanvas: HTMLCanvasElement
  readonly decorationsCanvas: HTMLCanvasElement
  readonly slider: HTMLDivElement
  readonly sliderHorizontal: HTMLDivElement
  readonly shadow: HTMLDivElement
}

export type MinimapWorkerClientOptions = {
  readonly host: MinimapHost
  readonly options: ResolvedMinimapOptions
  readonly snapshot: EditorViewSnapshot
  readonly decorations: readonly EditorMinimapDecoration[]
  readonly onLayoutWidth: (width: number) => void
  readonly reservedLane: () => number
}

export type MinimapWorkerLifecycleState = 'ready' | 'disposing' | 'disposed' | 'crashed'

export type MinimapWorkerOwnerSnapshot = {
  readonly lifecycle: MinimapWorkerLifecycleState
  readonly postedRequests: number
  readonly disposalAcknowledged: boolean
  readonly lastError: string | null
}

export type MinimapWorkerOwnerOptions = {
  readonly onMessage: (response: MinimapWorkerResponse) => void
  readonly onError?: (error: Error) => void
  readonly workerFactory?: () => Worker
}

export class MinimapWorkerOwner {
  private worker: Worker | null = null
  private lifecycle: MinimapWorkerLifecycleState = 'ready'
  private postedRequests = 0
  private disposalAcknowledged = false
  private lastError: Error | null = null
  private disposalPromise: Promise<void> | null = null
  private resolveDisposal: (() => void) | null = null
  private rejectDisposal: ((error: Error) => void) | null = null

  public constructor(private readonly options: MinimapWorkerOwnerOptions) {
    this.worker = this.createWorker()
  }

  public inspect(): MinimapWorkerOwnerSnapshot {
    return {
      lifecycle: this.lifecycle,
      postedRequests: this.postedRequests,
      disposalAcknowledged: this.disposalAcknowledged,
      lastError: this.lastError?.message ?? null,
    }
  }

  public post(request: MinimapWorkerRequest, transfer?: Transferable[]): boolean {
    const handle = this.worker
    if (!this.canPost(handle)) return false

    this.postedRequests += 1
    try {
      this.postToWorker(handle, request, transfer)
      return true
    } catch (error) {
      this.fail(workerRequestError(error))
      return false
    }
  }

  public dispose(): Promise<void> {
    if (this.lifecycle === 'disposed') return Promise.resolve()
    if (this.disposalPromise) return this.disposalPromise

    const handle = this.worker
    if (!handle) {
      this.finishDisposal()
      return Promise.resolve()
    }

    this.lifecycle = 'disposing'
    this.disposalPromise = new Promise((resolve, reject) => {
      this.resolveDisposal = resolve
      this.rejectDisposal = reject
    })
    if (!this.post({ type: 'dispose' }))
      this.rejectDisposal?.(this.lastError ?? workerDisposedError())
    return this.disposalPromise
  }

  private createWorker(): Worker {
    const handle =
      this.options.workerFactory?.() ??
      new Worker(new URL('./minimap.worker.ts', import.meta.url), { type: 'module' })
    handle.onmessage = this.handleWorkerMessage
    handle.onerror = this.handleWorkerError
    return handle
  }

  private canPost(handle: Worker | null): handle is Worker {
    if (!handle) return false
    if (this.lifecycle === 'disposed') return false
    return this.lifecycle !== 'crashed'
  }

  private postToWorker(
    handle: Worker,
    request: MinimapWorkerRequest,
    transfer?: Transferable[],
  ): void {
    if (transfer) {
      handle.postMessage(request, transfer)
      return
    }

    handle.postMessage(request)
  }

  private readonly handleWorkerMessage = (event: MessageEvent<MinimapWorkerResponse>): void => {
    const response = event.data
    if (response.type === 'disposed') {
      this.disposalAcknowledged = true
      this.finishDisposal()
      return
    }

    if (response.type === 'error') {
      this.recordError(createWorkerResponseError(response))
      return
    }

    this.options.onMessage(response)
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.fail(createNativeWorkerError(event))
  }

  private recordError(error: Error): void {
    this.lastError = error
    this.options.onError?.(error)
  }

  private fail(error: Error): void {
    this.lastError = error
    this.lifecycle = 'crashed'
    this.terminateWorker()
    this.rejectDisposal?.(error)
    this.clearDisposalHandlers()
    this.options.onError?.(error)
  }

  private finishDisposal(): void {
    this.lifecycle = 'disposed'
    this.terminateWorker()
    this.resolveDisposal?.()
    this.clearDisposalHandlers()
  }

  private terminateWorker(): void {
    this.worker?.terminate()
    this.worker = null
  }

  private clearDisposalHandlers(): void {
    this.resolveDisposal = null
    this.rejectDisposal = null
  }
}

export class MinimapWorkerClient {
  private readonly host: MinimapHost
  private readonly options: ResolvedMinimapOptions
  private readonly workerOwner: MinimapWorkerOwner
  private readonly colorResolver: ColorResolver
  private readonly scheduler = new EditorSecondaryViewScheduler()
  private readonly onLayoutWidth: (width: number) => void
  private readonly reservedLane: () => number
  private externalDecorations: readonly EditorMinimapDecoration[]
  private pendingUpdate: PendingMinimapUpdate | null = null
  private pendingUpdateReady = false
  private pendingRender = false
  private activeRenderToken = 0
  private renderInFlight = false
  private latestBaseStyles: MinimapBaseStyles | null = null
  private latestBaseStylesSignature = ''
  private latestLayoutSignature = ''
  private latestThemeSignature = ''
  private latestSnapshot: EditorViewSnapshot
  private latestViewport: EditorViewportSnapshot
  private postedViewport: MinimapViewport | null = null
  private latestFullDocumentSnapshot: EditorViewSnapshot | null = null
  // Mirror of the worker's current document summary; the authoritative
  // pre-edit baseline for incremental patch accounting.
  private workerDocumentState: WorkerDocumentState | null = null
  private latestTokenSource: EditorTokenStore | null
  private disposed = false

  public constructor(options: MinimapWorkerClientOptions) {
    this.host = options.host
    this.options = options.options
    this.onLayoutWidth = options.onLayoutWidth
    this.reservedLane = options.reservedLane
    this.externalDecorations = options.decorations
    this.latestSnapshot = options.snapshot
    this.latestViewport = options.snapshot.viewport
    this.latestTokenSource = options.snapshot.tokens
    this.colorResolver = new ColorResolver(options.host.colorScope)
    this.workerOwner = new MinimapWorkerOwner({
      onError: this.handleWorkerError,
      onMessage: this.handleWorkerMessage,
    })
    this.init(options.snapshot)
  }

  public inspectWorker(): MinimapWorkerOwnerSnapshot {
    return this.workerOwner.inspect()
  }

  public update(
    snapshot: EditorViewSnapshot,
    kind: string,
    change?: EditorContributionChange | null,
  ): void {
    if (this.disposed) return
    if (this.shouldSkipDocumentUpdate(snapshot, kind)) {
      this.latestSnapshot = snapshot
      return
    }

    const previousSnapshot = this.latestSnapshot
    this.latestSnapshot = snapshot
    if (kind === 'viewport') {
      this.latestViewport = snapshot.viewport
      const layoutUpdated = this.postLayoutIfNeeded(snapshot)
      this.updateViewport(snapshot.viewport)
      if (layoutUpdated) this.requestRender()
      return
    }

    const update = createPendingUpdate(snapshot, kind, change, previousSnapshot)
    this.latestViewport = snapshot.viewport
    this.applyImmediateViewport()
    this.queueUpdate(update)
  }

  private queueUpdate(update: PendingMinimapUpdate): void {
    this.pendingUpdate = mergePendingUpdate(this.pendingUpdate, update)
    recordMinimapPerformanceDiagnostic('minimap.updateClassification', () =>
      pendingUpdateDiagnostics(update),
    )
    if (!this.renderInFlight) this.scheduleFlush()
  }

  public updateViewport(viewport: EditorViewportSnapshot): void {
    if (this.disposed) return

    this.latestViewport = viewport
    this.applyImmediateViewport()
    const next = this.viewport(this.latestSnapshot)
    if (sameViewport(this.postedViewport, next)) return

    this.postedViewport = next
    this.post({ type: 'updateViewport', viewport: next })
    this.requestRender()
  }

  public frameLayout() {
    const viewport = this.viewport(this.latestSnapshot)
    const metrics = this.metrics(this.latestSnapshot)
    const renderLayout = computeRenderLayout({
      minimap: this.options,
      metrics,
      viewport,
      lineCount: this.latestSnapshot.lineCount,
    })
    return computeFrameLayout({
      renderLayout,
      metrics,
      viewport,
      lineCount: this.latestSnapshot.lineCount,
      realLineCount: this.latestSnapshot.lineCount,
      previous: null,
    })
  }

  public setExternalDecorations(decorations: readonly EditorMinimapDecoration[]): void {
    if (this.disposed) return

    this.externalDecorations = decorations
    this.queueUpdate(
      createPendingUpdate(this.latestSnapshot, 'decorations', null, this.latestSnapshot),
    )
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.cancelScheduledFlush()
    this.scheduler.dispose()
    void this.workerOwner.dispose().catch(() => undefined)
    this.colorResolver.dispose()
  }

  private init(snapshot: EditorViewSnapshot): void {
    const mainCanvas = this.host.mainCanvas.transferControlToOffscreen()
    const decorationsCanvas = this.host.decorationsCanvas.transferControlToOffscreen()
    const baseStyles = this.baseStyles()
    this.latestBaseStyles = baseStyles
    this.latestBaseStylesSignature = baseStylesSignature(baseStyles)
    this.latestThemeSignature = themeSignature(snapshot)
    const request: MinimapWorkerRequest = {
      type: 'init',
      options: this.options,
      baseStyles,
      mainCanvas,
      decorationsCanvas,
    }

    this.post(request, [mainCanvas, decorationsCanvas])
    this.post({ type: 'openDocument', document: this.trackedDocumentPayload(snapshot) })
    this.latestFullDocumentSnapshot = snapshot
    this.postedViewport = this.viewport(snapshot)
    this.post({
      type: 'updateLayout',
      metrics: this.metrics(snapshot),
      viewport: this.postedViewport,
    })
    this.latestLayoutSignature = layoutSignature(snapshot, this.minimapHeight(snapshot))
    this.postRender(snapshot)
  }

  private scheduleFlush(): void {
    const pending = this.pendingUpdate
    if (!pending) return
    if (this.pendingUpdateReady) {
      this.scheduleFrameFlush()
      return
    }
    if (shouldDeferMinimapUpdate(pending)) {
      this.scheduleDeferredFlush()
      return
    }

    this.scheduleFrameFlush()
  }

  private scheduleFrameFlush(): void {
    this.scheduler.schedule({
      key: MINIMAP_FRAME_FLUSH_KEY,
      taskClass: 'visible-render',
      priority: 'high',
      tags: { configuration: 'frame', version: this.latestSnapshot.textVersion },
      run: () => this.flushPendingUpdate(),
    })
  }

  private scheduleDeferredFlush(): void {
    this.cancelScheduledFrame()
    // One key: the scheduler caps how long continuous edits may postpone the
    // quiet delay, which previously needed a second non-replacing key running
    // the same callback.
    this.scheduler.schedule({
      key: MINIMAP_QUIET_FLUSH_KEY,
      taskClass: 'background-derived',
      priority: 'low',
      delayMs: MINIMAP_UPDATE_QUIET_DELAY_MS,
      maxDelayMs: MINIMAP_UPDATE_MAX_DELAY_MS,
      tags: { configuration: 'quiet', version: this.latestSnapshot.textVersion },
      run: this.flushDeferredUpdate,
    })
  }

  private flushDeferredUpdate = (): void => {
    this.cancelDeferredFlush()
    this.pendingUpdateReady = true
    this.scheduleFrameFlush()
  }

  private flushPendingUpdate(): void {
    if (this.disposed) return
    if (this.renderInFlight) return

    const pending = this.pendingUpdate
    if (!pending) return

    measureMinimapPerformance(
      'minimap.flushPendingUpdate',
      () => this.flushPendingUpdateNow(pending),
      () => pendingUpdateDiagnostics(pending),
    )
  }

  private flushPendingUpdateNow(pending: PendingMinimapUpdate): void {
    this.pendingUpdate = null
    this.pendingUpdateReady = false
    measureMinimapPerformance(
      'minimap.postUpdate',
      () => this.postUpdate(pending),
      () => pendingUpdateDiagnostics(pending),
    )
    const layoutUpdated = this.postLayoutIfNeeded(pending.snapshot)
    this.postViewportIfNeeded(pending.snapshot, pending.syncViewport, layoutUpdated)
    this.postRender(pending.snapshot)
  }

  private postLayoutIfNeeded(snapshot: EditorViewSnapshot): boolean {
    const signature = layoutSignature(snapshot, this.minimapHeight(snapshot))
    if (signature === this.latestLayoutSignature) return false

    this.latestLayoutSignature = signature
    this.postedViewport = this.viewport(snapshot)
    this.post({
      type: 'updateLayout',
      metrics: this.metrics(snapshot),
      viewport: this.postedViewport,
    })
    return true
  }

  private postViewportIfNeeded(
    snapshot: EditorViewSnapshot,
    syncViewport: boolean,
    layoutUpdated: boolean,
  ): void {
    if (layoutUpdated) return
    if (!syncViewport) return

    this.postedViewport = this.viewport(snapshot)
    this.post({ type: 'updateViewport', viewport: this.postedViewport })
  }

  private postUpdate(update: PendingMinimapUpdate): void {
    const snapshot = update.snapshot
    let tokenColorsInvalidated = false
    if (update.syncBaseStyles) {
      tokenColorsInvalidated = this.refreshThemeColorCache(snapshot)
      tokenColorsInvalidated = this.syncBaseStyles() || tokenColorsInvalidated
    }

    if (update.replaceDocument) {
      this.post({ type: 'replaceDocument', document: this.trackedDocumentPayload(snapshot) })
      this.latestFullDocumentSnapshot = snapshot
      this.latestTokenSource = snapshot.tokens
      return
    }

    if (update.edits.length > 0) {
      this.latestFullDocumentSnapshot = null
      this.postEditUpdate(update)
      this.latestTokenSource = update.tokenSourceAfterEdits
    }
    if (update.syncTokens) {
      this.postTokenUpdate(snapshot, tokenColorsInvalidated)
    }
    if (update.syncSelection && update.edits.length === 0) {
      this.post({ type: 'updateSelection', selections: selections(snapshot.selections) })
    }
    if (update.syncExternalDecorations) {
      this.post({
        type: 'updateExternalDecorations',
        decorations: this.externalDecorations,
      })
    }
  }

  private postEditUpdate(update: PendingMinimapUpdate): void {
    const document = this.documentEditPayload(update, this.workerDocumentState)
    const patch = document.summaryPatch
    if (this.workerDocumentState) {
      this.workerDocumentState = {
        textLength: patch.textLength,
        lineCount: this.workerDocumentState.lineCount - patch.deleteCount + patch.lines.length,
      }
    }
    if (update.edits.length === 1) {
      this.post({ type: 'applyEdit', edit: update.edits[0]!, document })
      return
    }

    this.post({ type: 'applyEdits', edits: update.edits, document })
  }

  private trackedDocumentPayload(snapshot: EditorViewSnapshot): MinimapDocumentPayload {
    const document = this.documentPayload(snapshot)
    this.workerDocumentState = {
      textLength: document.textLength,
      lineCount: document.lines.length,
    }
    return document
  }

  private postTokenUpdate(snapshot: EditorViewSnapshot, forceFullUpdate: boolean): void {
    const sourceTokens = this.latestTokenSource
    if (forceFullUpdate || !sourceTokens) {
      this.postFullTokenUpdate(snapshot)
      return
    }

    const patch = this.tokenPatch(sourceTokens, snapshot.tokens)
    this.latestTokenSource = snapshot.tokens
    if (patch.deleteCount === 0 && patch.tokens.length === 0) return

    this.post({ type: 'updateTokenRange', patch })
  }

  private postFullTokenUpdate(snapshot: EditorViewSnapshot): void {
    this.post({ type: 'updateTokens', tokens: this.tokens(snapshot.tokens) })
    this.latestTokenSource = snapshot.tokens
  }

  private tokenPatch(previous: EditorTokenStore, next: EditorTokenStore): MinimapTokenPatch {
    const range = previous.changedRangeTo(next)
    return {
      start: range.start,
      deleteCount: range.deleteCount,
      tokens: this.tokens(next, range.start, range.insertEnd),
    }
  }

  private syncBaseStyles(): boolean {
    const styles = this.baseStyles()
    const signature = baseStylesSignature(styles)
    if (signature === this.latestBaseStylesSignature) return false

    this.latestBaseStyles = styles
    this.latestBaseStylesSignature = signature
    this.colorResolver.clear()
    this.post({ type: 'updateBaseStyles', baseStyles: styles })
    return true
  }

  private refreshThemeColorCache(snapshot: EditorViewSnapshot): boolean {
    const signature = themeSignature(snapshot)
    if (signature === this.latestThemeSignature) return false

    this.latestThemeSignature = signature
    this.colorResolver.clear()
    return true
  }

  private shouldSkipDocumentUpdate(snapshot: EditorViewSnapshot, kind: string): boolean {
    if (kind !== 'document') return false
    const latest = this.latestFullDocumentSnapshot
    if (!latest) return false
    return latest === snapshot
  }

  private requestRender(): void {
    if (this.renderInFlight) {
      this.pendingRender = true
      return
    }
    this.postRender(this.latestSnapshot)
  }

  private postRender(snapshot: EditorViewSnapshot): void {
    this.pendingRender = false
    let renderToken = 0
    const handle = this.scheduler.schedule({
      key: MINIMAP_RENDER_KEY,
      taskClass: 'visible-render',
      priority: 'high',
      defer: true,
      tags: {
        configuration: 'render',
        snapshotVersion: snapshot.textVersion,
        viewport: snapshot.viewport.visibleRange.start,
      },
      run: (context) => this.postScheduledRender(snapshot, context.token),
      cancel: () => this.cancelScheduledRender(renderToken),
    })

    renderToken = handle.token
    this.activeRenderToken = handle.token
    this.renderInFlight = true
  }

  private postScheduledRender(snapshot: EditorViewSnapshot, token: number): void {
    if (token !== this.activeRenderToken) return

    this.pendingRender = false
    this.sizeCanvasElements(snapshot)
    this.post({ type: 'render', sequence: token })
  }

  private cancelScheduledRender(token: number): void {
    if (token !== this.activeRenderToken) return

    this.activeRenderToken = 0
    this.renderInFlight = false
  }

  private applyImmediateViewport(): void {
    const frame = this.frameLayout()
    setStyleValue(this.host.slider, 'display', frame.sliderNeeded ? 'block' : 'none')
    setStyleValue(this.host.slider, 'transform', `translate3d(0, ${frame.sliderTop}px, 0)`)
    setStyleValue(this.host.slider, 'height', `${frame.sliderHeight}px`)
    setStyleValue(this.host.sliderHorizontal, 'height', `${frame.sliderHeight}px`)
    setClassName(
      this.host.shadow,
      shadowVisible(this.latestViewport)
        ? 'editor-minimap-shadow editor-minimap-shadow-visible'
        : 'editor-minimap-shadow editor-minimap-shadow-hidden',
    )
  }

  private documentPayload(snapshot: EditorViewSnapshot): MinimapDocumentPayload {
    const projection = createEditorSecondaryViewProjection(snapshot)
    let payload: MinimapDocumentPayload | null = null
    return measureMinimapPerformance(
      'minimap.documentPayload',
      () => {
        payload = {
          ...documentSummaryPayload(projection.text, this.options.maxColumn),
          tokens: this.tokens(projection.syntaxColors.tokens),
          selections: selections(projection.selections),
          decorations: this.externalDecorations,
          externalDecorations: this.externalDecorations,
        }
        return payload
      },
      () => documentPayloadDiagnostics(payload),
    )
  }

  private documentEditPayload(
    update: PendingMinimapUpdate,
    workerDocument: WorkerDocumentState | null,
  ): MinimapDocumentEditPayload {
    const snapshot = update.snapshot
    const projection = createEditorSecondaryViewProjection(snapshot)
    let payload: MinimapDocumentEditPayload | null = null
    return measureMinimapPerformance(
      'minimap.documentEditPayload',
      () => {
        payload = {
          selections: selections(projection.selections),
          summaryPatch: documentSummaryPatchPayload(
            projection.text,
            previousDocumentSummary(update),
            update.edits,
            this.options.maxColumn,
            workerDocument,
          ),
        }
        return payload
      },
      () => documentEditPayloadDiagnostics(payload),
    )
  }

  private tokens(tokens: EditorTokenStore, from = 0, to = tokens.length): readonly MinimapToken[] {
    return measureMinimapPerformance(
      'minimap.tokens',
      () => {
        const foreground = this.latestBaseStyles?.foreground ?? this.baseStyles().foreground
        // One colour per palette entry, not per token.
        const colors = tokens.styles.map((style) =>
          this.colorResolver.resolve(style.color, foreground),
        )
        const projected: MinimapToken[] = []
        tokens.forEachInRange(from, to, (start, end, styleId) => {
          projected.push({ start, end, color: colors[styleId]! })
        })
        return projected
      },
      () => ({ inputTokens: tokens.length, outputTokens: Math.max(0, to - from) }),
    )
  }

  private metrics(snapshot: EditorViewSnapshot): MinimapMetrics {
    return {
      rowHeight: snapshot.metrics.rowHeight,
      characterWidth: snapshot.metrics.characterWidth,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
    }
  }

  private viewport(snapshot: EditorViewSnapshot): MinimapViewport {
    const snapshotViewport = this.latestViewport
    const fallbackClientHeight =
      snapshotViewport.clientHeight > 0 ? 0 : this.host.colorScope.clientHeight
    const fallbackClientWidth =
      snapshotViewport.clientWidth > 0
        ? 0
        : Math.max(0, this.host.colorScope.clientWidth - this.reservedLane())
    const clientHeight = positiveOrFallback(snapshotViewport.clientHeight, fallbackClientHeight)
    const clientWidth = positiveOrFallback(snapshotViewport.clientWidth, fallbackClientWidth)
    const fallbackScrollHeight =
      snapshotViewport.scrollHeight > 0 ? 0 : this.host.colorScope.scrollHeight
    const fallbackScrollWidth =
      snapshotViewport.scrollWidth > 0 ? 0 : this.host.colorScope.scrollWidth

    const range = visibleDocumentLineRange(snapshot, snapshotViewport)
    return {
      scrollTop: snapshotViewport.scrollTop,
      scrollRow: snapshotViewport.scrollRow,
      scrollLeft: snapshotViewport.scrollLeft,
      scrollHeight: Math.max(snapshotViewport.scrollHeight, fallbackScrollHeight, clientHeight),
      scrollWidth: Math.max(snapshotViewport.scrollWidth, fallbackScrollWidth, clientWidth),
      clientHeight,
      clientWidth,
      minimapHeight: this.minimapHeight(snapshot),
      reservedWidth: Math.max(0, this.reservedLane()),
      visibleStart: range.start,
      visibleEnd: range.end,
    }
  }

  private minimapHeight(snapshot: EditorViewSnapshot): number {
    const height = Number.parseFloat(this.host.root.style.height)
    if (Number.isFinite(height)) return Math.max(0, height)
    if (snapshot.viewport.clientHeight > 0) return snapshot.viewport.clientHeight
    return this.host.colorScope.clientHeight
  }

  private baseStyles(): MinimapBaseStyles {
    const style = getComputedStyle(this.host.colorScope)
    const foreground = this.colorResolver.resolve(style.color, RGBA_WHITE)
    const background = this.colorResolver.resolve(style.backgroundColor, RGBA_BLACK)

    return {
      foreground,
      background,
      minimapBackground: transparent(
        this.colorResolver.resolve(
          style.getPropertyValue('--editor-minimap-background'),
          background,
        ),
        minimapBackgroundOpacity(style),
      ),
      foregroundOpacity: 255,
      selection: this.colorResolver.resolve(
        style.getPropertyValue('--editor-minimap-selection-highlight'),
        { r: 56, g: 189, b: 248, a: 128 },
      ),
      slider:
        style.getPropertyValue('--editor-minimap-slider-background') || 'rgba(121,121,121,.2)',
      sliderHover:
        style.getPropertyValue('--editor-minimap-slider-hover-background') ||
        'rgba(121,121,121,.35)',
      sliderActive:
        style.getPropertyValue('--editor-minimap-slider-active-background') ||
        'rgba(121,121,121,.5)',
      fontFamily: style.fontFamily || 'monospace',
    }
  }

  private sizeCanvasElements(snapshot: EditorViewSnapshot): void {
    const height = `${this.minimapHeight(snapshot)}px`
    setStyleValue(this.host.mainCanvas, 'height', height)
    setStyleValue(this.host.decorationsCanvas, 'height', height)
  }

  private handleWorkerMessage = (response: MinimapWorkerResponse): void => {
    if (this.disposed) return

    if (response.type === 'layout') {
      this.applyLayout(
        response.layout.width,
        response.layout.canvasOuterWidth,
        response.layout.canvasOuterHeight,
      )
      return
    }
    if (response.type === 'rendered') {
      if (!this.isCurrentRenderResponse(response)) return

      this.scheduler.cancel(MINIMAP_RENDER_KEY)
      this.renderInFlight = false
      this.activeRenderToken = 0
      if (this.pendingUpdate) this.scheduleFlush()
      if (this.renderInFlight) return
      if (this.pendingRender) this.requestRender()

      this.applyImmediateViewport()
      return
    }
  }

  private applyLayout(width: number, canvasWidth: number, canvasHeight: number): void {
    this.onLayoutWidth(width)
    setStyleValue(this.host.mainCanvas, 'width', `${canvasWidth}px`)
    setStyleValue(this.host.decorationsCanvas, 'width', `${canvasWidth}px`)
    setStyleValue(this.host.sliderHorizontal, 'width', `${canvasWidth}px`)
    setStyleValue(this.host.mainCanvas, 'height', `${canvasHeight}px`)
    setStyleValue(this.host.decorationsCanvas, 'height', `${canvasHeight}px`)
  }

  private handleWorkerError = (error: Error): void => {
    console.warn(error.toString(), error)
  }

  private post(request: MinimapWorkerRequest, transfer?: Transferable[]): void {
    measureMinimapPerformance(
      'minimap.post',
      () => {
        this.workerOwner.post(request, transfer)
      },
      () => requestDiagnostics(request),
    )
  }

  private cancelScheduledFlush(): void {
    this.cancelScheduledFrame()
    this.cancelDeferredFlush()
  }

  private cancelScheduledFrame(): void {
    this.scheduler.cancel(MINIMAP_FRAME_FLUSH_KEY)
  }

  private cancelDeferredFlush(): void {
    this.scheduler.cancel(MINIMAP_QUIET_FLUSH_KEY)
  }

  private isCurrentRenderResponse(
    response: Extract<MinimapWorkerResponse, { type: 'rendered' }>,
  ): boolean {
    return response.sequence === this.activeRenderToken
  }
}

type PendingMinimapUpdate = {
  readonly snapshot: EditorViewSnapshot
  readonly replaceDocument: boolean
  readonly edits: readonly TextEdit[]
  readonly previousDocumentSummary: MinimapDocumentSummaryBaseline | null
  readonly syncTokens: boolean
  readonly syncSelection: boolean
  readonly syncExternalDecorations: boolean
  readonly syncViewport: boolean
  readonly syncBaseStyles: boolean
  readonly tokenSourceAfterEdits: EditorTokenStore | null
  readonly reason: string
}

type MinimapDocumentSummaryBaseline = {
  readonly textLength: number
  readonly lineStarts: MinimapLineStarts
}

export function canUseMinimapWorker(): boolean {
  if (typeof Worker === 'undefined') return false
  if (typeof OffscreenCanvas === 'undefined') return false
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype
  )
}

function workerRequestError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function createWorkerResponseError(
  response: Extract<MinimapWorkerResponse, { readonly type: 'error' }>,
): Error {
  const workerMessage = nonEmptyString(response.message)
  return createError({
    code: 'minimap.WORKER_REQUEST_FAILED',
    message: messageWithDetail('Minimap worker request failed', workerMessage),
    why: workerMessage ?? 'The minimap worker reported an error without details.',
    fix: 'The editor keeps running; inspect the minimap worker request and renderer state if the minimap stops updating.',
    internal: {
      responseType: response.type,
      sequence: response.sequence ?? null,
      workerMessage: response.message,
    },
  })
}

function createNativeWorkerError(event: ErrorEvent): Error {
  const browserMessage = nonEmptyString(event.message)
  return createError({
    code: 'minimap.WORKER_CRASHED',
    message: messageWithDetail('Minimap worker crashed', browserMessage),
    why: nativeWorkerFailureReason(browserMessage),
    fix: 'The editor keeps running without the minimap for this worker generation. Check the worker script request, CSP, MIME type, and browser worker support.',
    cause: event.error instanceof Error ? event.error : undefined,
    internal: workerErrorEventInternal(event),
  })
}

function nativeWorkerFailureReason(browserMessage: string | null): string {
  if (browserMessage) return `The browser reported: ${browserMessage}`
  return 'The browser reported a native worker failure without an error message. This usually means the worker script failed to load or crashed before its own error handler ran.'
}

function workerErrorEventInternal(event: ErrorEvent): Record<string, unknown> {
  const error = event.error
  return {
    browserMessage: nonEmptyString(event.message),
    filename: nonEmptyString(event.filename),
    lineNumber: positiveNumberOrNull(event.lineno),
    columnNumber: positiveNumberOrNull(event.colno),
    errorName: error instanceof Error ? error.name : null,
    errorMessage: errorMessage(error),
    errorStack: error instanceof Error ? error.stack : null,
    rawErrorType: rawErrorType(error),
  }
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return null
}

function rawErrorType(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (error instanceof Error) return error.name
  return Object.prototype.toString.call(error)
}

function messageWithDetail(summary: string, detail: string | null): string {
  if (!detail) return summary
  return `${summary}: ${detail}`
}

function nonEmptyString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length === 0) return null
  return trimmed
}

function positiveNumberOrNull(value: number): number | null {
  if (value > 0) return value
  return null
}

function workerDisposedError(): Error {
  return new Error('Minimap worker is disposed')
}

function selections(selections: readonly EditorResolvedSelection[]): readonly MinimapSelection[] {
  return selections.map((selection) => minimapSelection(selection))
}

function minimapSelection(selection: EditorResolvedSelection): MinimapSelection {
  return {
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
  }
}

// Structural match for EditorLineStartsView so plain arrays (tests, string
// fallback paths) and snapshot views share one access surface.
type MinimapLineStarts = {
  readonly length: number
  at(index: number): number | undefined
  indexForOffset(offset: number): number
  firstIndexAtOrAfter(offset: number): number
  toArray(): readonly number[]
}

function arrayLineStarts(lineStarts: readonly number[]): MinimapLineStarts {
  return {
    length: lineStarts.length,
    at: (index) => lineStarts[index],
    indexForOffset: (offset) => arrayLineIndexForOffset(lineStarts, offset),
    firstIndexAtOrAfter: (target) => arrayFirstLineStartAtOrAfter(lineStarts, target),
    toArray: () => lineStarts,
  }
}

function documentSummaryPayload(
  text: EditorSecondaryViewTextProjection,
  maxColumn: number,
): MinimapDocumentSummaryPayload {
  const textLength = text.length
  const lineStarts = text.lineStartsView.toArray()
  return {
    textLength,
    lineStarts,
    lines: lineStarts.map((startOffset, index) =>
      lineSummaryFromSnapshot(
        text,
        startOffset,
        lineEndOffset(arrayLineStarts(lineStarts), index, textLength),
        maxColumn,
      ),
    ),
  }
}

type WorkerDocumentState = { readonly textLength: number; readonly lineCount: number }

function documentSummaryPatchPayload(
  text: EditorSecondaryViewTextProjection,
  previous: MinimapDocumentSummaryBaseline,
  edits: readonly TextEdit[],
  maxColumn: number,
  workerDocument: WorkerDocumentState | null,
): MinimapDocumentSummaryPatch {
  const textLength = text.length
  const lineStarts = text.lineStartsView
  const range = documentSummaryPatchRange(previous, lineStarts, textLength, edits, workerDocument)
  const lines = []
  for (let lineIndex = range.startLine; lineIndex < range.insertEndLine; lineIndex += 1) {
    lines.push(
      lineSummaryFromSnapshot(
        text,
        lineStarts.at(lineIndex) ?? textLength,
        lineEndOffset(lineStarts, lineIndex, textLength),
        maxColumn,
      ),
    )
  }

  return {
    textLength,
    startLine: range.startLine,
    deleteCount: range.deleteCount,
    lines,
  }
}

function lineSummaryFromSnapshot(
  text: EditorSecondaryViewTextProjection,
  startOffset: number,
  endOffset: number,
  maxColumn: number,
): MinimapDocumentSummaryPayload['lines'][number] {
  const length = Math.max(0, endOffset - startOffset)
  const clippedEnd = startOffset + Math.min(length, maxColumn)
  return {
    text: text.snapshot.readRange(startOffset, clippedEnd),
    length,
  }
}

function lineEndOffset(lineStarts: MinimapLineStarts, index: number, textLength: number): number {
  const startOffset = lineStarts.at(index) ?? textLength
  const nextStart = lineStarts.at(index + 1)
  if (nextStart === undefined) return textLength
  return Math.max(startOffset, nextStart - 1)
}

type SummaryLineChangeRange = {
  readonly startLine: number
  readonly previousEndLine: number
  readonly nextEndLine: number
}

type DocumentSummaryPatchRange = {
  readonly startLine: number
  readonly deleteCount: number
  readonly insertEndLine: number
}

function documentSummaryPatchRange(
  previous: MinimapDocumentSummaryBaseline,
  nextLineStarts: MinimapLineStarts,
  nextTextLength: number,
  edits: readonly TextEdit[],
  workerDocument: WorkerDocumentState | null,
): DocumentSummaryPatchRange {
  const edited = editSummaryPatchRange(previous.lineStarts, nextLineStarts, edits)
  // When line-break-free edits fully account for the worker document's
  // length transition and the line count is unchanged, every boundary change
  // lies inside the edited range and the O(lines) structural verification
  // can be skipped. Newline edits and projection changes (e.g. fold toggles)
  // fall through to the full scan.
  if (
    edited &&
    workerDocument &&
    editsExplainTransition(workerDocument, nextLineStarts, nextTextLength, edits)
  ) {
    return normalizeSummaryPatchRange(edited, previous.lineStarts.length, nextLineStarts.length)
  }

  const structural = lineStartSummaryPatchRange(
    previous.lineStarts,
    previous.textLength,
    nextLineStarts,
    nextTextLength,
  )
  const changed = mergeSummaryPatchRanges(structural, edited)
  if (!changed) return { startLine: 0, deleteCount: 0, insertEndLine: 0 }

  return normalizeSummaryPatchRange(changed, previous.lineStarts.length, nextLineStarts.length)
}

function editsExplainTransition(
  workerDocument: WorkerDocumentState,
  nextLineStarts: MinimapLineStarts,
  nextTextLength: number,
  edits: readonly TextEdit[],
): boolean {
  if (nextLineStarts.length !== workerDocument.lineCount) return false

  let textDelta = 0
  for (const edit of edits) {
    // With no inserted breaks and an unchanged line count, no breaks were
    // removed either; the math below is exact, not heuristic.
    if (edit.text.includes('\n')) return false
    textDelta += edit.text.length - (Math.max(edit.from, edit.to) - Math.min(edit.from, edit.to))
  }

  return workerDocument.textLength + textDelta === nextTextLength
}

function arrayFirstLineStartAtOrAfter(lineStarts: readonly number[], target: number): number {
  let low = 0
  let high = lineStarts.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (lineStarts[middle]! < target) low = middle + 1
    else high = middle
  }
  return low
}

function lineStartSummaryPatchRange(
  previousLineStarts: MinimapLineStarts,
  previousTextLength: number,
  nextLineStarts: MinimapLineStarts,
  nextTextLength: number,
): SummaryLineChangeRange | null {
  const prefix = commonLineSummaryPrefix(
    previousLineStarts,
    previousTextLength,
    nextLineStarts,
    nextTextLength,
  )
  const suffix = commonLineSummarySuffix(
    previousLineStarts,
    previousTextLength,
    nextLineStarts,
    nextTextLength,
    prefix,
  )
  if (prefix + suffix >= previousLineStarts.length && prefix + suffix >= nextLineStarts.length) {
    return null
  }

  return {
    startLine: prefix,
    previousEndLine: previousLineStarts.length - suffix,
    nextEndLine: nextLineStarts.length - suffix,
  }
}

function commonLineSummaryPrefix(
  previousLineStarts: MinimapLineStarts,
  previousTextLength: number,
  nextLineStarts: MinimapLineStarts,
  nextTextLength: number,
): number {
  let count = 0
  const limit = Math.min(previousLineStarts.length, nextLineStarts.length)
  while (
    count < limit &&
    lineSummaryBoundariesMatch(
      previousLineStarts,
      previousTextLength,
      count,
      nextLineStarts,
      nextTextLength,
      count,
      0,
    )
  ) {
    count += 1
  }

  return count
}

function commonLineSummarySuffix(
  previousLineStarts: MinimapLineStarts,
  previousTextLength: number,
  nextLineStarts: MinimapLineStarts,
  nextTextLength: number,
  prefix: number,
): number {
  let count = 0
  const delta = nextTextLength - previousTextLength
  const previousLimit = previousLineStarts.length - prefix
  const nextLimit = nextLineStarts.length - prefix

  while (count < previousLimit && count < nextLimit) {
    const previousIndex = previousLineStarts.length - count - 1
    const nextIndex = nextLineStarts.length - count - 1
    if (
      !lineSummaryBoundariesMatch(
        previousLineStarts,
        previousTextLength,
        previousIndex,
        nextLineStarts,
        nextTextLength,
        nextIndex,
        delta,
      )
    ) {
      return count
    }
    count += 1
  }

  return count
}

function lineSummaryBoundariesMatch(
  previousLineStarts: MinimapLineStarts,
  previousTextLength: number,
  previousIndex: number,
  nextLineStarts: MinimapLineStarts,
  nextTextLength: number,
  nextIndex: number,
  offsetDelta: number,
): boolean {
  const previousStart = previousLineStarts.at(previousIndex) ?? previousTextLength
  const nextStart = nextLineStarts.at(nextIndex) ?? nextTextLength
  if (previousStart + offsetDelta !== nextStart) return false

  return (
    lineEndOffset(previousLineStarts, previousIndex, previousTextLength) + offsetDelta ===
    lineEndOffset(nextLineStarts, nextIndex, nextTextLength)
  )
}

function editSummaryPatchRange(
  previousLineStarts: MinimapLineStarts,
  nextLineStarts: MinimapLineStarts,
  edits: readonly TextEdit[],
): SummaryLineChangeRange | null {
  let startLine = Number.POSITIVE_INFINITY
  let previousEndLine = 0
  let nextEndLine = 0

  for (const edit of edits) {
    if (editIsEmpty(edit)) continue
    const previousRange = previousLineRangeForEdit(previousLineStarts, nextLineStarts, edit)
    const nextRange = lineRangeForEdit(nextLineStarts, edit.from, edit.from + edit.text.length)
    startLine = Math.min(startLine, previousRange.startLine, nextRange.startLine)
    previousEndLine = Math.max(previousEndLine, previousRange.endLine)
    nextEndLine = Math.max(nextEndLine, nextRange.endLine)
  }

  if (startLine === Number.POSITIVE_INFINITY) return null
  return { startLine, previousEndLine, nextEndLine }
}

function editIsEmpty(edit: TextEdit): boolean {
  return edit.from === edit.to && edit.text.length === 0
}

function previousLineRangeForEdit(
  previousLineStarts: MinimapLineStarts,
  nextLineStarts: MinimapLineStarts,
  edit: TextEdit,
): { readonly startLine: number; readonly endLine: number } {
  if (edit.from !== edit.to || edit.text.includes('\n')) {
    return lineRangeForEdit(previousLineStarts, edit.from, edit.to)
  }

  const line = nextLineStarts.indexForOffset(edit.from)
  return { startLine: line, endLine: line + 1 }
}

function lineRangeForEdit(
  lineStarts: MinimapLineStarts,
  from: number,
  to: number,
): { readonly startLine: number; readonly endLine: number } {
  const startOffset = Math.min(from, to)
  const endOffset = Math.max(from, to)
  const startLine = lineStarts.indexForOffset(startOffset)
  const endLine = lineStarts.indexForOffset(endOffset) + 1
  return { startLine, endLine }
}

function mergeSummaryPatchRanges(
  left: SummaryLineChangeRange | null,
  right: SummaryLineChangeRange | null,
): SummaryLineChangeRange | null {
  if (!left) return right
  if (!right) return left

  return {
    startLine: Math.min(left.startLine, right.startLine),
    previousEndLine: Math.max(left.previousEndLine, right.previousEndLine),
    nextEndLine: Math.max(left.nextEndLine, right.nextEndLine),
  }
}

function normalizeSummaryPatchRange(
  range: SummaryLineChangeRange,
  previousLineCount: number,
  nextLineCount: number,
): DocumentSummaryPatchRange {
  const startLine = Math.min(
    Math.max(0, range.startLine),
    Math.max(previousLineCount, nextLineCount),
  )
  const previousEndLine = Math.min(Math.max(startLine, range.previousEndLine), previousLineCount)
  const nextEndLine = Math.min(Math.max(startLine, range.nextEndLine), nextLineCount)
  return {
    startLine,
    deleteCount: previousEndLine - startLine,
    insertEndLine: nextEndLine,
  }
}

function incrementalTextEdits(
  change: EditorContributionChange | null | undefined,
): readonly TextEdit[] | null {
  if (!change || change.edits.length === 0) return null

  const sorted = change.edits.toSorted(compareTextEdits)
  return sequentialTextEdits(sorted)
}

function sameViewport(previous: MinimapViewport | null, next: MinimapViewport): boolean {
  if (!previous) return false
  return (
    previous.scrollTop === next.scrollTop &&
    previous.scrollRow === next.scrollRow &&
    previous.scrollLeft === next.scrollLeft &&
    previous.scrollHeight === next.scrollHeight &&
    previous.scrollWidth === next.scrollWidth &&
    previous.clientHeight === next.clientHeight &&
    previous.clientWidth === next.clientWidth &&
    previous.minimapHeight === next.minimapHeight &&
    previous.reservedWidth === next.reservedWidth &&
    previous.visibleStart === next.visibleStart &&
    previous.visibleEnd === next.visibleEnd
  )
}

function shadowVisible(viewport: EditorViewportSnapshot): boolean {
  return viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth
}

function positiveOrFallback(value: number, fallback: number): number {
  if (value > 0) return value
  return Math.max(0, fallback)
}

function baseStylesSignature(styles: MinimapBaseStyles): string {
  return JSON.stringify(styles)
}

function layoutSignature(snapshot: EditorViewSnapshot, minimapHeight: number): string {
  return [
    snapshot.metrics.rowHeight,
    snapshot.metrics.characterWidth,
    globalThis.devicePixelRatio || 1,
    snapshot.viewport.clientHeight,
    snapshot.viewport.clientWidth,
    minimapHeight,
    snapshot.lineCount,
  ].join(':')
}

function createPendingUpdate(
  snapshot: EditorViewSnapshot,
  kind: string,
  change: EditorContributionChange | null | undefined,
  previousSnapshot: EditorViewSnapshot,
): PendingMinimapUpdate {
  const base = basePendingUpdate(snapshot, kind)
  if (kind === 'content') return contentPendingUpdate(base, change, previousSnapshot)
  if (kind === 'document' || kind === 'clear') {
    return { ...base, replaceDocument: true, reason: kind }
  }
  if (kind === 'tokens') return { ...base, syncTokens: true, reason: 'tokens' }
  if (kind === 'selection') return { ...base, syncSelection: true, reason: 'selection' }
  if (kind === 'decorations') {
    return { ...base, syncExternalDecorations: true, reason: 'decorations' }
  }

  return { ...base, reason: kind }
}

function mergePendingUpdate(
  current: PendingMinimapUpdate | null,
  next: PendingMinimapUpdate,
): PendingMinimapUpdate {
  if (!current) return next
  if (current.replaceDocument || next.replaceDocument) return mergeReplacementUpdate(current, next)

  const edits = current.edits.concat(next.edits)
  const contentChangedAfterTokens = next.edits.length > 0
  return {
    snapshot: next.snapshot,
    replaceDocument: false,
    edits,
    previousDocumentSummary: current.previousDocumentSummary ?? next.previousDocumentSummary,
    syncTokens: contentChangedAfterTokens ? next.syncTokens : current.syncTokens || next.syncTokens,
    syncSelection: current.syncSelection || next.syncSelection,
    syncExternalDecorations: current.syncExternalDecorations || next.syncExternalDecorations,
    syncViewport: current.syncViewport || next.syncViewport,
    syncBaseStyles: current.syncBaseStyles || next.syncBaseStyles,
    tokenSourceAfterEdits: mergedTokenSourceAfterEdits(current, next),
    reason: mergeReasons(current.reason, next.reason),
  }
}

function mergeReplacementUpdate(
  current: PendingMinimapUpdate,
  next: PendingMinimapUpdate,
): PendingMinimapUpdate {
  return {
    snapshot: next.snapshot,
    replaceDocument: true,
    edits: [],
    previousDocumentSummary: null,
    syncTokens: false,
    syncSelection: false,
    syncExternalDecorations: false,
    syncViewport: current.syncViewport || next.syncViewport,
    syncBaseStyles: current.syncBaseStyles || next.syncBaseStyles,
    tokenSourceAfterEdits: null,
    reason: mergeReasons(current.reason, next.reason),
  }
}

function mergedTokenSourceAfterEdits(
  current: PendingMinimapUpdate,
  next: PendingMinimapUpdate,
): EditorTokenStore | null {
  if (next.edits.length === 0) return current.tokenSourceAfterEdits
  if (current.syncTokens) return null
  return next.tokenSourceAfterEdits
}

function shouldSyncBaseStyles(kind: string): boolean {
  if (kind === 'tokens') return true
  if (kind === 'document') return true
  return kind === 'clear'
}

function basePendingUpdate(snapshot: EditorViewSnapshot, kind: string): PendingMinimapUpdate {
  return {
    snapshot,
    replaceDocument: false,
    edits: [],
    previousDocumentSummary: null,
    syncTokens: false,
    syncSelection: false,
    syncExternalDecorations: false,
    syncViewport: shouldSyncViewport(kind),
    syncBaseStyles: shouldSyncBaseStyles(kind),
    tokenSourceAfterEdits: null,
    reason: 'metadata',
  }
}

function contentPendingUpdate(
  base: PendingMinimapUpdate,
  change: EditorContributionChange | null | undefined,
  previousSnapshot: EditorViewSnapshot,
): PendingMinimapUpdate {
  const edits = incrementalTextEdits(change)
  if (!edits) {
    return { ...base, replaceDocument: true, reason: 'content.replaceDocument' }
  }

  return {
    ...base,
    edits,
    previousDocumentSummary: snapshotSummaryBaseline(previousSnapshot),
    syncSelection: true,
    tokenSourceAfterEdits: tokenSourceAfterEdits(change, previousSnapshot, base.snapshot),
    reason: edits.length === 1 ? 'content.edit' : 'content.edits',
  }
}

function previousDocumentSummary(update: PendingMinimapUpdate): MinimapDocumentSummaryBaseline {
  return update.previousDocumentSummary ?? snapshotSummaryBaseline(update.snapshot)
}

function snapshotSummaryBaseline(snapshot: EditorViewSnapshot): MinimapDocumentSummaryBaseline {
  return {
    textLength: snapshot.textSnapshot.length,
    lineStarts: snapshot.lineStartsView,
  }
}

function shouldSyncViewport(kind: string): boolean {
  if (kind === 'content') return true
  if (kind === 'document') return true
  if (kind === 'clear') return true
  if (kind === 'viewport') return true
  return kind === 'layout'
}

function shouldDeferMinimapUpdate(update: PendingMinimapUpdate): boolean {
  if (update.reason.includes('content')) return true
  if (update.syncTokens) return true
  return update.syncExternalDecorations
}

function sequentialTextEdits(edits: readonly TextEdit[]): readonly TextEdit[] {
  let delta = 0
  return edits.map((edit) => {
    const from = edit.from + delta
    const to = edit.to + delta
    delta += edit.text.length - (edit.to - edit.from)
    return { from, to, text: edit.text }
  })
}

function compareTextEdits(left: TextEdit, right: TextEdit): number {
  return left.from - right.from || left.to - right.to
}

function tokenSourceAfterEdits(
  change: EditorContributionChange | null | undefined,
  previousSnapshot: EditorViewSnapshot,
  nextSnapshot: EditorViewSnapshot,
): EditorTokenStore | null {
  if (!change) return null
  if (!editsPreserveLineStructure(change.edits, previousSnapshot.lineStartsView)) return null
  return nextSnapshot.tokens
}

function editsPreserveLineStructure(
  edits: readonly TextEdit[],
  lineStarts: MinimapLineStarts,
): boolean {
  for (const edit of edits) {
    if (edit.text.includes('\n')) return false
    if (!editRangeIsSingleLine(lineStarts, edit)) return false
  }

  return true
}

function editRangeIsSingleLine(lineStarts: MinimapLineStarts, edit: TextEdit): boolean {
  return lineStarts.indexForOffset(edit.from) === lineStarts.indexForOffset(edit.to)
}

function arrayLineIndexForOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  const clamped = Math.max(0, offset)

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const start = lineStarts[middle] ?? 0
    const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY
    if (clamped < start) {
      high = middle - 1
      continue
    }
    if (clamped >= next) {
      low = middle + 1
      continue
    }
    return middle
  }

  return Math.max(0, lineStarts.length - 1)
}

function mergeReasons(left: string, right: string): string {
  if (left === right) return left
  return `${left}+${right}`
}

type MinimapPerformanceDiagnostic = {
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

type MinimapPerformanceDiagnosticSink =
  | ((diagnostic: MinimapPerformanceDiagnostic) => void)
  | {
      readonly enabled?: boolean
      readonly record?: (diagnostic: MinimapPerformanceDiagnostic) => void
    }

type MinimapPerformanceDiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: MinimapPerformanceDiagnosticSink | null
}

type DiagnosticDetail =
  | Readonly<Record<string, unknown>>
  | (() => Readonly<Record<string, unknown>> | undefined)
  | undefined

function measureMinimapPerformance<T>(name: string, run: () => T, detail?: DiagnosticDetail): T {
  if (!minimapPerformanceDiagnosticsEnabled()) return run()

  const start = nowMs()
  try {
    return run()
  } finally {
    recordMinimapPerformanceDiagnostic(name, detail, nowMs() - start)
  }
}

function recordMinimapPerformanceDiagnostic(
  name: string,
  detail?: DiagnosticDetail,
  durationMs?: number,
): void {
  const sink = minimapPerformanceDiagnosticSink()
  if (!sink) return

  const diagnostic = createDiagnostic(name, detail, durationMs)
  if (typeof sink === 'function') {
    sink(diagnostic)
    return
  }

  sink.record?.(diagnostic)
}

function minimapPerformanceDiagnosticsEnabled(): boolean {
  const sink = minimapPerformanceDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return false
  if (typeof sink === 'function') return true
  return sink.enabled === true || typeof sink.record === 'function'
}

function minimapPerformanceDiagnosticSink(): MinimapPerformanceDiagnosticSink | null {
  const sink = minimapPerformanceDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return null
  if (typeof sink === 'function') return sink
  if (sink.enabled !== true && typeof sink.record !== 'function') return null
  return sink
}

function createDiagnostic(
  name: string,
  detail: DiagnosticDetail,
  durationMs: number | undefined,
): MinimapPerformanceDiagnostic {
  const resolvedDetail = resolveDiagnosticDetail(detail)
  if (durationMs === undefined && resolvedDetail === undefined) return { name }
  if (durationMs === undefined) return { name, detail: resolvedDetail }
  if (resolvedDetail === undefined) return { name, durationMs }
  return { name, durationMs, detail: resolvedDetail }
}

function resolveDiagnosticDetail(
  detail: DiagnosticDetail,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof detail === 'function') return detail()
  return detail
}

function minimapPerformanceDiagnosticGlobal(): MinimapPerformanceDiagnosticGlobal {
  return globalThis as MinimapPerformanceDiagnosticGlobal
}

function pendingUpdateDiagnostics(update: PendingMinimapUpdate): Readonly<Record<string, unknown>> {
  return {
    editCount: update.edits.length,
    incremental: !update.replaceDocument,
    reason: update.reason,
    syncBaseStyles: update.syncBaseStyles,
    syncExternalDecorations: update.syncExternalDecorations,
    syncSelection: update.syncSelection,
    syncTokens: update.syncTokens,
    syncViewport: update.syncViewport,
    tokenSourceKnown: update.tokenSourceAfterEdits !== null || update.edits.length === 0,
    type: update.replaceDocument ? 'replaceDocument' : 'incremental',
  }
}

function requestDiagnostics(request: MinimapWorkerRequest): Readonly<Record<string, unknown>> {
  switch (request.type) {
    case 'openDocument':
    case 'replaceDocument':
      return { request: request.type, ...documentPayloadDiagnostics(request.document) }
    case 'applyEdit':
      return {
        request: request.type,
        editTextLength: request.edit.text.length,
        ...documentEditPayloadDiagnostics(request.document),
      }
    case 'applyEdits':
      return {
        request: request.type,
        editCount: request.edits.length,
        editTextLength: textLengthForEdits(request.edits),
        ...documentEditPayloadDiagnostics(request.document),
      }
    case 'updateTokens':
      return { request: request.type, tokens: request.tokens.length }
    case 'updateTokenRange':
      return {
        request: request.type,
        deleteCount: request.patch.deleteCount,
        start: request.patch.start,
        tokens: request.patch.tokens.length,
      }
    case 'updateSelection':
      return { request: request.type, selections: request.selections.length }
    case 'updateDecorations':
    case 'updateExternalDecorations':
      return { request: request.type, decorations: request.decorations.length }
    default:
      return { request: 'control' }
  }
}

function documentPayloadDiagnostics(
  payload: MinimapDocumentPayload | null,
): Readonly<Record<string, unknown>> {
  return {
    decorations: payload?.decorations.length ?? 0,
    externalDecorations: payload?.externalDecorations?.length ?? 0,
    lineSummaryTextLength: lineSummaryTextLength(payload?.lines ?? []),
    lineStarts: payload?.lineStarts.length ?? 0,
    lines: payload?.lines.length ?? 0,
    selections: payload?.selections.length ?? 0,
    textLength: payload?.textLength ?? 0,
    tokens: payload?.tokens.length ?? 0,
    type: 'document',
  }
}

function documentEditPayloadDiagnostics(
  payload: MinimapDocumentEditPayload | null,
): Readonly<Record<string, unknown>> {
  const patch = payload?.summaryPatch
  return {
    deleteCount: patch?.deleteCount ?? 0,
    lineSummaryTextLength: lineSummaryTextLength(patch?.lines ?? []),
    lineStarts: patch?.lineStarts?.length ?? 0,
    lines: patch?.lines.length ?? 0,
    selections: payload?.selections.length ?? 0,
    startLine: patch?.startLine ?? 0,
    textLength: patch?.textLength ?? 0,
    type: 'edit',
  }
}

function lineSummaryTextLength(lines: readonly { readonly text: string }[]): number {
  let length = 0
  for (const line of lines) length += line.text.length
  return length
}

function textLengthForEdits(edits: readonly TextEdit[]): number {
  let length = 0
  for (const edit of edits) length += edit.text.length
  return length
}

function setStyleValue(
  element: HTMLElement,
  property: 'display' | 'height' | 'transform' | 'width',
  value: string,
): void {
  if (element.style[property] === value) return

  element.style[property] = value
}

function setClassName(element: HTMLElement, className: string): void {
  if (element.className === className) return

  element.className = className
}

function minimapBackgroundOpacity(style: CSSStyleDeclaration): number {
  const value = Number.parseFloat(style.getPropertyValue('--editor-minimap-background-opacity'))
  if (!Number.isFinite(value)) return 1

  return Math.min(1, Math.max(0, value))
}

function themeSignature(snapshot: EditorViewSnapshot): string {
  return JSON.stringify(snapshot.theme ?? null)
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

class ColorResolver {
  private readonly probe: HTMLSpanElement
  private readonly canvasContext: CanvasRenderingContext2D | null
  private readonly cache = new Map<string, RGBA8>()

  public constructor(root: HTMLElement) {
    this.probe = root.ownerDocument.createElement('span')
    this.canvasContext = root.ownerDocument.createElement('canvas').getContext('2d', {
      willReadFrequently: true,
    })
    this.probe.style.position = 'absolute'
    this.probe.style.visibility = 'hidden'
    this.probe.textContent = '.'
    root.appendChild(this.probe)
  }

  public resolve(value: string | undefined, fallback: RGBA8): RGBA8 {
    if (!value) return fallback
    const cached = this.cache.get(value)
    if (cached) return cached

    this.probe.style.color = value
    const resolved = this.resolveComputedColor(getComputedStyle(this.probe).color, fallback)
    this.cache.set(value, resolved)
    return resolved
  }

  public clear(): void {
    this.cache.clear()
  }

  public dispose(): void {
    this.clear()
    this.probe.remove()
  }

  private resolveComputedColor(value: string, fallback: RGBA8): RGBA8 {
    const canvasColor = this.canvasColor(value)
    if (canvasColor) return canvasColor

    return parseCssColor(value, fallback)
  }

  private canvasColor(value: string): RGBA8 | null {
    const context = this.canvasContext
    if (!context) return null

    context.clearRect(0, 0, 1, 1)
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)

    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 0 }
  }
}
