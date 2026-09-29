/**
 * Per-face glyph advances for a proportional font, read from a 2D canvas set to the face the text is
 * drawn with. Summing single glyphs ignores kerning and shaping, so callers leave a margin; the
 * monospace path never builds one.
 */
export type GlyphAdvances = {
  /** The advance of one code point, in CSS pixels. */
  advance(codePoint: number): number
}

type MeasureContext = {
  font: string
  letterSpacing?: string
  measureText(text: string): { readonly width: number }
}

const BMP_SIZE = 0x10000

/**
 * Kept free at a row's end: summed advances ran up to 0.63 px short of layout on 2,000 real lines in
 * Noto Sans, Liberation Sans and Noto Sans CJK, never more, so a row can wrap early but not overflow.
 */
export const PROPORTIONAL_WRAP_MARGIN_PX = 1

let advancesCache = new WeakMap<Document, Map<string, GlyphAdvances>>()

/** Null where no canvas can measure (no layout engine), which leaves wrap on columns. */
export function glyphAdvancesFor(element: HTMLElement): GlyphAdvances | null {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (!style) return null
  const font = fontShorthand(style)
  const key = `${font}\n${style.letterSpacing}`
  const cached = advancesCache.get(element.ownerDocument)?.get(key)
  if (cached) return cached

  const context = measureContext(element.ownerDocument)
  if (!context) return null
  context.font = font
  if (style.letterSpacing !== 'normal' && 'letterSpacing' in context) {
    context.letterSpacing = style.letterSpacing
  }
  const advances = createGlyphAdvances(context, font, style.letterSpacing)
  const byKey = advancesCache.get(element.ownerDocument) ?? new Map<string, GlyphAdvances>()
  byKey.set(key, advances)
  advancesCache.set(element.ownerDocument, byKey)
  return advances
}

/** Dropped with the metrics cache: a late web font changes every advance without changing a style. */
export function clearGlyphAdvancesCache(): void {
  advancesCache = new WeakMap()
}

function createGlyphAdvances(
  context: MeasureContext,
  font: string,
  letterSpacing: string,
): GlyphAdvances {
  const bmp = new Float32Array(BMP_SIZE).fill(Number.NaN)
  const astral = new Map<number, number>()
  const measure = (codePoint: number): number => {
    // The context is shared across faces, so each read sets the face it measures in.
    context.font = font
    if ('letterSpacing' in context) context.letterSpacing = letterSpacing
    return context.measureText(String.fromCodePoint(codePoint)).width
  }

  return {
    advance(codePoint) {
      if (codePoint < BMP_SIZE) {
        const known = bmp[codePoint]!
        if (!Number.isNaN(known)) return known
        const width = measure(codePoint)
        bmp[codePoint] = width
        return width
      }
      const known = astral.get(codePoint)
      if (known !== undefined) return known
      const width = measure(codePoint)
      astral.set(codePoint, width)
      return width
    },
  }
}

let sharedContext: MeasureContext | null = null

function measureContext(document: Document): MeasureContext | null {
  if (sharedContext) return sharedContext
  const view = document.defaultView as (Window & typeof globalThis) | null
  const offscreen = view?.OffscreenCanvas ? new view.OffscreenCanvas(1, 1).getContext('2d') : null
  const context = offscreen ?? document.createElement('canvas').getContext('2d')
  if (!context || typeof context.measureText !== 'function') return null
  sharedContext = context as MeasureContext
  return sharedContext
}

/** `font` is not a computed longhand in every engine, so the shorthand is assembled from its parts. */
function fontShorthand(style: CSSStyleDeclaration): string {
  return [style.fontStyle, style.fontVariantCaps, style.fontWeight]
    .filter((part) => part && part !== 'normal')
    .concat(`${style.fontSize} ${style.fontFamily}`)
    .join(' ')
}
