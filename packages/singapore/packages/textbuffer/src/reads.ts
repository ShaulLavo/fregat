import type {
  Piece,
  PieceTableBuffers,
  PieceTableTreeSnapshot,
  PieceTreeNode,
} from './pieceTableTypes'
import { bufferUnitAt, readBufferRange } from './buffers'
import { collectTextInRange, forEachTextInRange } from './tree'
import { getPieceVisibleLength, getSubtreeVisibleLength } from './node'
import { createPieceTableWalker } from './walker'
import { findLineRange, type LineRangeResult } from './positions'
import { isHighSurrogate, isLowSurrogate } from './surrogates'

export const getPieceTableLength = (snapshot: PieceTableTreeSnapshot): number => snapshot.length

export const ensureValidRange = (snapshot: PieceTableTreeSnapshot, start: number, end: number) => {
  if (start < 0 || end < start || end > snapshot.length) {
    throw new RangeError('invalid range')
  }
}

export const readPieceTableTextRange = (
  snapshot: PieceTableTreeSnapshot,
  start: number,
  end: number,
): string => {
  ensureValidRange(snapshot, start, end)
  if (start === end) return ''

  const chunks: string[] = []
  collectTextInRange(snapshot.root, snapshot.buffers, start, end, chunks)
  return chunks.join('')
}

// A row's text without its line break. One descent finds both ends; a row
// inside one piece, which most are, is sliced straight from that piece's chunk.
export const readPieceTableLine = (snapshot: PieceTableTreeSnapshot, row: number): string => {
  const range: LineRangeResult = { start: 0, end: 0, piece: null, pieceOffset: 0 }
  findLineRange(snapshot, row, range)
  if (range.start === range.end) return ''

  const piece = range.piece
  if (!piece) return readPieceTableTextRange(snapshot, range.start, range.end)
  const from = piece.start - range.pieceOffset
  return readBufferRange(snapshot.buffers, piece.buffer, from + range.start, from + range.end)
}

export { isHighSurrogate, isLowSurrogate } from './surrogates'

// Iterative descent to the visible piece holding `offset`, reading the unit
// straight out of that piece's chunk, so no string is built. Past the end it
// answers -1.
export const codeUnitAt = (
  root: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  offset: number,
): number => {
  let node = root
  let base = 0

  while (node) {
    const pieceStart = base + getSubtreeVisibleLength(node.left)
    if (offset < pieceStart) {
      node = node.left
      continue
    }

    const pieceEnd = pieceStart + getPieceVisibleLength(node.piece)
    if (offset < pieceEnd) {
      return bufferUnitAt(buffers, node.piece.buffer, node.piece.start + offset - pieceStart)
    }

    base = pieceEnd
    node = node.right
  }

  return -1
}

// A surrogate half is only identifiable by its neighbour: a low surrogate is
// legitimate text when a high one precedes it. The document's own ends are
// never inside a pair, so they answer false without a read. The unit after
// the offset is read first: while typing, the unit before it is the last one
// of the tail chunk, and touching that flattens the string extendTail just
// concatenated, so it is read only when the unit after is a low half.
// One descent: the unit before the offset is in the same piece unless the
// offset is the piece's first unit, and only then is a second descent needed.
export const splitsSurrogatePair = (snapshot: PieceTableTreeSnapshot, offset: number): boolean => {
  if (offset <= 0 || offset >= snapshot.length) return false
  if (!snapshot.buffers.containsSurrogates) return false

  let node = snapshot.root
  let base = 0
  while (node) {
    const pieceStart = base + getSubtreeVisibleLength(node.left)
    if (offset < pieceStart) {
      node = node.left
      continue
    }

    const pieceEnd = pieceStart + getPieceVisibleLength(node.piece)
    if (offset < pieceEnd) {
      const at = node.piece.start + offset - pieceStart
      if (!isLowSurrogate(bufferUnitAt(snapshot.buffers, node.piece.buffer, at))) return false
      if (offset > pieceStart)
        return isHighSurrogate(bufferUnitAt(snapshot.buffers, node.piece.buffer, at - 1))
      return isHighSurrogate(codeUnitAt(snapshot.root, snapshot.buffers, offset - 1))
    }

    base = pieceEnd
    node = node.right
  }

  return false
}

export const materializePieceTableFullText = (snapshot: PieceTableTreeSnapshot): string =>
  readPieceTableTextRange(snapshot, 0, snapshot.length)

export const streamPieceTableTextChunks = (
  snapshot: PieceTableTreeSnapshot,
  visit: (text: string, start: number, end: number) => void,
  start = 0,
  end?: number,
): void => {
  const effectiveEnd = end ?? snapshot.length
  ensureValidRange(snapshot, start, effectiveEnd)
  if (start === effectiveEnd) return
  let offset = start
  forEachTextInRange(snapshot.root, snapshot.buffers, start, effectiveEnd, (buffer, from, to) => {
    const text = buffer.slice(from, to)
    const nextOffset = offset + text.length
    visit(text, offset, nextOffset)
    offset = nextOffset
  })
}

export type PieceTablePieceStreamEntry = {
  readonly piece: Piece
  readonly text: string
  readonly start: number
  readonly end: number
}

export const streamPieceTablePieces = (
  snapshot: PieceTableTreeSnapshot,
  visit: (entry: PieceTablePieceStreamEntry) => void,
  start = 0,
  end?: number,
): void => {
  const effectiveEnd = end ?? snapshot.length
  ensureValidRange(snapshot, start, effectiveEnd)
  if (start === effectiveEnd) return
  streamPieces(snapshot.root, snapshot, visit, start, effectiveEnd)
}

export const pieceTableSnapshotsHaveSameText = (
  left: PieceTableTreeSnapshot,
  right: PieceTableTreeSnapshot,
): boolean => {
  if (left === right) return true
  if (left.length !== right.length) return false
  if (left.length === 0) return true
  // Same tree implies same text: buffers only ever grow by appending, so the
  // windows existing pieces read from are stable across snapshots.
  if (left.root === right.root) return true

  const leftWalker = createPieceTableWalker(left)
  const rightWalker = createPieceTableWalker(right)

  for (;;) {
    const leftChunk = leftWalker.chunk()
    const rightChunk = rightWalker.chunk()
    if (!leftChunk || !rightChunk) return !leftChunk && !rightChunk

    const length = Math.min(leftChunk.end - leftChunk.start, rightChunk.end - rightChunk.start)
    const leftText =
      leftChunk.text.length === length ? leftChunk.text : leftChunk.text.slice(0, length)
    const rightText =
      rightChunk.text.length === length ? rightChunk.text : rightChunk.text.slice(0, length)
    if (leftText !== rightText) return false

    leftWalker.skip(length)
    rightWalker.skip(length)
  }
}

const streamPieces = (
  node: PieceTableTreeSnapshot['root'],
  snapshot: PieceTableTreeSnapshot,
  visit: (entry: PieceTablePieceStreamEntry) => void,
  start: number,
  end: number,
  baseOffset = 0,
): void => {
  if (!node || baseOffset >= end) return

  const leftLength = node.left?.subtreeVisibleLength ?? 0
  const pieceLength = node.piece.visible ? node.piece.length : 0
  const pieceStart = baseOffset + leftLength
  const pieceEnd = pieceStart + pieceLength

  if (start < pieceStart) streamPieces(node.left, snapshot, visit, start, end, baseOffset)
  streamCurrentPiece(node.piece, snapshot, visit, start, end, pieceStart, pieceEnd)
  if (end > pieceEnd) streamPieces(node.right, snapshot, visit, start, end, pieceEnd)
}

const streamCurrentPiece = (
  piece: Piece,
  snapshot: PieceTableTreeSnapshot,
  visit: (entry: PieceTablePieceStreamEntry) => void,
  start: number,
  end: number,
  pieceStart: number,
  pieceEnd: number,
): void => {
  if (!piece.visible || pieceEnd <= start || pieceStart >= end) return

  const localStart = Math.max(0, start - pieceStart)
  const localEnd = Math.min(piece.length, end - pieceStart)
  if (localEnd <= localStart) return

  visit({
    piece,
    text: readBufferRange(
      snapshot.buffers,
      piece.buffer,
      piece.start + localStart,
      piece.start + localEnd,
    ),
    start: pieceStart + localStart,
    end: pieceStart + localEnd,
  })
}
