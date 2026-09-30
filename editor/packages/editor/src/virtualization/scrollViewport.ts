import { invalidateScrollElementPadding, scrollElementPadding } from './virtualizedTextViewHelpers'

type ScrollLayer = ReturnType<typeof createScrollLayer>

export class ScrollViewport {
  public readonly textContent: HTMLDivElement
  public readonly textSpacer: HTMLDivElement
  public readonly gutterSpacer: HTMLDivElement
  private readonly extent: HTMLDivElement
  private readonly frame: HTMLDivElement
  private readonly layers: readonly [ScrollLayer, ScrollLayer]
  // CSS serializes fractional sizes with less precision than ResizeObserver reports.
  private viewportWidth = -1
  private viewportHeight = -1
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

  public setScrollPosition(left: number, top: number): void {
    const textTransform = `translate(${-left}px, ${-top}px)`
    const gutterTransform = `translateY(${-top}px)`
    if (this.layers[0].content.style.transform !== textTransform)
      this.layers[0].content.style.transform = textTransform
    if (this.layers[1].content.style.transform !== gutterTransform)
      this.layers[1].content.style.transform = gutterTransform
  }

  public setDocumentHeight(height: number, offsetY: number): void {
    const value = `${height}px`
    const transform = offsetY === 0 ? '' : `translateY(${offsetY}px)`
    if (this.extent.style.height !== value) {
      this.extent.style.height = value
      for (const layer of this.layers) layer.spacer.style.height = value
    }
    if (this.textSpacer.style.transform === transform) return
    for (const layer of this.layers) layer.spacer.style.transform = transform
  }

  private synchronizeOrigin(): void {
    const padding = scrollElementPadding(this.scrollElement)
    this.frame.style.left = `${padding.left}px`
    this.frame.style.top = `${padding.top}px`
  }
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
