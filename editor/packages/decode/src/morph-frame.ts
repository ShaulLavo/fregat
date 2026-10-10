import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'
import type { TextMeasurer } from './measure'

/** One visible run of text that moves, enters or leaves as a unit. */
export type MorphPiece = {
  readonly text: string
  readonly offset: number
  /** Left edge in content px, after the row's spacer; the layer adds the gutter. */
  readonly x: number
  readonly top: number
  readonly height: number
  /** Order of its row among the frame's rows, for staggering. */
  readonly row: number
  readonly color: string | undefined
  readonly fontStyle: string | undefined
  readonly fontWeight: string | number | undefined
}

export type MorphFrame = {
  readonly pieces: readonly MorphPiece[]
  readonly rowCount: number
}

type Tokens = EditorViewSnapshot['tokens']
type TokenStyle = ReturnType<Tokens['styleAt']>

// Words, runs of punctuation, and whitespace. Whitespace only advances x.
const PIECE = /[\p{L}\p{N}_$]+|[^\p{L}\p{N}_$\s]+|\s+/gu
const WHITESPACE = /^\s+$/

/**
 * The visible rows as positioned pieces, split at both syntax-token and word
 * boundaries so a piece never straddles two colours. Null when a mounted row
 * is a horizontal window of a long line, whose x origin is not the row start,
 * or carries paint the overlay cannot redraw.
 */
export function buildFrame(
  snapshot: EditorViewSnapshot,
  measurer: TextMeasurer,
  maxPieces: number,
): MorphFrame | null {
  const pieces: MorphPiece[] = []
  const styleAt = tokenStyleLookup(snapshot.tokens)
  const tabWidth = measurer.tabWidth
  let row = 0
  for (const visible of snapshot.visibleRows) {
    if (visible.kind !== 'text') continue
    if (typeof visible.text !== 'string') return null
    // Paint the overlay cannot redraw, such as plugin CSS or control-character boxes, would vanish
    // with the hidden row.
    if (!drawsAsPlainText(visible)) return null
    if (visible.text.length === 0) continue
    appendRowPieces(pieces, {
      text: visible.text,
      startOffset: visible.startOffset,
      left: visible.leftSpacerWidth,
      top: visible.top,
      height: visible.height,
      row,
      tabWidth,
      measurer,
      styleAt,
    })
    row += 1
    if (pieces.length > maxPieces) return null
  }
  return { pieces, rowCount: row }
}

type RowInput = {
  readonly text: string
  readonly startOffset: number
  readonly left: number
  readonly top: number
  readonly height: number
  readonly row: number
  readonly tabWidth: number
  readonly measurer: TextMeasurer
  readonly styleAt: (offset: number) => { style: TokenStyle | undefined; end: number }
}

function appendRowPieces(pieces: MorphPiece[], input: RowInput): void {
  let x = 0
  for (const match of input.text.matchAll(PIECE)) {
    let segment = match[0]
    let column = match.index
    while (segment.length > 0) {
      const { style, end } = input.styleAt(input.startOffset + column)
      const length = Math.max(1, Math.min(segment.length, end - (input.startOffset + column)))
      const text = segment.slice(0, length)
      if (WHITESPACE.test(text)) {
        x = advanceWhitespace(x, text, input)
      } else {
        pieces.push({
          text,
          offset: input.startOffset + column,
          x: input.left + x,
          top: input.top,
          height: input.height,
          row: input.row,
          color: style?.color,
          fontStyle: style?.fontStyle,
          fontWeight: style?.fontWeight,
        })
        x += input.measurer.width(text)
      }
      segment = segment.slice(length)
      column += length
    }
  }
}

// Tabs advance to the next stop measured from the row's text origin, like CSS `tab-size`.
function advanceWhitespace(x: number, text: string, input: RowInput): number {
  let next = x
  for (const char of text) {
    if (char === '\t' && input.tabWidth > 0) {
      next = (Math.floor(next / input.tabWidth + 1e-6) + 1) * input.tabWidth
      continue
    }
    next += input.measurer.width(char)
  }
  return next
}

/**
 * Maps an offset to its token's style and the offset where that style ends.
 * Reads go forward within a row, so one advancing cursor serves the pass; a
 * jump backwards (the next row) re-seeks by bisection.
 */
function tokenStyleLookup(
  tokens: Tokens,
): (offset: number) => { style: TokenStyle | undefined; end: number } {
  let cursor = -1
  let last = -1
  return (offset) => {
    if (cursor < 0 || offset < last) cursor = tokens.firstEndingAfter(offset)
    last = offset
    while (cursor < tokens.length && tokens.endAt(cursor) <= offset) cursor += 1
    if (cursor >= tokens.length) return { style: undefined, end: Number.POSITIVE_INFINITY }
    const start = tokens.startAt(cursor)
    if (start > offset) return { style: undefined, end: start }
    return { style: tokens.styleAt(cursor), end: tokens.endAt(cursor) }
  }
}

function drawsAsPlainText(row: EditorViewSnapshot['visibleRows'][number]): boolean {
  if (row.mountedPaintSupport !== 'replayable') return false
  return row.chunks.every(
    (chunk) =>
      chunk.mountedPaint.kind === 'replayable' &&
      chunk.mountedPaint.parts.every((part) => part.kind === 'text'),
  )
}

/** Fresh colours for a frame's pieces from a later token pass, by offset. */
export function recolorFrame(frame: MorphFrame, tokens: Tokens): (string | undefined)[] {
  const styleAt = tokenStyleLookup(tokens)
  return frame.pieces.map((piece) => styleAt(piece.offset).style?.color)
}
