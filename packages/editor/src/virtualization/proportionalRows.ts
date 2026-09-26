import type { TextContent } from '../textContent'
import type { GlyphAdvances } from './glyphAdvances'

/**
 * Pixel positions along one long row in a proportional face, for the parts of the view that place a
 * window of the row: the spacer standing in for the text left of it, and the columns a scroll offset
 * reaches. Prefix sums are kept every `BLOCK` code units, so a query past the first costs one block.
 */

const BLOCK = 512

type RowPrefixes = {
  readonly glyphs: GlyphAdvances
  readonly tabSize: number
  /** Pixels before code unit `index * BLOCK`. */
  readonly prefixes: number[]
}

const prefixesByText = new WeakMap<object, RowPrefixes>()

/** Pixels the row's text takes up to `column`. */
export function pixelsBeforeColumn(
  text: TextContent,
  column: number,
  glyphs: GlyphAdvances,
  tabSize: number,
): number {
  const end = Math.max(0, Math.min(column, text.length))
  const prefixes = rowPrefixes(text, glyphs, tabSize, end)
  const block = Math.floor(end / BLOCK)
  const start = block * BLOCK
  return advanceAcross(text, start, end, prefixes[block]!, glyphs, tabSize)
}

/** The code unit at `pixels` along the row, rounded down (`'before'`) or up (`'after'`). */
export function columnAtPixels(
  text: TextContent,
  pixels: number,
  glyphs: GlyphAdvances,
  tabSize: number,
  bias: 'before' | 'after',
): number {
  if (pixels <= 0) return 0
  const prefixes = rowPrefixes(text, glyphs, tabSize, text.length)
  let block = 0
  while (block + 1 < prefixes.length && prefixes[block + 1]! <= pixels) block += 1
  let column = block * BLOCK
  let visual = prefixes[block]!
  const end = Math.min(text.length, column + BLOCK)
  const slice = text.slice(column, end)
  for (let index = 0; index < slice.length; index += 1) {
    const next = visual + unitAdvance(slice, index, visual, glyphs, tabSize)
    if (next > pixels) return bias === 'after' ? column + 1 : column
    visual = next
    column += 1
  }
  return column
}

function rowPrefixes(
  text: TextContent,
  glyphs: GlyphAdvances,
  tabSize: number,
  through: number,
): readonly number[] {
  const cached = typeof text === 'string' ? undefined : prefixesByText.get(text)
  const current =
    cached && cached.glyphs === glyphs && cached.tabSize === tabSize
      ? cached
      : { glyphs, tabSize, prefixes: [0] }
  if (typeof text !== 'string' && current !== cached) prefixesByText.set(text, current)

  const { prefixes } = current
  const needed = Math.floor(through / BLOCK)
  while (prefixes.length <= needed) {
    const block = prefixes.length - 1
    const start = block * BLOCK
    const end = Math.min(text.length, start + BLOCK)
    prefixes.push(advanceAcross(text, start, end, prefixes[block]!, glyphs, tabSize))
  }
  return prefixes
}

function advanceAcross(
  text: TextContent,
  start: number,
  end: number,
  visual: number,
  glyphs: GlyphAdvances,
  tabSize: number,
): number {
  const slice = text.slice(start, end)
  let total = visual
  for (let index = 0; index < slice.length; index += 1) {
    total += unitAdvance(slice, index, total, glyphs, tabSize)
  }
  return total
}

/** A tab reaches the next stop, `tabSize` spaces apart; a pair's advance rides on its high half. */
function unitAdvance(
  slice: string,
  index: number,
  visual: number,
  glyphs: GlyphAdvances,
  tabSize: number,
): number {
  const code = slice.charCodeAt(index)
  if (code === 9) {
    const stop = tabSize * glyphs.advance(32)
    return stop - (visual % stop)
  }
  if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
    const previous = slice.charCodeAt(index - 1)
    if (previous >= 0xd800 && previous <= 0xdbff) return 0
  }
  return glyphs.advance(slice.codePointAt(index) ?? code)
}
