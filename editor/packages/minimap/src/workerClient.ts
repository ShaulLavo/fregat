import { computeFrameLayout, computeRenderLayout, visibleDocumentLineRange } from './layout'
import { retainMinimapDocumentSource, type MinimapSourceResult } from './documentSource'
import type { EditorDocumentContributions } from '@singapore-editor/core/editor'
import type { DocumentProjectionReceipt } from '@singapore-editor/core/internal/document-worker'
import { sourceIdentitiesEqual, sourcePointsEqual } from './sourceIdentity'
import type { EditorTokenStore } from '@singapore-editor/core/syntax'
import type { MinimapWorkerOwnerSnapshot } from './workerOwner'
import type {
  EditorMinimapDecoration,
  EditorResolvedSelection,
  EditorViewportSnapshot,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { EditorSecondaryViewScheduler } from '@singapore-editor/core/secondary-views'
import { parseCssColor, RGBA_BLACK, RGBA_WHITE, transparent } from './color'
import type {
  MinimapBaseStyles,
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
  mainCanvas: HTMLCanvasElement
  decorationsCanvas: HTMLCanvasElement
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
  readonly contributions: EditorDocumentContributions | null
}

export class MinimapWorkerClient {
  private readonly host: MinimapHost
  private readonly options: ResolvedMinimapOptions
  private contributions: EditorDocumentContributions | null = null
  private documentSource: ReturnType<typeof retainMinimapDocumentSource> = null
  private sourceResult: MinimapSourceResult | null = null
  private sourceWait = false
  private canvasesTransferred = false
  private lastWorker: MinimapWorkerOwnerSnapshot = {
    lifecycle: 'disposed',
    postedRequests: 0,
    lastError: null,
  }
  private readonly colorResolver: ColorResolver
  private readonly scheduler = new EditorSecondaryViewScheduler()
  private readonly onLayoutWidth: (width: number) => void
  private readonly reservedLane: () => number
  private externalDecorations: readonly EditorMinimapDecoration[]
  private pendingUpdate: PendingMinimapUpdate | null = null
  private pendingUpdateReady = false
  private pendingRender = false
  private activeRenderToken = 0
  private activeRenderSource: DocumentProjectionReceipt | null = null
  private renderInFlight = false
  private latestBaseStyles: MinimapBaseStyles | null = null
  private latestBaseStylesSignature = ''
  private latestLayoutSignature = ''
  private latestThemeSignature = ''
  private latestSnapshot: EditorViewSnapshot
  private latestViewport: EditorViewportSnapshot
  private postedViewport: MinimapViewport | null = null
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
    this.setDocumentContributions(options.contributions, options.snapshot)
  }

  public inspectWorker(): MinimapWorkerOwnerSnapshot {
    return this.documentSource?.source.inspect() ?? this.lastWorker
  }

  public setDocumentContributions(
    contributions: EditorDocumentContributions | null,
    snapshot: EditorViewSnapshot,
  ): void {
    if (this.disposed || this.contributions === contributions) return
    this.releaseDocumentSource()
    this.contributions = contributions
    this.latestSnapshot = snapshot
    this.replaceTransferredCanvases()
    if (!contributions) return
    this.documentSource = retainMinimapDocumentSource(contributions, {
      maxColumn: this.options.maxColumn,
      onError: this.handleWorkerError,
      onMessage: this.handleWorkerMessage,
    })
    if (!this.documentSource) return
    this.init(snapshot)
  }

  public update(snapshot: EditorViewSnapshot, kind: string): void {
    if (this.disposed) return
    this.latestSnapshot = snapshot
    if (kind === 'viewport') {
      this.latestViewport = snapshot.viewport
      const layoutUpdated = this.postLayoutIfNeeded(snapshot)
      this.updateViewport(snapshot.viewport)
      if (layoutUpdated) this.requestRender()
      return
    }

    const update = createPendingUpdate(snapshot, kind)
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
    this.queueUpdate(createPendingUpdate(this.latestSnapshot, 'decorations'))
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.cancelScheduledFlush()
    this.scheduler.dispose()
    this.releaseDocumentSource()
    this.colorResolver.dispose()
  }

  private releaseDocumentSource(): void {
    const binding = this.documentSource
    binding?.lease.dispose()
    if (binding) this.lastWorker = binding.source.inspect()
    this.documentSource = null
    this.sourceResult = null
    this.sourceWait = false
    this.pendingUpdate = null
    this.pendingUpdateReady = false
    this.pendingRender = false
    this.renderInFlight = false
    this.activeRenderToken = 0
    this.activeRenderSource = null
    this.latestTokenSource = null
    this.cancelScheduledFlush()
    this.scheduler.cancel(MINIMAP_RENDER_KEY)
  }

  private replaceTransferredCanvases(): void {
    if (!this.canvasesTransferred) return
    this.host.mainCanvas = replaceCanvas(this.host.mainCanvas)
    this.host.decorationsCanvas = replaceCanvas(this.host.decorationsCanvas)
    this.canvasesTransferred = false
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
    this.postedViewport = this.viewport(snapshot)
    this.post({
      type: 'updateLayout',
      metrics: this.metrics(snapshot),
      viewport: this.postedViewport,
    })
    this.latestLayoutSignature = layoutSignature(snapshot, this.minimapHeight(snapshot))
    this.canvasesTransferred = true
    this.queueUpdate(createPendingUpdate(snapshot, 'document'))
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
      defer: true,
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
    if (this.renderInFlight || this.sourceWait) return

    const pending = this.pendingUpdate
    if (!pending) return

    measureMinimapPerformance(
      'minimap.flushPendingUpdate',
      () => this.flushPendingUpdateNow(pending),
      () => pendingUpdateDiagnostics(pending),
    )
  }

  private async flushPendingUpdateNow(pending: PendingMinimapUpdate): Promise<void> {
    const binding = this.documentSource
    this.pendingUpdate = null
    this.pendingUpdateReady = false
    this.sourceWait = true
    try {
      const result = await this.sourceFor(pending.snapshot)
      if (!result) return
      this.postUpdate(pending, result)
      const layoutUpdated = this.postLayoutIfNeeded(pending.snapshot)
      this.postViewportIfNeeded(pending.snapshot, pending.syncViewport, layoutUpdated)
      this.postRender(pending.snapshot)
    } catch (error) {
      this.reportSourceFailure(error)
    } finally {
      if (this.documentSource === binding) this.sourceWait = false
      if (this.pendingUpdate && !this.renderInFlight) this.scheduleFlush()
    }
  }

  private async sourceFor(snapshot: EditorViewSnapshot): Promise<MinimapSourceResult | null> {
    if (
      snapshot.geometryCommitted === false ||
      snapshot.viewport.clientWidth <= 0 ||
      snapshot.viewport.clientHeight <= 0
    )
      return null
    const binding = this.documentSource
    if (!binding) return null
    const result = await binding.lease.request()
    if (this.disposed || this.documentSource !== binding) return null
    if (!result) return null
    const expected = snapshot.documentSyncPoint
    if (
      result.point.segment !== expected.segment ||
      result.point.revision !== expected.revision ||
      result.point.textVersion !== expected.textVersion
    )
      return null
    return result
  }

  private reportSourceFailure(error: unknown): void {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (error instanceof Error) this.handleWorkerError(error)
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

  private postUpdate(update: PendingMinimapUpdate, result: MinimapSourceResult): void {
    const snapshot = update.snapshot
    let colorsInvalidated = false
    if (update.syncBaseStyles) {
      colorsInvalidated = this.refreshThemeColorCache(snapshot)
      colorsInvalidated = this.syncBaseStyles() || colorsInvalidated
    }
    const sourceAdvanced = this.sourceResult?.receipt !== result.receipt
    if (sourceAdvanced) {
      if (
        result.tokensRebased &&
        this.latestTokenSource &&
        !update.syncTokens &&
        !colorsInvalidated
      ) {
        this.latestTokenSource = snapshot.tokens
      } else {
        this.postFullTokenUpdate(snapshot)
      }
    } else if (update.syncTokens) {
      this.postTokenUpdate(snapshot, colorsInvalidated)
    }
    this.sourceResult = result
    if (sourceAdvanced || update.syncSelection) {
      this.post({ type: 'updateSelection', selections: selections(snapshot.selections) })
    }
    if (sourceAdvanced || update.syncExternalDecorations) {
      this.post({ type: 'updateExternalDecorations', decorations: this.externalDecorations })
    }
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

  private async postScheduledRender(snapshot: EditorViewSnapshot, token: number): Promise<void> {
    try {
      const result = await this.sourceFor(snapshot)
      if (token !== this.activeRenderToken) return
      if (!result) {
        this.finishSourceWait(token)
        return
      }
      if (this.sourceResult?.receipt !== result.receipt) {
        this.postUpdate(createPendingUpdate(snapshot, 'content'), result)
      }
      this.pendingRender = false
      this.activeRenderSource = result.receipt
      this.sizeCanvasElements(snapshot)
      this.post({ type: 'render', sequence: token, source: result.receipt })
    } catch (error) {
      this.finishSourceWait(token)
      this.reportSourceFailure(error)
    }
  }

  private cancelScheduledRender(token: number): void {
    if (token !== this.activeRenderToken) return

    this.activeRenderToken = 0
    this.activeRenderSource = null
    this.renderInFlight = false
  }

  private finishSourceWait(token: number): void {
    this.cancelScheduledRender(token)
    if (this.renderInFlight) return
    if (this.pendingUpdate) {
      this.scheduleFlush()
      return
    }
    if (this.pendingRender) this.requestRender()
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
    if (response.type === 'renderSkipped') {
      this.cancelScheduledRender(response.sequence)
      if (this.pendingUpdate) this.scheduleFlush()
      return
    }
    if (response.type === 'rendered') {
      if (!this.isCurrentRenderResponse(response)) return

      this.scheduler.cancel(MINIMAP_RENDER_KEY)
      this.renderInFlight = false
      this.activeRenderToken = 0
      this.activeRenderSource = null
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
        this.documentSource?.source.post(request, transfer)
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
    const expected = this.activeRenderSource
    const source = response.source
    return Boolean(
      response.sequence === this.activeRenderToken &&
      expected &&
      source &&
      sourceIdentitiesEqual(source.identity, expected.identity) &&
      sourcePointsEqual(source.target, expected.target),
    )
  }
}

type PendingMinimapUpdate = {
  readonly snapshot: EditorViewSnapshot
  readonly syncTokens: boolean
  readonly syncSelection: boolean
  readonly syncExternalDecorations: boolean
  readonly syncViewport: boolean
  readonly syncBaseStyles: boolean
  readonly reason: string
}

export function canUseMinimapWorker(): boolean {
  if (typeof Worker === 'undefined') return false
  if (typeof OffscreenCanvas === 'undefined') return false
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype
  )
}

function selections(selections: readonly EditorResolvedSelection[]): readonly MinimapSelection[] {
  return selections.map((selection) => minimapSelection(selection))
}

function replaceCanvas(previous: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = previous.ownerDocument.createElement('canvas')
  canvas.className = previous.className
  canvas.style.cssText = previous.style.cssText
  previous.replaceWith(canvas)
  return canvas
}

function minimapSelection(selection: EditorResolvedSelection): MinimapSelection {
  return {
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
  }
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

function createPendingUpdate(snapshot: EditorViewSnapshot, kind: string): PendingMinimapUpdate {
  const document = kind === 'document' || kind === 'clear'
  return {
    snapshot,
    syncTokens: document || kind === 'tokens',
    syncSelection: document || kind === 'selection' || kind === 'content',
    syncExternalDecorations: document || kind === 'decorations',
    syncViewport: shouldSyncViewport(kind),
    syncBaseStyles: document || kind === 'tokens',
    reason: kind,
  }
}

function mergePendingUpdate(
  current: PendingMinimapUpdate | null,
  next: PendingMinimapUpdate,
): PendingMinimapUpdate {
  if (!current) return next
  return {
    snapshot: next.snapshot,
    syncTokens: current.syncTokens || next.syncTokens,
    syncSelection: current.syncSelection || next.syncSelection,
    syncExternalDecorations: current.syncExternalDecorations || next.syncExternalDecorations,
    syncViewport: current.syncViewport || next.syncViewport,
    syncBaseStyles: current.syncBaseStyles || next.syncBaseStyles,
    reason: mergeReasons(current.reason, next.reason),
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
    reason: update.reason,
    syncBaseStyles: update.syncBaseStyles,
    syncExternalDecorations: update.syncExternalDecorations,
    syncSelection: update.syncSelection,
    syncTokens: update.syncTokens,
    syncViewport: update.syncViewport,
  }
}

function requestDiagnostics(request: MinimapWorkerRequest): Readonly<Record<string, unknown>> {
  switch (request.type) {
    case 'projectSource': {
      const projection = request.projection
      return {
        request: request.type,
        kind: projection.kind,
        textLength: projection.summary.textLength,
        lines: projection.summary.lines.length,
        lineSummaryTextLength: lineSummaryTextLength(projection.summary.lines),
      }
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

function lineSummaryTextLength(lines: readonly { readonly text: string }[]): number {
  let length = 0
  for (const line of lines) length += line.text.length
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
