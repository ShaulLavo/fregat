/**
 * Text widths from canvas `measureText`, cached per string, so piece positions
 * are arithmetic over cached widths and never a DOM layout read. The browser's
 * own font engine is still the source of truth; only the reflow is skipped.
 */
export class TextMeasurer {
  private readonly widths = new Map<string, number>()
  private readonly context: CanvasRenderingContext2D | null

  public constructor(
    document: Document,
    public readonly font: string,
    private readonly fallbackCharWidth: number,
    /** Columns per tab stop, as the rows render them (`tab-size`). */
    public readonly tabColumns: number,
  ) {
    this.context = document.createElement('canvas').getContext('2d')
    if (this.context) this.context.font = font
  }

  public get tabWidth(): number {
    return this.width(' ') * this.tabColumns
  }

  public width(text: string): number {
    const cached = this.widths.get(text)
    if (cached !== undefined) return cached
    const width = this.context
      ? this.context.measureText(text).width
      : text.length * this.fallbackCharWidth
    this.widths.set(text, width)
    return width
  }
}

/** The tab width the editor renders with; the snapshot's `tabSize` is the detected indent instead. */
export function renderedTabColumns(scrollElement: Element, fallback: number): number {
  const style = scrollElement.ownerDocument.defaultView?.getComputedStyle(scrollElement)
  const columns = Number.parseFloat(style?.getPropertyValue('--editor-tab-size') ?? '')
  return Number.isFinite(columns) && columns > 0 ? columns : fallback
}

/** The canvas font string for an element's computed font. */
export function canvasFont(element: Element): string {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (!style) return ''
  return [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily]
    .filter((part) => part && part !== 'normal')
    .join(' ')
}
