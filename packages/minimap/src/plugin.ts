import type {
  EditorContributionChange,
  EditorDisposable,
  EditorCapabilityContribution,
  EditorCapabilityContributionContext,
  EditorMinimapDecoration,
  EditorMinimapFeature,
  EditorPlugin,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
  EditorViewportSnapshot,
} from '@singapore-editor/core/extensions'
import {
  EDITOR_MINIMAP_FEATURE,
  registerWheelScrollTarget,
} from '@singapore-editor/core/extensions'
import { mergeDenseDecorations } from './decorationMerge'
import { computeRenderLayout, documentLineForSliderY, visibleDocumentLineRange } from './layout'
import { resolveMinimapOptions } from './options'
import type { EditorMinimapOptions, ResolvedMinimapOptions } from './types'
import { minimapViewportGeometry, type MinimapScrollGeometry } from './viewportGeometry'
import { canUseMinimapWorker, MinimapWorkerClient, type MinimapHost } from './workerClient'

export function createMinimapPlugin(options: EditorMinimapOptions = {}): EditorPlugin {
  const resolved = resolveMinimapOptions(options)
  const decorations = new MinimapDecorationRegistry()

  return {
    name: 'minimap',
    activate(context) {
      return [
        context.registerCapabilityContribution({
          createContribution: (contributionContext) =>
            createMinimapFeatureContribution(contributionContext, decorations),
        }),
        context.registerViewContribution({
          createContribution: (contributionContext) =>
            createMinimapContribution(contributionContext, resolved, decorations),
        }),
      ]
    },
  }
}

function createMinimapFeatureContribution(
  context: EditorCapabilityContributionContext,
  decorations: MinimapDecorationRegistry,
): EditorCapabilityContribution {
  const registration = context.registerFeature(EDITOR_MINIMAP_FEATURE, decorations)

  return {
    dispose: () => registration.dispose(),
  }
}

function createMinimapContribution(
  context: EditorViewContributionContext,
  options: ResolvedMinimapOptions,
  decorations: MinimapDecorationRegistry,
): EditorViewContribution | null {
  if (!options.enabled) return null
  if (!canUseMinimapWorker()) return null

  return new MinimapContribution(context, options, decorations)
}

class MinimapContribution implements EditorViewContribution {
  public readonly snapshotKey: string
  private readonly context: EditorViewContributionContext
  private readonly options: ResolvedMinimapOptions
  private readonly host: MinimapHost
  private readonly client: MinimapWorkerClient
  private readonly decorationSubscription: EditorDisposable
  private readonly wheelScrollRegistration: EditorDisposable
  private latestSnapshot: EditorViewSnapshot
  private latestViewport: EditorViewportSnapshot
  private activeSliderDrag: SliderDrag | null = null
  private appliedReservedWidth = 0
  private layoutSignature = ''
  private scrollBox: MinimapScrollBox | null = null
  private pendingSliderLine: number | null = null
  private sliderScrollFrame = 0
  private disposed = false

  public constructor(
    context: EditorViewContributionContext,
    options: ResolvedMinimapOptions,
    private readonly decorations: MinimapDecorationRegistry,
  ) {
    this.context = context
    this.options = options
    this.snapshotKey = `minimap:${JSON.stringify(options)}`
    this.latestSnapshot = context.getSnapshot()
    this.latestViewport = this.latestSnapshot.viewport
    this.host = createHost(context, options)
    if (this.latestSnapshot.geometryCommitted !== false) this.synchronizeLayoutReservation()
    this.client = new MinimapWorkerClient({
      host: this.host,
      options,
      snapshot: this.latestSnapshot,
      decorations: this.collectDecorations(),
      onLayoutWidth: this.reserveWidth,
      reservedLane: () => this.appliedReservedWidth,
    })
    this.decorationSubscription = decorations.subscribe(this.handleDecorationsChanged)
    this.wheelScrollRegistration = registerWheelScrollTarget(context, this.host.root)
    this.installPointerHandlers()
    this.client.update(this.latestSnapshot, 'document')
  }

  public update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    change?: EditorContributionChange | null,
  ): void {
    if (this.disposed) return

    this.latestSnapshot = snapshot
    this.latestViewport = snapshot.viewport
    if (snapshot.geometryCommitted === false) return
    if (kind === 'document' || kind === 'layout') this.scrollBox = null
    if (kind === 'document' || kind === 'layout' || kind === 'viewport') {
      this.synchronizeLayoutReservation()
    }
    this.client.update(snapshot, kind, change)
  }

  public updateViewport(viewport: EditorViewportSnapshot): void {
    if (this.disposed || this.latestSnapshot.geometryCommitted === false) return
    this.latestViewport = viewport
    this.client.updateViewport(viewport)
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.stopSliderDrag()
    this.wheelScrollRegistration.dispose()
    this.decorationSubscription.dispose()
    this.client.dispose()
    this.context.reserveOverlayWidth(this.options.side, 0)
    this.host.root.remove()
  }

  private installPointerHandlers(): void {
    this.host.root.addEventListener('pointerdown', this.handlePointerDown)
    this.host.slider.addEventListener('pointerdown', this.handleSliderPointerDown)
  }

  private readonly reserveWidth = (_width: number): void => {
    if (this.context.getSnapshot().geometryCommitted === false) return
    this.scrollBox = null
    this.layoutSignature = ''
    this.synchronizeLayoutReservation()
  }

  private synchronizeLayoutReservation(): void {
    const snapshot = this.latestSnapshot
    const scroll = this.measureScrollGeometry()
    const { clientWidth, clientHeight } = scroll
    const signature = [
      scroll.width,
      scroll.height,
      clientWidth,
      clientHeight,
      scroll.overflowsX,
      scroll.overflowsY,
      scroll.borders.left,
      scroll.borders.right,
      scroll.borders.top,
      scroll.borders.bottom,
      scroll.overlayScrollbars.vertical,
      scroll.overlayScrollbars.horizontal,
      snapshot.metrics.characterWidth,
      snapshot.metrics.rowHeight,
      this.context.scrollElement.ownerDocument.defaultView?.devicePixelRatio ?? 1,
      this.options.size === 'proportional' ? 0 : snapshot.lineCount,
    ].join(':')
    if (signature === this.layoutSignature) return
    this.layoutSignature = signature
    const minimapHeight = minimapViewportGeometry(this.options.side, 0, scroll).height
    const minimapWidth = Math.ceil(
      this.currentLayoutWidth(clientWidth, clientHeight, minimapHeight),
    )
    const geometry = minimapViewportGeometry(this.options.side, minimapWidth, scroll)
    this.host.root.style.width = `${minimapWidth}px`
    this.host.root.style.top = `${geometry.top}px`
    this.host.root.style.height = `${geometry.height}px`
    const side = this.options.side
    this.host.root.style[side] = `${geometry[side]}px`
    const nextWidth = geometry.reservedWidth
    if (nextWidth === this.appliedReservedWidth) return

    const previousWidth = this.appliedReservedWidth
    this.appliedReservedWidth = nextWidth
    this.logLane(previousWidth, scroll, geometry)
    this.context.reserveOverlayWidth(this.options.side, nextWidth)
  }

  private measureScrollGeometry(): MinimapScrollGeometry {
    const viewport = this.latestViewport
    const box = this.currentScrollBox()
    return {
      ...box,
      overflowsX: viewport.clientWidth > 0 && viewport.scrollWidth > viewport.clientWidth,
      overflowsY:
        box.clientHeight > 0 &&
        Math.max(viewport.scrollHeight, this.latestSnapshot.totalHeight) > box.clientHeight,
    }
  }

  // The box is read from the DOM (computed style and a forced layout) only when something could
  // have changed it: a document or layout update, a lane change, or a viewport whose height or
  // border box no longer matches. A scroll reuses the last measurement.
  private currentScrollBox(): MinimapScrollBox {
    const viewport = this.latestViewport
    const cached = this.scrollBox
    if (cached && scrollBoxMatchesViewport(cached, viewport)) return cached

    const element = this.context.scrollElement
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    const clientWidth =
      element.clientWidth ||
      (viewport.clientWidth > 0 ? viewport.clientWidth + this.appliedReservedWidth : 0)
    const clientHeight = element.clientHeight || viewport.clientHeight
    const box: MinimapScrollBox = {
      width: element.offsetWidth || viewport.borderBoxWidth || clientWidth,
      height: element.offsetHeight || viewport.borderBoxHeight || clientHeight,
      clientWidth,
      clientHeight,
      borders: {
        left: cssPixels(style?.borderLeftWidth),
        right: cssPixels(style?.borderRightWidth),
        top: cssPixels(style?.borderTopWidth),
        bottom: cssPixels(style?.borderBottomWidth),
      },
      overlayScrollbars: overlayScrollbarDimensions(element, style),
    }
    this.scrollBox = box
    return box
  }

  private currentLayoutWidth(
    clientWidth: number,
    clientHeight: number,
    minimapHeight: number,
  ): number {
    const snapshot = this.latestSnapshot
    const element = this.context.scrollElement
    const range = visibleDocumentLineRange(snapshot, this.latestViewport)
    return computeRenderLayout({
      minimap: this.options,
      lineCount: snapshot.lineCount,
      metrics: {
        ...snapshot.metrics,
        devicePixelRatio: element.ownerDocument.defaultView?.devicePixelRatio ?? 1,
      },
      viewport: {
        ...this.latestViewport,
        clientWidth,
        clientHeight,
        minimapHeight,
        reservedWidth: 0,
        visibleStart: range.start,
        visibleEnd: range.end,
      },
    }).width
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (this.context.getSnapshot().geometryCommitted === false) return
    if (event.target === this.host.slider || this.host.slider.contains(event.target as Node)) return

    event.preventDefault()
    const frame = this.client.frameLayout()
    const y = event.clientY - this.host.root.getBoundingClientRect().top
    if (y >= frame.sliderTop && y <= frame.sliderTop + frame.sliderHeight) return
    const line = documentLineForSliderY(frame, y - frame.sliderHeight / 2)
    this.revealDocumentLine(line)
  }

  private readonly handleSliderPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (this.context.getSnapshot().geometryCommitted === false) return

    event.preventDefault()
    this.stopSliderDrag()
    const startY = event.clientY
    const frame = this.client.frameLayout()
    const startLine = documentLineForSliderY(frame, frame.sliderTop)

    let moved = false
    const onMove = (move: PointerEvent): void => {
      if (this.context.getSnapshot().geometryCommitted === false) {
        this.stopSliderDrag()
        return
      }
      if (!moved && move.clientY === startY) return
      if (frame.sliderLineHeight <= 0) return
      moved = true
      const line = startLine + (move.clientY - startY) / frame.sliderLineHeight
      this.scheduleSliderScroll(line)
    }
    const onEnd = (): void => this.stopSliderDrag()

    this.captureSliderPointer(event.pointerId)
    this.host.slider.classList.add('active')
    this.activeSliderDrag = { pointerId: event.pointerId, onMove, onEnd }
    this.host.slider.ownerDocument.addEventListener('pointermove', onMove)
    this.host.slider.ownerDocument.addEventListener('pointerup', onEnd, { once: true })
    this.host.slider.ownerDocument.addEventListener('pointercancel', onEnd, { once: true })
    this.host.slider.addEventListener('lostpointercapture', onEnd, { once: true })
  }

  private captureSliderPointer(pointerId: number): void {
    try {
      this.host.slider.setPointerCapture(pointerId)
    } catch {
      return
    }
  }

  private stopSliderDrag(): void {
    const drag = this.activeSliderDrag
    if (!drag) return

    this.activeSliderDrag = null
    this.cancelSliderScroll()
    this.flushSliderScroll()
    this.host.slider.ownerDocument.removeEventListener('pointermove', drag.onMove)
    this.host.slider.ownerDocument.removeEventListener('pointerup', drag.onEnd)
    this.host.slider.ownerDocument.removeEventListener('pointercancel', drag.onEnd)
    this.host.slider.removeEventListener('lostpointercapture', drag.onEnd)
    this.releaseSliderPointer(drag.pointerId)
    this.host.slider.classList.remove('active')
  }

  private scheduleSliderScroll(line: number): void {
    this.pendingSliderLine = line
    if (this.sliderScrollFrame !== 0) return

    this.sliderScrollFrame = requestFrame(() => {
      this.sliderScrollFrame = 0
      this.flushSliderScroll()
    })
  }

  private flushSliderScroll(): void {
    const line = this.pendingSliderLine
    this.pendingSliderLine = null
    if (line === null) return
    if (this.context.getSnapshot().geometryCommitted === false) return

    this.revealDocumentLine(line)
  }

  private cancelSliderScroll(): void {
    if (this.sliderScrollFrame === 0) return

    cancelFrame(this.sliderScrollFrame)
    this.sliderScrollFrame = 0
  }

  private releaseSliderPointer(pointerId: number): void {
    if (!this.host.slider.hasPointerCapture(pointerId)) return

    try {
      this.host.slider.releasePointerCapture(pointerId)
    } catch {
      return
    }
  }

  private revealDocumentLine(line: number): void {
    this.context.revealLine(clamp(Math.floor(line), 0, this.latestSnapshot.lineCount - 1))
  }

  private logLane(
    previousWidth: number,
    scroll: MinimapScrollGeometry,
    geometry: ReturnType<typeof minimapViewportGeometry>,
  ): void {
    const viewport = this.latestViewport
    this.context.log({
      action: 'editor.minimap.lane_changed',
      level: 'info',
      minimap: {
        documentId: this.latestSnapshot.documentId,
        scrollElementClass: this.context.scrollElement.className,
        containerClass: this.context.container.className,
        appliedOverlayWidth: this.appliedReservedWidth,
        availableWidth: scroll.clientWidth,
        borderBoxWidth: viewport.borderBoxWidth ?? null,
        clientWidth: viewport.clientWidth,
        previousOverlayWidth: previousWidth,
        side: this.options.side,
        horizontalScrollbar: geometry.horizontalScrollbar,
        verticalScrollbar: geometry.verticalScrollbar,
      },
    })
  }

  private readonly handleDecorationsChanged = (): void => {
    this.client.setExternalDecorations(this.collectDecorations())
  }

  // The height a whole document is projected onto is the editor's own, so how
  // dense a source is on screen is answerable from the snapshot, without
  // waiting on the worker that owns the render layout.
  private collectDecorations(): readonly EditorMinimapDecoration[] {
    return mergeDenseDecorations(
      this.decorations.getDecorations(),
      this.latestViewport.clientHeight,
      this.latestSnapshot.lineCount,
    )
  }
}

class MinimapDecorationRegistry implements EditorMinimapFeature {
  private readonly decorationsBySource = new Map<string, readonly EditorMinimapDecoration[]>()
  private readonly listeners = new Set<() => void>()

  public setDecorations(sourceId: string, decorations: readonly EditorMinimapDecoration[]): void {
    this.decorationsBySource.set(sourceId, decorations)
    this.notify()
  }

  public clearDecorations(sourceId: string): void {
    if (!this.decorationsBySource.delete(sourceId)) return

    this.notify()
  }

  public getDecorations(): readonly EditorMinimapDecoration[] {
    return Array.from(this.decorationsBySource.values()).flat()
  }

  public subscribe(listener: () => void): EditorDisposable {
    this.listeners.add(listener)
    return {
      dispose: () => this.listeners.delete(listener),
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

type SliderDrag = {
  readonly pointerId: number
  readonly onMove: (event: PointerEvent) => void
  readonly onEnd: () => void
}

function createHost(
  context: EditorViewContributionContext,
  options: ResolvedMinimapOptions,
): MinimapHost {
  const document = context.container.ownerDocument
  const root = document.createElement('div')
  const shadow = document.createElement('div')
  const mainCanvas = document.createElement('canvas')
  const decorationsCanvas = document.createElement('canvas')
  const slider = document.createElement('div')
  const sliderHorizontal = document.createElement('div')

  root.className = hostClassName(options)
  shadow.className = 'editor-minimap-shadow editor-minimap-shadow-hidden'
  mainCanvas.className = 'editor-minimap-canvas'
  decorationsCanvas.className = 'editor-minimap-canvas editor-minimap-decorations'
  slider.className = 'editor-minimap-slider'
  sliderHorizontal.className = 'editor-minimap-slider-horizontal'
  slider.appendChild(sliderHorizontal)
  root.append(shadow, mainCanvas, decorationsCanvas, slider)
  if (getComputedStyle(context.container).position === 'static') {
    context.container.style.position = 'relative'
  }
  context.container.appendChild(root)

  return {
    root,
    colorScope: context.scrollElement,
    shadow,
    mainCanvas,
    decorationsCanvas,
    slider,
    sliderHorizontal,
  }
}

type MinimapScrollBox = Omit<MinimapScrollGeometry, 'overflowsX' | 'overflowsY'>

function scrollBoxMatchesViewport(
  box: MinimapScrollBox,
  viewport: EditorViewportSnapshot,
): boolean {
  // ResizeObserver retains fractional pixels; offsetWidth/Height round them to integers.
  if (viewport.borderBoxWidth !== undefined && viewport.borderBoxHeight !== undefined) {
    return (
      Math.round(viewport.borderBoxWidth) === box.width &&
      Math.round(viewport.borderBoxHeight) === box.height
    )
  }
  return viewport.clientHeight <= 0 || viewport.clientHeight === box.clientHeight
}

function hostClassName(options: ResolvedMinimapOptions): string {
  const classes = ['editor-minimap', `editor-minimap-${options.side}`]
  if (options.showSlider === 'always') classes.push('slider-always')
  if (options.showSlider === 'mouseover') classes.push('slider-mouseover')
  if (options.autohide !== 'none') classes.push(`editor-minimap-autohide-${options.autohide}`)
  return classes.join(' ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return setTimeout(callback, 16) as unknown as number
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle)
    return
  }

  clearTimeout(handle)
}

function overlayScrollbarDimensions(
  element: HTMLElement,
  style: CSSStyleDeclaration | undefined,
): MinimapScrollGeometry['overlayScrollbars'] {
  const keyword = style?.getPropertyValue('scrollbar-width').trim()
  if (keyword === 'none') return { vertical: 0, horizontal: 0 }
  if (keyword === 'thin') return { vertical: 7, horizontal: 7 }

  const pseudo = element.ownerDocument.defaultView?.getComputedStyle(element, '::-webkit-scrollbar')
  return {
    vertical: cssPixels(pseudo?.width, 15),
    horizontal: cssPixels(pseudo?.height, 15),
  }
}

function cssPixels(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}
