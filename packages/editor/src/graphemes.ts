import type { TextContent } from './textContent'

/**
 * Grapheme clusters — what a reader calls "one character" — for the three places that have to agree
 * on where one ends: how wide a row measures, where a caret may stop, and how much a backwards
 * delete takes.
 *
 * A caret parked between a base character and its combining mark, or between two members of a ZWJ
 * emoji sequence, sits inside a glyph the row already measured as a single cell: it paints
 * mid-glyph and a selection from there is half a character wide. Sharing one boundary definition is
 * what stops measurement and motion from drifting apart again.
 */

export type TextSegment = {
  readonly index: number
  readonly segment: string
}

type GraphemeSegmenter = {
  segment(input: string): Iterable<TextSegment>
}

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locale?: string,
    options?: { readonly granularity?: 'grapheme' },
  ) => GraphemeSegmenter
}

const ZERO_WIDTH_JOINER = 0x200d
const ENCLOSING_KEYCAP = 0x20e3
const SKIN_TONE_FIRST = 0x1f3fb
const SKIN_TONE_LAST = 0x1f3ff

/**
 * How much text a boundary search looks at before it trusts what it found. Clusters run to a
 * handful of code units in anything anyone types, and the search widens whenever it reaches its own
 * edge, so a pathological run of combining marks still terminates without every keystroke over
 * ordinary text paying for the possibility.
 */
const BOUNDARY_WINDOW = 8
export const MAX_BOUNDARY_WINDOW = 4096

const graphemeSegmenter = createGraphemeSegmenter()

export function segmentGraphemes(text: string): readonly TextSegment[] {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text))
  return fallbackTextSegments(text)
}

/**
 * Segmenting a window of the text is only sound if the window itself starts on a boundary, and
 * there is no way to know that without looking further back. A window opened mid-cluster hands the
 * segmenter a truncated head, which it reports as a cluster of its own — a boundary the whole text
 * does not have. Widening can only ever move the answer earlier, so two windows that agree have
 * both seen enough, and the first one to reach the start of the text has seen everything.
 */
export function previousGraphemeBoundary(text: TextContent, offset: number): number {
  if (offset <= 0) return 0
  if (isSoloBefore(text, offset)) return offset - 1

  let previous: number | null = null
  for (let window = BOUNDARY_WINDOW; ; window *= 2) {
    const start = Math.max(0, offset - window)
    const boundary = start + lastSegmentIndex(text.slice(start, offset))
    if (start === 0 || boundary === previous || window >= MAX_BOUNDARY_WINDOW) return boundary

    previous = boundary
  }
}

export function nextGraphemeBoundary(text: TextContent, offset: number): number {
  if (offset >= text.length) return text.length
  if (isSoloAt(text, offset)) return offset + 1

  let previous: number | null = null
  for (let window = BOUNDARY_WINDOW; ; window *= 2) {
    const end = Math.min(text.length, offset + window)
    const boundary = offset + firstSegmentLength(text.slice(offset, end))
    if (end === text.length || boundary === previous || window >= MAX_BOUNDARY_WINDOW) {
      return boundary
    }

    previous = boundary
  }
}

/**
 * Where a backwards delete stops, which is deliberately not where the caret would.
 *
 * Motion treats a cluster as indivisible because that is what the reader sees, but a delete that
 * did the same would make an eight-person family emoji unbuildable — one mistyped member and the
 * whole thing has to be retyped. So a joined sequence gives up its last component per press, while
 * a trailing skin tone or keycap goes with the base it decorates because it is nothing on its own.
 * Everything else, a combining accent included, steps back a single code point.
 */
export function previousDeleteBoundary(text: TextContent, offset: number): number {
  if (offset <= 0) return 0

  const clusterStart = previousGraphemeBoundary(text, offset)
  const joiner = lastJoinerIndex(text, clusterStart, offset)
  if (joiner !== null) return joiner
  if (endsWithDependentModifier(text, clusterStart, offset)) return clusterStart

  return previousCodePointBoundary(text, offset)
}

export function codePointLength(text: TextContent, index: number): number {
  const codePoint = text.codePointAt(index) ?? 0
  return codePoint > 0xffff ? 2 : 1
}

export function isCombiningMark(codePoint: number): boolean {
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return true
  if (codePoint >= 0x1ab0 && codePoint <= 0x1aff) return true
  if (codePoint >= 0x1dc0 && codePoint <= 0x1dff) return true
  if (codePoint >= 0x20d0 && codePoint <= 0x20ff) return true
  return codePoint >= 0xfe20 && codePoint <= 0xfe2f
}

export function isVariationSelector(codePoint: number): boolean {
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return true
  return codePoint >= 0xe0100 && codePoint <= 0xe01ef
}

/**
 * Code units that can neither continue the character before them nor be continued by the one after.
 *
 * Everything that joins — combining marks, joiners, Hangul jamo, regional indicators, both halves
 * of a surrogate pair — lives at U+0300 or above, so the overwhelmingly common case of plain text
 * answers here and no segmenter ever runs. The line terminators are excluded because CR and LF are
 * one stop between them.
 */
function isSoloCodeUnit(code: number): boolean {
  if (code === 0x09) return true
  return code >= 0x20 && code < 0x0300
}

/**
 * Both neighbours are checked, not just the one being stepped over: a joining character that
 * precedes a plain one pulls it into its own cluster, and only the character before reveals that.
 */
export function isSoloBefore(text: TextContent, offset: number): boolean {
  if (!isSoloCodeUnit(text.charCodeAt(offset - 1))) return false
  return offset < 2 || isSoloCodeUnit(text.charCodeAt(offset - 2))
}

function isSoloAt(text: TextContent, offset: number): boolean {
  if (!isSoloCodeUnit(text.charCodeAt(offset))) return false
  return offset + 1 >= text.length || isSoloCodeUnit(text.charCodeAt(offset + 1))
}

function previousCodePointBoundary(text: TextContent, offset: number): number {
  const previous = offset - 1
  if (previous <= 0) return Math.max(0, previous)

  const code = text.charCodeAt(previous)
  if (code < 0xdc00 || code > 0xdfff) return previous

  const before = text.charCodeAt(previous - 1)
  return before >= 0xd800 && before <= 0xdbff ? previous - 1 : previous
}

function lastJoinerIndex(text: TextContent, start: number, end: number): number | null {
  for (let index = end - 1; index >= start; index -= 1) {
    if (text.charCodeAt(index) === ZERO_WIDTH_JOINER) return index
  }

  return null
}

function endsWithDependentModifier(text: TextContent, start: number, end: number): boolean {
  const last = previousCodePointBoundary(text, end)
  if (last < start) return false

  const codePoint = text.codePointAt(last) ?? 0
  if (codePoint === ENCLOSING_KEYCAP) return true
  if (isVariationSelector(codePoint)) return true
  return codePoint >= SKIN_TONE_FIRST && codePoint <= SKIN_TONE_LAST
}

/**
 * Segments are walked rather than collected: a boundary search wants one index out of the window,
 * and caret motion repeats at the key-repeat rate.
 */
function lastSegmentIndex(text: string): number {
  if (!graphemeSegmenter) return lastFallbackSegmentIndex(text)

  let index = 0
  for (const segment of graphemeSegmenter.segment(text)) index = segment.index
  return index
}

function firstSegmentLength(text: string): number {
  if (!graphemeSegmenter) return fallbackSegmentEnd(text, 0)

  const [first] = graphemeSegmenter.segment(text)
  return first ? first.segment.length : text.length
}

function lastFallbackSegmentIndex(text: string): number {
  let index = 0
  let next = 0
  while (next < text.length) {
    index = next
    next = fallbackSegmentEnd(text, next)
  }

  return index
}

function createGraphemeSegmenter(): GraphemeSegmenter | null {
  const Segmenter = (Intl as IntlWithSegmenter).Segmenter
  if (!Segmenter) return null
  return new Segmenter(undefined, { granularity: 'grapheme' })
}

function fallbackTextSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let index = 0
  while (index < text.length) {
    const start = index
    index = fallbackSegmentEnd(text, index)
    segments.push({ index: start, segment: text.slice(start, index) })
  }

  return segments
}

function fallbackSegmentEnd(text: string, index: number): number {
  return consumeCombiningSuffix(text, index + codePointLength(text, index))
}

function consumeCombiningSuffix(text: string, index: number): number {
  let next = index
  while (next < text.length) {
    const codePoint = text.codePointAt(next) ?? 0
    if (!isCombiningMark(codePoint) && !isVariationSelector(codePoint)) break
    next += codePointLength(text, next)
  }

  return next
}
