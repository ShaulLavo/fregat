import { DEFAULT_MAX_SCROLL_HEIGHT } from './fixedRowVirtualizer'
import type { VirtualizedTextViewOptions } from './virtualizedTextViewTypes'
import { invalidateScrollElementPadding, scrollElementPadding } from './virtualizedTextViewHelpers'

type ScrollLayer = ReturnType<typeof createScrollLayer>

const stickyScrollHeightLimits = new WeakMap<Document, number>()

export class ScrollViewport {
  public readonly textContent: HTMLDivElement
  public readonly textSpacer: HTMLDivElement
  public readonly gutterSpacer: HTMLDivElement
  private readonly extent: HTMLDivElement
  private readonly frame: HTMLDivElement
  private readonly layers: readonly [ScrollLayer, ScrollLayer]
  public gutterScroll: NonNullable<VirtualizedTextViewOptions['gutterScroll']> = 'fixed'
  // CSS serializes fractional sizes with less precision than ResizeObserver reports.
  private viewportWidth = -1
  private viewportHeight = -1
  private originY = 0
  /** Every reservation change passes through here, including the provisional paint's. */
  public onReservedOverlayWidthChange: ((side: 'left' | 'right') => void) | null = null

  public constructor(private readonly scrollElement: HTMLDivElement) {
    const document = scrollElement.ownerDocument
    this.extent = document.createElement('div')
    this.extent.className = 'editor-virtualized-extent'
    this.frame = document.createElement('div')
    this.frame.className = 'editor-virtualized-viewport'
    const text = createScrollLayer(document, 'text')
    const gutter = createScrollLayer(document, 'gutter')
    this.layers = [text, gutter]
    this.textContent = text.content
    this.textSpacer = text.spacer
    this.gutterSpacer = gutter.spacer
    this.frame.append(text.clip, gutter.clip)
    this.extent.append(this.frame)
    scrollElement.append(this.extent)
    // The origin waits for the first viewport size: reading padding here would force a style pass
    // on every editor built, before the open that lays it out anyway.
  }

  public reserveOverlayWidth(side: 'left' | 'right', width: number): boolean {
    const value = width > 0 && Number.isFinite(width) ? `${Math.ceil(width)}px` : ''
    const property = overlayPaddingProperty(side)
    if (this.scrollElement.style[property] === value) return false

    this.scrollElement.style[property] = value
    invalidateScrollElementPadding(this.scrollElement)
    this.synchronizeOrigin()
    this.onReservedOverlayWidthChange?.(side)
    return true
  }

  public reservedOverlayWidth(side: 'left' | 'right'): number {
    const width = Number.parseFloat(this.scrollElement.style[overlayPaddingProperty(side)])
    return Number.isFinite(width) ? width : 0
  }

  public setViewportSize(width: number, height: number): void {
    width = Math.max(0, width)
    height = Math.max(0, height)
    if (this.viewportWidth === width && this.viewportHeight === height) return
    this.viewportWidth = width
    this.viewportHeight = height
    const nextWidth = `${width}px`
    const nextHeight = `${height}px`

    // A host stylesheet that changes the padding also changes the content box, which lands here.
    invalidateScrollElementPadding(this.scrollElement)
    this.synchronizeOrigin()
    this.frame.style.width = nextWidth
    this.frame.style.height = nextHeight
    for (const layer of this.layers) {
      layer.content.style.width = nextWidth
      layer.content.style.height = nextHeight
    }
  }

  public setDocumentWidth(width: number): void {
    const value = `${width}px`
    if (this.extent.style.width === value) return

    this.extent.style.width = value
    for (const layer of this.layers) layer.spacer.style.width = value
  }

  public visibleGutterWidth(width: number, left: number): number {
    return this.gutterScroll === 'content' ? Math.max(0, width - left) : width
  }

  public setScrollPosition(left: number, top: number): void {
    const textTransform = `translate(${-left}px, ${-top}px)`
    const gutterLeft = this.gutterScroll === 'content' ? left : 0
    const gutterTransform = `translate(${-gutterLeft}px, ${-top}px)`
    this.scrollElement.style.setProperty('--editor-gutter-scroll-left', `${gutterLeft}px`)
    if (this.layers[0].content.style.transform !== textTransform)
      this.layers[0].content.style.transform = textTransform
    if (this.layers[1].content.style.transform !== gutterTransform)
      this.layers[1].content.style.transform = gutterTransform
  }

  public get maxScrollHeight(): number | undefined {
    return stickyScrollHeightLimit(this.scrollElement.ownerDocument)
  }

  public get paintOffsetY(): number {
    return -this.originY
  }

  public setDocumentHeight(height: number, offsetY: number, scrollTop = 0): boolean {
    // Capped scrolling needs viewport-sized row coordinates to retain fractional paint precision.
    const originStep = offsetY !== 0 && this.viewportHeight > 0 ? this.viewportHeight : height
    const originY = height > 0 ? Math.floor(scrollTop / originStep) * originStep : 0
    const originChanged = this.originY !== originY
    this.originY = originY
    const value = `${height}px`
    const shiftedOffsetY = offsetY + originY
    const transform = shiftedOffsetY === 0 ? '' : `translateY(${shiftedOffsetY}px)`
    if (this.extent.style.height !== value) {
      this.extent.style.height = value
      for (const layer of this.layers) layer.spacer.style.height = value
    }
    if (this.textSpacer.style.transform !== transform) {
      for (const layer of this.layers) layer.spacer.style.transform = transform
    }
    return originChanged
  }

  private synchronizeOrigin(): void {
    const padding = scrollElementPadding(this.scrollElement)
    this.frame.style.left = `${padding.left}px`
    this.frame.style.top = `${padding.top}px`
  }
}

function stickyScrollHeightLimit(document: Document): number | undefined {
  const cached = stickyScrollHeightLimits.get(document)
  if (cached !== undefined) return cached
  if (!document.body) return undefined

  // Gecko's sticky translation limit is lower than its element-height limit.
  // A viewport-sized probe avoids single-pixel rounding near the native height cap.
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:256px;height:256px;overflow:auto;scrollbar-width:none;visibility:hidden;contain:strict;margin:0;padding:0;border:0;box-sizing:content-box'
  const extent = document.createElement('div')
  extent.style.cssText = `height:${DEFAULT_MAX_SCROLL_HEIGHT}px;margin:0;padding:0;border:0;box-sizing:content-box`
  const sticky = document.createElement('div')
  sticky.style.cssText =
    'position:sticky;top:0;height:256px;margin:0;padding:0;border:0;box-sizing:content-box'
  extent.append(sticky)
  probe.append(extent)
  document.body.append(probe)
  probe.scrollTop = DEFAULT_MAX_SCROLL_HEIGHT
  const probeRect = probe.getBoundingClientRect()
  const displacement = sticky.getBoundingClientRect().top - probeRect.top
  const reached = probe.scrollTop + (displacement * probe.clientHeight) / probeRect.height
  probe.remove()
  if (!Number.isFinite(reached) || reached <= 0) return undefined

  const limit =
    displacement === 0
      ? DEFAULT_MAX_SCROLL_HEIGHT
      : Math.min(DEFAULT_MAX_SCROLL_HEIGHT, Math.floor(reached))
  stickyScrollHeightLimits.set(document, limit)
  return limit
}

function createScrollLayer(document: Document, kind: 'text' | 'gutter') {
  const clip = document.createElement('div')
  clip.className = `editor-virtualized-clip editor-virtualized-${kind}-clip`
  const content = document.createElement('div')
  content.className = 'editor-virtualized-content'
  const spacer = document.createElement('div')
  spacer.className = 'editor-virtualized-spacer'
  content.append(spacer)
  clip.append(content)
  return { clip, content, spacer }
}

function overlayPaddingProperty(side: 'left' | 'right'): 'paddingLeft' | 'paddingRight' {
  return side === 'left' ? 'paddingLeft' : 'paddingRight'
}
