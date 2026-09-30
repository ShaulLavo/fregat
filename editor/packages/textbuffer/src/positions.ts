import type {
  Piece,
  PieceTableBuffers,
  PieceTableTreeSnapshot,
  PieceTreeNode,
  Point,
} from './pieceTableTypes'
import { countPieceLineBreaksBefore, pieceLineBreakOffsets } from './buffers'
import {
  getPieceVisibleLength,
  getPieceVisibleLineBreaks,
  getSubtreeLineBreaks,
  getSubtreeVisibleLength,
} from './node'

const countPiecePrefixLineBreaks = (
  buffers: PieceTableBuffers,
  piece: Piece,
  prefixLength: number,
): number => {
  if (!piece.visible || prefixLength <= 0 || piece.lineBreaks === 0) return 0
  if (prefixLength >= piece.length) return piece.lineBreaks

  return countPieceLineBreaksBefore(buffers, piece, prefixLength)
}

const findOffsetAfterPieceLineBreak = (
  buffers: PieceTableBuffers,
  piece: Piece,
  lineBreakOrdinal: number,
): number =>
  pieceLineBreakOffsets(buffers, piece)[piece.firstLineBreak + lineBreakOrdinal - 1]! -
  piece.start +
  1

// Counts the line breaks before `offset` and, in the same descent, records the
// offset the resulting row starts at into `lineStart` — the column then falls
// out as `offset - lineStart` with no second descent. `lineStart` stays null
// only when the last break before `offset` sits in a subtree this descent never
// entered, i.e. when `offset` lands on the first line of the piece it falls in.
const findRowAtOffset = (
  node: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  offset: number,
  baseOffset: number,
  lineStart: { value: number | null },
): number => {
  if (!node || offset <= 0) return 0

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeLen = getPieceVisibleLength(node.piece)
  const nodeEnd = leftLen + nodeLen

  if (offset <= leftLen) return findRowAtOffset(node.left, buffers, offset, baseOffset, lineStart)

  const leftLineBreaks = getSubtreeLineBreaks(node.left)
  if (offset <= nodeEnd) {
    const prefixLineBreaks = countPiecePrefixLineBreaks(buffers, node.piece, offset - leftLen)
    if (prefixLineBreaks > 0) {
      lineStart.value =
        baseOffset + leftLen + findOffsetAfterPieceLineBreak(buffers, node.piece, prefixLineBreaks)
    }

    return leftLineBreaks + prefixLineBreaks
  }

  const pieceLineBreaks = getPieceVisibleLineBreaks(node.piece)
  const tailRow = findRowAtOffset(
    node.right,
    buffers,
    offset - nodeEnd,
    baseOffset + nodeEnd,
    lineStart,
  )
  // Only the *last* break before `offset` names the row start, so this piece
  // answers just when nothing after it held one.
  if (tailRow === 0 && pieceLineBreaks > 0) {
    lineStart.value =
      baseOffset + leftLen + findOffsetAfterPieceLineBreak(buffers, node.piece, pieceLineBreaks)
  }

  return leftLineBreaks + pieceLineBreaks + tailRow
}

// The augmented `subtreeLineBreaks` counts pick the branch, so a whole left
// subtree is skipped in one comparison rather than walked. `lineBreakOrdinal` is
// 1-based, and null means the subtree holds fewer breaks than that.
const findOffsetAfterLineBreak = (
  node: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  lineBreakOrdinal: number,
  baseOffset = 0,
): number | null => {
  if (!node || lineBreakOrdinal <= 0) return null

  const leftLineBreaks = getSubtreeLineBreaks(node.left)
  const leftLength = getSubtreeVisibleLength(node.left)

  if (lineBreakOrdinal <= leftLineBreaks) {
    return findOffsetAfterLineBreak(node.left, buffers, lineBreakOrdinal, baseOffset)
  }

  const remainingAfterLeft = lineBreakOrdinal - leftLineBreaks
  const pieceLineBreaks = getPieceVisibleLineBreaks(node.piece)
  if (remainingAfterLeft <= pieceLineBreaks) {
    return (
      baseOffset +
      leftLength +
      findOffsetAfterPieceLineBreak(buffers, node.piece, remainingAfterLeft)
    )
  }

  return findOffsetAfterLineBreak(
    node.right,
    buffers,
    remainingAfterLeft - pieceLineBreaks,
    baseOffset + leftLength + getPieceVisibleLength(node.piece),
  )
}

export const lineStartOffset = (snapshot: PieceTableTreeSnapshot, row: number): number => {
  if (row <= 0) return 0

  const offset = findOffsetAfterLineBreak(snapshot.root, snapshot.buffers, row)
  return offset ?? snapshot.length
}

// Out-parameter of findLineRange, so a lookup allocates nothing. `piece` is
// the piece holding the whole row, at visible offset `pieceOffset`, or null
// when the row spans pieces.
export type LineRangeResult = {
  start: number
  end: number
  piece: Piece | null
  pieceOffset: number
}

// The row ends at this piece's first break. `out.start` is already set, and a
// piece that starts at or before it holds the whole row.
const endAtFirstPieceBreak = (
  buffers: PieceTableBuffers,
  piece: Piece,
  pieceOffset: number,
  out: LineRangeResult,
): void => {
  const lineBreak = pieceLineBreakOffsets(buffers, piece)[piece.firstLineBreak]!
  out.end = pieceOffset + lineBreak - piece.start
  if (pieceOffset > out.start) return
  out.piece = piece
  out.pieceOffset = pieceOffset
}

// The row ends at the first break of a subtree that holds one.
const endAtFirstSubtreeBreak = (
  subtree: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  baseOffset: number,
  out: LineRangeResult,
): void => {
  let node = subtree
  let base = baseOffset
  while (node) {
    if (getSubtreeLineBreaks(node.left) > 0) {
      node = node.left
      continue
    }
    const pieceOffset = base + getSubtreeVisibleLength(node.left)
    if (getPieceVisibleLineBreaks(node.piece) > 0) {
      return endAtFirstPieceBreak(buffers, node.piece, pieceOffset, out)
    }
    base = pieceOffset + getPieceVisibleLength(node.piece)
    node = node.right
  }

  throw new Error('line break not found in subtree')
}

// The break after the landing piece's last one: in the landing's right
// subtree, else at the nearest ancestor the descent turned left at that has a
// break in its piece or to its right. Tombstones count for nothing here.
const endAfterLanding = (
  snapshot: PieceTableTreeSnapshot,
  landing: PieceTreeNode,
  landingEnd: number,
  turn: PieceTreeNode | null,
  turnOffset: number,
  out: LineRangeResult,
): void => {
  const buffers = snapshot.buffers
  if (getSubtreeLineBreaks(landing.right) > 0) {
    return endAtFirstSubtreeBreak(landing.right, buffers, landingEnd, out)
  }
  if (!turn) {
    out.end = snapshot.length
    return
  }
  if (getPieceVisibleLineBreaks(turn.piece) > 0) {
    return endAtFirstPieceBreak(buffers, turn.piece, turnOffset, out)
  }
  const turnEnd = turnOffset + getPieceVisibleLength(turn.piece)
  endAtFirstSubtreeBreak(turn.right, buffers, turnEnd, out)
}

// Both ends of a row from one descent: to the piece holding the break before
// the row, whose next break is in the same piece or the first one after it.
export const findLineRange = (
  snapshot: PieceTableTreeSnapshot,
  requestedRow: number,
  out: LineRangeResult,
): void => {
  const row = Math.max(0, requestedRow)
  const buffers = snapshot.buffers
  out.piece = null
  out.pieceOffset = 0
  out.start = 0
  if (row > getSubtreeLineBreaks(snapshot.root)) {
    out.start = snapshot.length
    out.end = snapshot.length
    return
  }
  if (row === 0) {
    if (getSubtreeLineBreaks(snapshot.root) === 0) out.end = snapshot.length
    else endAtFirstSubtreeBreak(snapshot.root, buffers, 0, out)
    return
  }

  let node = snapshot.root
  let base = 0
  let ordinal = row
  let turn: PieceTreeNode | null = null
  let turnOffset = 0
  while (node) {
    const leftLineBreaks = getSubtreeLineBreaks(node.left)
    const pieceOffset = base + getSubtreeVisibleLength(node.left)
    if (ordinal <= leftLineBreaks) {
      if (node.subtreeLineBreaks > leftLineBreaks) {
        turn = node
        turnOffset = pieceOffset
      }
      node = node.left
      continue
    }

    const piece = node.piece
    const pieceLineBreaks = getPieceVisibleLineBreaks(piece)
    const local = ordinal - leftLineBreaks
    if (local > pieceLineBreaks) {
      ordinal = local - pieceLineBreaks
      base = pieceOffset + getPieceVisibleLength(piece)
      node = node.right
      continue
    }

    const offsets = pieceLineBreakOffsets(buffers, piece)
    const at = piece.firstLineBreak + local
    out.start = pieceOffset + offsets[at - 1]! - piece.start + 1
    if (local === pieceLineBreaks) {
      return endAfterLanding(snapshot, node, pieceOffset + piece.length, turn, turnOffset, out)
    }
    out.end = pieceOffset + offsets[at]! - piece.start
    out.piece = piece
    out.pieceOffset = pieceOffset
    return
  }

  throw new Error('line break not found in tree')
}

// Offsets of a row's first unit and of the break that ends it, or the
// document's end for the last row. A row past the end is empty, at the end.
export const lineRange = (
  snapshot: PieceTableTreeSnapshot,
  row: number,
): { start: number; end: number } => {
  const range: LineRangeResult = { start: 0, end: 0, piece: null, pieceOffset: 0 }
  findLineRange(snapshot, row, range)
  return { start: range.start, end: range.end }
}

export const offsetToPoint = (snapshot: PieceTableTreeSnapshot, offset: number): Point => {
  if (offset < 0 || offset > snapshot.length) {
    throw new RangeError('invalid offset')
  }

  const lineStart: { value: number | null } = { value: null }
  const row = findRowAtOffset(snapshot.root, snapshot.buffers, offset, 0, lineStart)

  return { row, column: offset - (lineStart.value ?? lineStartOffset(snapshot, row)) }
}

export const pointToOffset = (snapshot: PieceTableTreeSnapshot, point: Point): number => {
  const column = Math.max(0, point.column)
  const range: LineRangeResult = { start: 0, end: 0, piece: null, pieceOffset: 0 }
  findLineRange(snapshot, point.row, range)
  return Math.min(range.start + column, range.end)
}
