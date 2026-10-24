import type {
  Anchor as AnchorType,
  AnchorBias,
  Piece,
  PieceTableTreeSnapshot,
  RealAnchor,
  ResolvedAnchor,
} from './pieceTableTypes'
import { bufferLength } from './buffers'
import { splitsSurrogatePair } from './reads'
import { anchoredUnit, coversAnchorOffset, lookupReverseIndex } from './reverseIndex'
import {
  type AnchorLocation,
  findOriginalPiece,
  findPieceByOrder,
  findVisiblePieceContainingOffset,
  findVisiblePieceEndingAt,
  findVisiblePieceStartingAt,
  flattenNodes,
  newerVisibleLengthAfter,
  newerVisibleLengthBefore,
} from './tree'
import { isStandIn, ORIGINAL_BUFFER } from './node'

export const Anchor = {
  MIN: { kind: 'min' },
  MAX: { kind: 'max' },
} as const satisfies Record<'MIN' | 'MAX', AnchorType>

const anchorFromLocation = (
  location: AnchorLocation,
  offset: number,
  bias: AnchorBias,
): RealAnchor => {
  const pieceOffset = offset - location.visibleStart

  return {
    kind: 'anchor',
    buffer: location.piece.buffer,
    offset: location.piece.start + pieceOffset,
    bias,
  }
}

const anchorInEmptySnapshot = (snapshot: PieceTableTreeSnapshot, bias: AnchorBias): RealAnchor => ({
  kind: 'anchor',
  buffer: snapshot.buffers.original,
  offset: 0,
  bias,
})

const findAnchorLocation = (
  snapshot: PieceTableTreeSnapshot,
  offset: number,
  bias: AnchorBias,
): AnchorLocation | null => {
  const interior = findVisiblePieceContainingOffset(snapshot.root, offset)
  if (interior) return interior

  const left = findVisiblePieceEndingAt(snapshot.root, offset)
  const right = findVisiblePieceStartingAt(snapshot.root, offset)

  if (bias === 'left') return left ?? right
  return right ?? left
}

const resolveAt = (anchor: RealAnchor, location: AnchorLocation, edge: number): ResolvedAnchor => {
  const piece = location.piece
  if (!piece.visible) return { offset: edge, liveness: 'deleted' }
  return {
    offset: location.visibleStart + Math.min(anchor.offset - piece.start, piece.length),
    liveness: 'live',
  }
}

// Bias picks the side of whatever arrived in a deleted piece's gap since.
const deletedEdge = (
  snapshot: PieceTableTreeSnapshot,
  anchor: RealAnchor,
  location: AnchorLocation,
): number => {
  const { order, buffer } = location.piece
  if (anchor.bias === 'left') {
    return location.visibleStart - newerVisibleLengthBefore(snapshot.root, order, buffer)
  }
  return location.visibleStart + newerVisibleLengthAfter(snapshot.root, order, buffer)
}

const resolveMissingAnchor = (
  snapshot: PieceTableTreeSnapshot,
  anchor: RealAnchor,
): ResolvedAnchor => {
  const originalLength = bufferLength(snapshot.buffers, snapshot.buffers.original)
  const isEmptyOriginalAnchor =
    originalLength === 0 && anchor.buffer === snapshot.buffers.original && anchor.offset === 0

  if (isEmptyOriginalAnchor) {
    return {
      offset: anchor.bias === 'left' ? 0 : snapshot.length,
      liveness: 'live',
    }
  }

  return { offset: 0, liveness: 'deleted' }
}

// The original buffer's pieces are found through the sequence tree alone; an
// inserted buffer's through the index, which gives the order to descend by.
const locateAnchor = (
  snapshot: PieceTableTreeSnapshot,
  anchor: RealAnchor,
): AnchorLocation | null => {
  const unit = anchoredUnit(anchor.offset, anchor.bias)
  if (anchor.buffer === ORIGINAL_BUFFER) {
    // An anchor at the original text's end holds its last unit under either bias.
    const total = snapshot.root ? snapshot.root.subtreeOriginalLength : 0
    return total === 0 ? null : findOriginalPiece(snapshot.root, Math.min(unit, total - 1))
  }

  const order = lookupReverseIndex(snapshot.reverseIndex, anchor.buffer, unit)
  return order === undefined ? null : findPieceByOrder(snapshot.root, order)
}

// Only an entry of a compacted tombstone leads to a stand-in, and the stand-in
// resolves every anchor that was in it.
const holdsAnchor = (location: AnchorLocation | null, anchor: RealAnchor): boolean => {
  if (location === null) return false
  if (isStandIn(location.piece)) return true
  return (
    location.piece.buffer === anchor.buffer && coversAnchorOffset(location.piece, anchor.offset)
  )
}

const covers = (piece: Piece, anchor: RealAnchor): boolean =>
  !isStandIn(piece) && piece.buffer === anchor.buffer && coversAnchorOffset(piece, anchor.offset)

// A compacted anchor's piece is gone; the index is the only record of its stand-in.
const findStandInIndex = (
  snapshot: PieceTableTreeSnapshot,
  pieces: readonly Piece[],
  anchor: RealAnchor,
): number => {
  if (anchor.buffer === ORIGINAL_BUFFER) return -1
  const unit = anchoredUnit(anchor.offset, anchor.bias)
  const order = lookupReverseIndex(snapshot.reverseIndex, anchor.buffer, unit)
  return pieces.findIndex((piece) => isStandIn(piece) && piece.order === order)
}

const findLinearAnchorIndex = (
  snapshot: PieceTableTreeSnapshot,
  pieces: readonly Piece[],
  anchor: RealAnchor,
): number => {
  // A neighbouring piece of the same buffer can still cover a compacted
  // anchor's offset at its end, so the stand-in is asked first.
  const standIn = findStandInIndex(snapshot, pieces, anchor)
  if (standIn >= 0) return standIn
  const preferred =
    anchor.bias === 'left'
      ? pieces.findLastIndex((piece) => covers(piece, anchor) && piece.start < anchor.offset)
      : pieces.findIndex((piece) => covers(piece, anchor) && piece.start === anchor.offset)
  if (preferred >= 0) return preferred
  return pieces.findIndex((piece) => covers(piece, anchor))
}

const visibleLength = (piece: Piece): number => (piece.visible ? piece.length : 0)

// The gap rule of newerVisibleLengthBefore and After, read off a flat list.
const linearDeletedEdge = (pieces: readonly Piece[], at: number, anchor: RealAnchor): number => {
  const buffer = pieces[at]!.buffer
  let edge = 0
  for (let index = 0; index < at; index += 1) edge += visibleLength(pieces[index]!)
  if (anchor.bias === 'left') {
    for (let index = at - 1; index >= 0 && pieces[index]!.buffer > buffer; index -= 1) {
      edge -= visibleLength(pieces[index]!)
    }
    return edge
  }
  for (let index = at + 1; index < pieces.length && pieces[index]!.buffer > buffer; index += 1) {
    edge += visibleLength(pieces[index]!)
  }
  return edge
}

export const anchorAt = (
  snapshot: PieceTableTreeSnapshot,
  offset: number,
  bias: AnchorBias,
): RealAnchor => {
  if (offset < 0 || offset > snapshot.length) {
    throw new RangeError('invalid offset')
  }

  // A stray offset from outside — an LSP position, a plugin — should degrade to
  // the start of the code point it lands inside rather than crash the editor.
  const from = splitsSurrogatePair(snapshot, offset) ? offset - 1 : offset

  const location = findAnchorLocation(snapshot, from, bias)
  if (!location) return anchorInEmptySnapshot(snapshot, bias)

  return anchorFromLocation(location, from, bias)
}

export const anchorBefore = (snapshot: PieceTableTreeSnapshot, offset: number): RealAnchor =>
  anchorAt(snapshot, offset, 'left')

export const anchorAfter = (snapshot: PieceTableTreeSnapshot, offset: number): RealAnchor =>
  anchorAt(snapshot, offset, 'right')

// The reference: no index, no summaries, one pass over the pieces in order.
export const resolveAnchorLinear = (
  snapshot: PieceTableTreeSnapshot,
  anchor: AnchorType,
): ResolvedAnchor => {
  if (anchor.kind === 'min') return { offset: 0, liveness: 'live' }
  if (anchor.kind === 'max') return { offset: snapshot.length, liveness: 'live' }

  const pieces = flattenNodes(snapshot.root, []).map((node) => node.piece)
  const at = findLinearAnchorIndex(snapshot, pieces, anchor)
  if (at < 0) return resolveMissingAnchor(snapshot, anchor)

  let visibleStart = 0
  for (let index = 0; index < at; index += 1) visibleStart += visibleLength(pieces[index]!)
  const location = { piece: pieces[at]!, visibleStart }
  return resolveAt(anchor, location, linearDeletedEdge(pieces, at, anchor))
}

export const resolveAnchor = (
  snapshot: PieceTableTreeSnapshot,
  anchor: AnchorType,
): ResolvedAnchor => {
  if (anchor.kind === 'min') return { offset: 0, liveness: 'live' }
  if (anchor.kind === 'max') return { offset: snapshot.length, liveness: 'live' }

  const location = locateAnchor(snapshot, anchor)
  if (!location || !holdsAnchor(location, anchor)) return resolveMissingAnchor(snapshot, anchor)
  if (location.piece.visible) return resolveAt(anchor, location, 0)
  return resolveAt(anchor, location, deletedEdge(snapshot, anchor, location))
}

export const compareAnchors = (
  snapshot: PieceTableTreeSnapshot,
  left: AnchorType,
  right: AnchorType,
): number => {
  const leftResolved = resolveAnchor(snapshot, left)
  const rightResolved = resolveAnchor(snapshot, right)

  if (leftResolved.offset !== rightResolved.offset)
    return leftResolved.offset - rightResolved.offset
  if (left.kind !== 'anchor' || right.kind !== 'anchor') return 0
  if (left.bias === right.bias) return 0
  return left.bias === 'left' ? -1 : 1
}
