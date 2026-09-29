import type { TextPageOwner } from './textPages'
import type { Piece, PieceBufferId, PieceTableBuffers, PieceTreeNode } from './pieceTableTypes'
import type { EditContext, HideSnap, InsertContext, InsertProbe } from './internalTypes'
import {
  appendChunksToBuffers,
  BUFFER_CHUNK_SIZE,
  forEachBufferSpan,
  bufferUnitAt,
  countLineBreaks,
  countPieceLineBreaksBefore,
  getBufferText,
  isNewestBuffer,
} from './buffers'
import { isHighSurrogate, isLowSurrogate, mendsCutAtEnd, mendsCutAtStart } from './surrogates'
import {
  allocateOrderBetween,
  assignPieceOrders,
  PIECE_ORDER_MIN_GAP,
  PIECE_ORDER_STEP,
} from './orders'
import { join } from './join'
import {
  createNode,
  getPieceVisibleLength,
  firstOrder,
  lastOrder,
  getSubtreeVisibleLength,
  ORIGINAL_BUFFER,
  own,
  PERSISTENT_EPOCH,
  summarize,
} from './node'

// The piece extended by the probe's text, or null when it cannot take it:
// only the newest buffer's piece, ending at its chunk's end, with room left.
const coalescedPiece = (
  buffers: PieceTableBuffers,
  piece: Piece,
  probe: InsertProbe,
): Piece | null => {
  if (piece.buffer === buffers.original) return null
  if (!isNewestBuffer(buffers, piece.buffer)) return null
  const chunkText = getBufferText(buffers, piece.buffer)
  if (piece.start + piece.length !== chunkText.length) return null
  if (chunkText.length + probe.text.length > BUFFER_CHUNK_SIZE) return null
  probe.lineBreaks = countLineBreaks(probe.text)
  return {
    ...piece,
    length: piece.length + probe.text.length,
    lineBreaks: piece.lineBreaks + probe.lineBreaks,
  }
}

// The collapsed-edit rule of snapEditToCodePoints: inserting between the
// halves of a pair moves before it unless the text starts with a low half
// and ends with a high one, so that both cuts are mended.
const insertSplitsPair = (before: number, after: number, probe: InsertProbe): boolean => {
  if (!isLowSurrogate(after) || !isHighSurrogate(before)) return false
  const text = probe.text
  return !isLowSurrogate(text.charCodeAt(0)) || !isHighSurrogate(text.charCodeAt(text.length - 1))
}

const firstUnitOf = (piece: Piece, buffers: PieceTableBuffers): number =>
  bufferUnitAt(buffers, piece.buffer, piece.start)

const lastUnitOf = (piece: Piece, buffers: PieceTableBuffers): number =>
  bufferUnitAt(buffers, piece.buffer, piece.start + piece.length - 1)

const firstVisibleUnit = (node: PieceTreeNode | null, buffers: PieceTableBuffers): number => {
  const location = findVisiblePieceStartingAt(node, 0)
  return location ? firstUnitOf(location.piece, buffers) : -1
}

// The first visible unit after a landing: in its right subtree, else in the
// nearest ancestor the descent turned left at, or that ancestor's right side.
const successorUnit = (
  right: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  probe: InsertProbe,
): number => {
  const below = firstVisibleUnit(right, buffers)
  if (below >= 0) return below
  for (let index = probe.leftTurns.length - 1; index >= 0; index -= 1) {
    const ancestor = probe.leftTurns[index]!
    if (getPieceVisibleLength(ancestor.piece) > 0) return firstUnitOf(ancestor.piece, buffers)
    const beside = firstVisibleUnit(ancestor.right, buffers)
    if (beside >= 0) return beside
  }
  return -1
}

// Each landing probe returns a finished subtree, or null to insert here.
// Landing with the offset at this node's end: this piece is the one ending here.
const probeAtEnd = (
  node: PieceTreeNode,
  buffers: PieceTableBuffers,
  epoch: number,
  probe: InsertProbe,
): PieceTreeNode | null => {
  if (probe.snap) {
    const after = successorUnit(node.right, buffers, probe)
    if (isLowSurrogate(after) && insertSplitsPair(lastUnitOf(node.piece, buffers), after, probe)) {
      probe.outcome = 'retry'
      return node
    }
  }

  const tail = coalescedPiece(buffers, node.piece, probe)
  if (!tail) return null

  probe.outcome = 'coalesce'
  const next = own(node, epoch)
  next.piece = tail
  return summarize(next)
}

// Landing strictly inside this piece: both units are in its chunk, and a
// pair split moves the offset one unit left within the same piece.
const probeInside = (
  node: PieceTreeNode,
  localOffset: number,
  buffers: PieceTableBuffers,
  probe: InsertProbe,
): number => {
  if (!probe.snap) return localOffset
  const at = node.piece.start + localOffset
  const after = bufferUnitAt(buffers, node.piece.buffer, at)
  if (!isLowSurrogate(after)) return localOffset
  const before = bufferUnitAt(buffers, node.piece.buffer, at - 1)
  return insertSplitsPair(before, after, probe) ? localOffset - 1 : localOffset
}

// What a landing's probe decided: a finished subtree (a coalesce, or the
// node untouched with the outcome set to retry), or the offset to cut at.
const probeLanding = (
  node: PieceTreeNode,
  offset: number,
  leftLen: number,
  nodeLen: number,
  buffers: PieceTableBuffers,
  epoch: number,
  probe: InsertProbe,
): PieceTreeNode | number => {
  if (nodeLen > 0 && offset === leftLen + nodeLen) {
    const probed = probeAtEnd(node, buffers, epoch, probe)
    if (probed) return probed
  }
  if (nodeLen > 0 && offset > leftLen && offset < leftLen + nodeLen) {
    const localOffset = probeInside(node, offset - leftLen, buffers, probe)
    if (localOffset > 0) return leftLen + localOffset
    // The pair opens the piece, so the text belongs after whatever visible
    // piece ends there; a retry one unit left descends to it.
    probe.outcome = 'retry'
    return node
  }
  return offset
}

// The right-hand piece of a cut, ordered between the piece it came from and
// whatever follows it. The piece already knows its total line breaks, so one
// count for the left half gives both.
const orderAfter = (order: number, upper: number | null, context: EditContext): number => {
  const allocated = allocateOrderBetween(order, upper)
  context.normalizeOrders ||= allocated === null
  return allocated ?? order + PIECE_ORDER_MIN_GAP
}

// `breaksBefore` is the piece's line breaks ahead of `from`, which places the
// slice's own breaks in the chunk's line index.
const slicePiece = (
  piece: Piece,
  from: number,
  to: number,
  order: number,
  breaksBefore: number,
  lineBreaks: number,
  visible: boolean,
): Piece => ({
  buffer: piece.buffer,
  start: piece.start + from,
  length: to - from,
  order,
  lineBreaks,
  firstLineBreak: piece.firstLineBreak + breaksBefore,
  visible,
})

// A piece with no line breaks has none on either side of a cut.
const lineBreaksBefore = (
  buffers: PieceTableBuffers,
  piece: Piece,
  prefixLength: number,
): number => (piece.lineBreaks === 0 ? 0 : countPieceLineBreaksBefore(buffers, piece, prefixLength))

const appendRun = (
  tree: PieceTreeNode | null,
  pieces: readonly Piece[],
  epoch: number,
): PieceTreeNode | null => {
  let next = tree
  for (const piece of pieces) next = join(next, createNode(piece, null, null, epoch), null, epoch)
  return next
}

const prependRun = (
  pieces: readonly Piece[],
  tree: PieceTreeNode | null,
  epoch: number,
): PieceTreeNode | null => {
  let next = tree
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    next = join(null, createNode(pieces[index]!, null, null, epoch), next, epoch)
  }
  return next
}

// The pieces for an insert's text, made once the landing rules out a
// coalesce, ordered between the landing's neighbours.
const piecesForInsert = (
  buffers: PieceTableBuffers,
  context: InsertContext,
  lower: number | null,
  upper: number | null,
): readonly Piece[] => {
  const appended = appendChunksToBuffers(buffers, context.probe.text)
  const ordered = assignPieceOrders(appended.pieces, lower, upper)
  context.appendedBuffers = appended.buffers
  context.normalizeOrders ||= ordered.normalizeOrders
  return ordered.pieces
}

// Insert in one descent: no split and no merge. The landing places the new
// pieces beside or inside its piece and every ancestor rejoins once, which
// rebalances in constant work per level.
export const insertAtVisibleOffset = (
  node: PieceTreeNode | null,
  offset: number,
  buffers: PieceTableBuffers,
  context: InsertContext,
  epoch: number,
  lowerOrder: number | null = null,
  upperOrder: number | null = null,
): PieceTreeNode | null => {
  if (!node) {
    const pieces = piecesForInsert(buffers, context, lowerOrder, upperOrder)
    for (const piece of pieces) context.changes.push(piece)
    return appendRun(null, pieces, epoch)
  }

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeLen = getPieceVisibleLength(node.piece)

  // Text lands right after the last visible piece ending at the offset, so it
  // never goes between two tombstones and where it lands does not depend on
  // the tree's shape. Deleted anchors read their gap from that order.
  if (offset < leftLen || (offset === leftLen && node.left)) {
    context.probe.leftTurns.push(node)
    const left = insertAtVisibleOffset(
      node.left,
      offset,
      buffers,
      context,
      epoch,
      lowerOrder,
      node.piece.order,
    )
    return rejoinAfterInsert(node, 'left', left, context.probe, epoch)
  }

  if (offset > leftLen + nodeLen) {
    const right = insertAtVisibleOffset(
      node.right,
      offset - leftLen - nodeLen,
      buffers,
      context,
      epoch,
      node.piece.order,
      upperOrder,
    )
    return rejoinAfterInsert(node, 'right', right, context.probe, epoch)
  }

  const probed = probeLanding(node, offset, leftLen, nodeLen, buffers, epoch, context.probe)
  if (typeof probed !== 'number') return probed
  return insertAtLanding(node, probed - leftLen, nodeLen, buffers, context, epoch, [
    lowerOrder,
    upperOrder,
  ])
}

const rejoinAfterInsert = (
  node: PieceTreeNode,
  side: 'left' | 'right',
  subtree: PieceTreeNode | null,
  probe: InsertProbe,
  epoch: number,
): PieceTreeNode => {
  if (probe.outcome === 'retry') return node
  const next = own(node, epoch)
  if (probe.outcome === 'coalesce') {
    next[side] = subtree
    return summarize(next)
  }
  if (side === 'left') return join(subtree, next, next.right, epoch)
  return join(next.left, next, subtree, epoch)
}

const insertAtLanding = (
  node: PieceTreeNode,
  localOffset: number,
  nodeLen: number,
  buffers: PieceTableBuffers,
  context: InsertContext,
  epoch: number,
  bounds: readonly [number | null, number | null],
): PieceTreeNode => {
  const next = own(node, epoch)
  const piece = next.piece

  // Only the document's first piece is landed on at its start.
  if (localOffset === 0) {
    const lower = next.left ? lastOrder(next.left) : bounds[0]
    const pieces = piecesForInsert(buffers, context, lower, piece.order)
    for (const added of pieces) context.changes.push(added)
    return join(appendRun(next.left, pieces, epoch), next, next.right, epoch)
  }

  const upper = next.right ? firstOrder(next.right) : bounds[1]
  if (localOffset === nodeLen) {
    const pieces = piecesForInsert(buffers, context, piece.order, upper)
    for (const added of pieces) context.changes.push(added)
    return join(next.left, next, prependRun(pieces, next.right, epoch), epoch)
  }

  const leftLineBreaks = lineBreaksBefore(buffers, piece, localOffset)
  const leftPiece = slicePiece(piece, 0, localOffset, piece.order, 0, leftLineBreaks, piece.visible)
  const rightPiece = slicePiece(
    piece,
    localOffset,
    nodeLen,
    orderAfter(piece.order, upper, context),
    leftLineBreaks,
    piece.lineBreaks - leftLineBreaks,
    piece.visible,
  )
  const pieces = piecesForInsert(buffers, context, piece.order, rightPiece.order)
  next.piece = leftPiece
  context.changes.push(rightPiece)
  for (const added of pieces) context.changes.push(added)
  const right = prependRun(pieces, prependRun([rightPiece], next.right, epoch), epoch)
  return join(next.left, next, right, epoch)
}

const hideTree = (node: PieceTreeNode | null, epoch: number): PieceTreeNode | null => {
  if (!node || node.subtreeVisibleLength === 0) return node

  const next = own(node, epoch)
  next.left = hideTree(next.left, epoch)
  next.right = hideTree(next.right, epoch)
  if (next.piece.visible) next.piece = { ...next.piece, visible: false }
  return summarize(next)
}

// The pieces of a replacement's text, recorded and ready to place.
const placedPieces = (
  buffers: PieceTableBuffers,
  pending: InsertContext,
  lower: number | null,
  upper: number | null,
): readonly Piece[] => {
  const pieces = piecesForInsert(buffers, pending, lower, upper)
  for (const added of pieces) pending.changes.push(added)
  return pieces
}

// Hides [from, to) of an owned node's visible piece. The node keeps the first
// part, so its reverse-index key stands; later parts become its successors.
// A replacement's text goes where the hidden part begins.
const hidePieceRange = (
  next: PieceTreeNode,
  from: number,
  to: number,
  right: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  context: EditContext,
  epoch: number,
  upperOrder: number | null,
  pending: InsertContext | null,
): PieceTreeNode | null => {
  const piece = next.piece
  const length = piece.length
  if (from === 0 && to === length) {
    next.piece = { ...piece, visible: false }
    return right
  }

  const upper = right ? firstOrder(right) : upperOrder
  const breaksBeforeTo = to === length ? piece.lineBreaks : lineBreaksBefore(buffers, piece, to)
  const tail: Piece[] = []
  if (from === 0) {
    next.piece = slicePiece(piece, 0, to, piece.order, 0, breaksBeforeTo, false)
    tail.push(
      slicePiece(
        piece,
        to,
        length,
        orderAfter(piece.order, upper, context),
        breaksBeforeTo,
        piece.lineBreaks - breaksBeforeTo,
        true,
      ),
    )
  } else {
    const keptBreaks = lineBreaksBefore(buffers, piece, from)
    const hiddenOrder = orderAfter(piece.order, upper, context)
    next.piece = slicePiece(piece, 0, from, piece.order, 0, keptBreaks, true)
    tail.push(
      slicePiece(piece, from, to, hiddenOrder, keptBreaks, breaksBeforeTo - keptBreaks, false),
    )
    if (to < length) {
      tail.push(
        slicePiece(
          piece,
          to,
          length,
          orderAfter(hiddenOrder, upper, context),
          breaksBeforeTo,
          piece.lineBreaks - breaksBeforeTo,
          true,
        ),
      )
    }
  }

  for (const added of tail) context.changes.push(added)
  const after = prependRun(tail, right, epoch)
  if (!pending || from === 0) return after
  return prependRun(placedPieces(buffers, pending, piece.order, tail[0]!.order), after, epoch)
}

const lastVisibleUnit = (node: PieceTreeNode, buffers: PieceTableBuffers): number => {
  const location = findVisiblePieceEndingAt(node, node.subtreeVisibleLength)
  return location ? lastUnitOf(location.piece, buffers) : -1
}

// Where a cut that starts `cutFrom` units into a visible piece should start.
const snappedCutStart = (
  piece: Piece,
  cutFrom: number,
  buffers: PieceTableBuffers,
  snap: HideSnap,
): number => {
  const at = piece.start + cutFrom
  if (!isLowSurrogate(bufferUnitAt(buffers, piece.buffer, at)) || mendsCutAtStart(snap.text)) {
    return cutFrom
  }
  if (cutFrom === 0) {
    snap.retry = true
    return cutFrom
  }
  return isHighSurrogate(bufferUnitAt(buffers, piece.buffer, at - 1)) ? cutFrom - 1 : cutFrom
}

const snappedCutEnd = (
  piece: Piece,
  cutTo: number,
  buffers: PieceTableBuffers,
  snap: HideSnap,
): number => {
  const at = piece.start + cutTo
  if (!isHighSurrogate(bufferUnitAt(buffers, piece.buffer, at - 1)) || mendsCutAtEnd(snap.text)) {
    return cutTo
  }
  if (cutTo === piece.length) {
    snap.highAtPieceEnd = true
    return cutTo
  }
  return isLowSurrogate(bufferUnitAt(buffers, piece.buffer, at)) ? cutTo + 1 : cutTo
}

// A whole subtree is hidden without visiting its end pieces, so its two end
// units are read here. Both sit at a piece's edge.
const snapWholeSubtree = (
  node: PieceTreeNode,
  from: number,
  to: number,
  buffers: PieceTableBuffers,
  snap: HideSnap,
): void => {
  if (snap.start && from === 0 && !mendsCutAtStart(snap.text)) {
    snap.retry = isLowSurrogate(firstVisibleUnit(node, buffers))
  }
  if (snap.end && to === node.subtreeVisibleLength && !mendsCutAtEnd(snap.text)) {
    snap.highAtPieceEnd = isHighSurrogate(lastVisibleUnit(node, buffers))
  }
}

// Delete in one descent: tombstone the visible range [from, to) in place,
// cutting only the pieces its two ends fall inside. With `pending`, a
// replacement: its text is placed where the range began, on the same pass.
// `pending` travels down only the side that holds the range's first unit.
// `from` and `to` go down unclamped, so a node can tell the range's own ends
// from a subtree's: the first unit is here only if `from` is not negative.
export const hideVisibleRange = (
  node: PieceTreeNode | null,
  from: number,
  to: number,
  buffers: PieceTableBuffers,
  context: EditContext,
  epoch: number,
  pending: InsertContext | null = null,
  lowerOrder: number | null = null,
  upperOrder: number | null = null,
): PieceTreeNode | null => {
  if (!node || from >= to) return node
  const snap = context.snap
  // Not with `pending`: its text goes before the first unit hidden, after any
  // tombstones the subtree starts with, and only the descent finds that place.
  if (from <= 0 && to >= node.subtreeVisibleLength && !pending) {
    if (snap) snapWholeSubtree(node, from, to, buffers, snap)
    if (snap?.retry) return node
    return hideTree(node, epoch)
  }

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeEnd = leftLen + getPieceVisibleLength(node.piece)
  const order = node.piece.order
  const cuts = Math.max(from, leftLen) < Math.min(to, nodeEnd)
  let cutFrom = Math.max(from, leftLen) - leftLen
  let cutTo = Math.min(to, nodeEnd) - leftLen
  // The range's first unit is checked before the pass changes anything, so a
  // retry leaves every node as it was.
  if (snap?.start && cuts && from >= leftLen) {
    cutFrom = snappedCutStart(node.piece, cutFrom, buffers, snap)
    if (snap.retry) return node
  }

  const next = own(node, epoch)
  let left = next.left
  let right = next.right
  if (from < leftLen && leftLen > 0) {
    left = hideVisibleRange(left, from, to, buffers, context, epoch, pending, lowerOrder, order)
    if (snap?.retry) return node
  }
  if (to > nodeEnd) {
    const below = from >= nodeEnd ? pending : null
    right = hideVisibleRange(
      right,
      from - nodeEnd,
      to - nodeEnd,
      buffers,
      context,
      epoch,
      below,
      order,
      upperOrder,
    )
  }

  if (snap?.retry) return node
  if (!cuts) return join(left, next, right, epoch)

  if (snap?.end && to <= nodeEnd) cutTo = snappedCutEnd(next.piece, cutTo, buffers, snap)

  const here = from >= leftLen ? pending : null
  if (here && cutFrom === 0) {
    const lower = left ? lastOrder(left) : lowerOrder
    left = appendRun(left, placedPieces(buffers, here, lower, order), epoch)
  }
  right = hidePieceRange(next, cutFrom, cutTo, right, buffers, context, epoch, upperOrder, here)
  return join(left, next, right, epoch)
}

export const collectTextInRange = (
  node: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  start: number,
  end: number,
  acc: string[],
  baseOffset = 0,
) => {
  if (!node || baseOffset >= end) return

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeLen = getPieceVisibleLength(node.piece)
  const nodeStart = baseOffset + leftLen
  const nodeEnd = nodeStart + nodeLen

  if (start < nodeStart) collectTextInRange(node.left, buffers, start, end, acc, baseOffset)

  if (node.piece.visible && nodeEnd > start && nodeStart < end) {
    const pieceStart = Math.max(0, start - nodeStart)
    const pieceEnd = Math.min(node.piece.length, end - nodeStart)
    if (pieceEnd > pieceStart) {
      forEachBufferSpan(
        buffers,
        node.piece.buffer,
        node.piece.start + pieceStart,
        node.piece.start + pieceEnd,
        (text, from, to) => acc.push(text.slice(from, to)),
      )
    }
  }

  if (end > nodeEnd) collectTextInRange(node.right, buffers, start, end, acc, nodeEnd)
}

export const forEachTextInRange = (
  node: PieceTreeNode | null,
  buffers: PieceTableBuffers,
  start: number,
  end: number,
  visit: (text: string, start: number, end: number, owner: TextPageOwner) => void,
  baseOffset = 0,
) => {
  if (!node || baseOffset >= end) return

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeLen = getPieceVisibleLength(node.piece)
  const nodeStart = baseOffset + leftLen
  const nodeEnd = nodeStart + nodeLen

  if (start < nodeStart) forEachTextInRange(node.left, buffers, start, end, visit, baseOffset)

  if (node.piece.visible && nodeEnd > start && nodeStart < end) {
    const pieceStart = Math.max(0, start - nodeStart)
    const pieceEnd = Math.min(node.piece.length, end - nodeStart)
    if (pieceEnd > pieceStart) {
      forEachBufferSpan(
        buffers,
        node.piece.buffer,
        node.piece.start + pieceStart,
        node.piece.start + pieceEnd,
        visit,
      )
    }
  }

  if (end > nodeEnd) forEachTextInRange(node.right, buffers, start, end, visit, nodeEnd)
}

export const flattenPieces = (node: PieceTreeNode | null, acc: Piece[]): Piece[] => {
  if (!node) return acc
  flattenPieces(node.left, acc)
  acc.push({ ...node.piece })
  flattenPieces(node.right, acc)
  return acc
}

export type AnchorLocation = {
  piece: Piece
  visibleStart: number
}

export const findVisiblePieceEndingAt = (
  node: PieceTreeNode | null,
  offset: number,
  baseOffset = 0,
): AnchorLocation | null => {
  if (!node) return null

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeLen = getPieceVisibleLength(node.piece)
  const nodeStart = baseOffset + leftLen
  const nodeEnd = nodeStart + nodeLen

  if (offset <= nodeStart) return findVisiblePieceEndingAt(node.left, offset, baseOffset)
  if (nodeLen > 0 && offset === nodeEnd) return { piece: node.piece, visibleStart: nodeStart }

  return findVisiblePieceEndingAt(node.right, offset, nodeEnd)
}

export const findVisiblePieceStartingAt = (
  node: PieceTreeNode | null,
  offset: number,
  baseOffset = 0,
): AnchorLocation | null => {
  if (!node) return null

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeLen = getPieceVisibleLength(node.piece)
  const nodeStart = baseOffset + leftLen
  const nodeEnd = nodeStart + nodeLen

  if (offset < nodeStart) return findVisiblePieceStartingAt(node.left, offset, baseOffset)
  if (nodeLen > 0 && offset === nodeStart) return { piece: node.piece, visibleStart: nodeStart }

  return findVisiblePieceStartingAt(node.right, offset, nodeEnd)
}

export const findVisiblePieceContainingOffset = (
  node: PieceTreeNode | null,
  offset: number,
  baseOffset = 0,
): AnchorLocation | null => {
  if (!node) return null

  const leftLen = getSubtreeVisibleLength(node.left)
  const nodeLen = getPieceVisibleLength(node.piece)
  const nodeStart = baseOffset + leftLen
  const nodeEnd = nodeStart + nodeLen

  if (offset < nodeStart) return findVisiblePieceContainingOffset(node.left, offset, baseOffset)
  if (nodeLen > 0 && offset > nodeStart && offset < nodeEnd) {
    return { piece: node.piece, visibleStart: nodeStart }
  }

  return findVisiblePieceContainingOffset(node.right, offset, nodeEnd)
}

export const flattenNodes = (node: PieceTreeNode | null, acc: PieceTreeNode[]): PieceTreeNode[] => {
  if (!node) return acc
  flattenNodes(node.left, acc)
  acc.push(node)
  flattenNodes(node.right, acc)
  return acc
}

// The piece with this order and the visible length before it.
export const findPieceByOrder = (
  root: PieceTreeNode | null,
  order: number,
): AnchorLocation | null => {
  let node = root
  let visibleStart = 0
  while (node) {
    if (order < node.piece.order) {
      node = node.left
      continue
    }
    visibleStart += getSubtreeVisibleLength(node.left)
    if (order === node.piece.order) return { piece: node.piece, visibleStart }
    visibleStart += getPieceVisibleLength(node.piece)
    node = node.right
  }
  return null
}

// The original buffer's piece holding `unit`. Its pieces are never moved, and
// compaction merges their tombstones without losing a unit, so their lengths
// are a prefix sum over the buffer's own offsets.
export const findOriginalPiece = (
  root: PieceTreeNode | null,
  unit: number,
): AnchorLocation | null => {
  let node = root
  let visibleStart = 0
  let remaining = unit
  while (node) {
    const before = node.left ? node.left.subtreeOriginalLength : 0
    if (remaining < before) {
      node = node.left
      continue
    }
    visibleStart += getSubtreeVisibleLength(node.left)
    const piece = node.piece
    const held = piece.buffer === ORIGINAL_BUFFER ? piece.length : 0
    if (remaining < before + held) return { piece, visibleStart }
    visibleStart += getPieceVisibleLength(piece)
    remaining -= before + held
    node = node.right
  }
  return null
}

// A scan outward from a tombstone over pieces newer than `buffer`, stopping
// at the first that is not. `blocked` says a whole subtree stopped it.
type GapScan = { readonly buffer: number; length: number; blocked: boolean }

const scanNewerFromRight = (node: PieceTreeNode | null, scan: GapScan): void => {
  if (!node) return
  if (node.subtreeMinBuffer > scan.buffer) {
    scan.length += node.subtreeVisibleLength
    return
  }
  scanNewerFromRight(node.right, scan)
  if (scan.blocked) return
  if (node.piece.buffer <= scan.buffer) {
    scan.blocked = true
    return
  }
  scan.length += getPieceVisibleLength(node.piece)
  scanNewerFromRight(node.left, scan)
}

const scanNewerFromLeft = (node: PieceTreeNode | null, scan: GapScan): void => {
  if (!node) return
  if (node.subtreeMinBuffer > scan.buffer) {
    scan.length += node.subtreeVisibleLength
    return
  }
  scanNewerFromLeft(node.left, scan)
  if (scan.blocked) return
  if (node.piece.buffer <= scan.buffer) {
    scan.blocked = true
    return
  }
  scan.length += getPieceVisibleLength(node.piece)
  scanNewerFromLeft(node.right, scan)
}

const scanNewerBefore = (node: PieceTreeNode | null, order: number, scan: GapScan): void => {
  if (!node) return
  if (order <= node.piece.order) return scanNewerBefore(node.left, order, scan)

  scanNewerBefore(node.right, order, scan)
  if (scan.blocked) return
  if (node.piece.buffer <= scan.buffer) {
    scan.blocked = true
    return
  }
  scan.length += getPieceVisibleLength(node.piece)
  scanNewerFromRight(node.left, scan)
}

const scanNewerAfter = (node: PieceTreeNode | null, order: number, scan: GapScan): void => {
  if (!node) return
  if (order >= node.piece.order) return scanNewerAfter(node.right, order, scan)

  scanNewerAfter(node.left, order, scan)
  if (scan.blocked) return
  if (node.piece.buffer <= scan.buffer) {
    scan.blocked = true
    return
  }
  scan.length += getPieceVisibleLength(node.piece)
  scanNewerFromLeft(node.right, scan)
}

// A deleted piece's gap reaches, on each side, to the nearest piece whose
// buffer is no newer than its own: text that was there when it was inserted,
// or another part of the same insert. Anything between arrived later, and
// bias decides which side of it a deleted anchor takes. These are the visible
// lengths of that later text before and after the piece with `order`.
export const newerVisibleLengthBefore = (
  root: PieceTreeNode | null,
  order: number,
  buffer: PieceBufferId,
): number => {
  const scan: GapScan = { buffer, length: 0, blocked: false }
  scanNewerBefore(root, order, scan)
  return scan.length
}

export const newerVisibleLengthAfter = (
  root: PieceTreeNode | null,
  order: number,
  buffer: PieceBufferId,
): number => {
  const scan: GapScan = { buffer, length: 0, blocked: false }
  scanNewerAfter(root, order, scan)
  return scan.length
}

export const normalizePieceOrders = (
  node: PieceTreeNode | null,
  nextOrder: { value: number },
  epoch = PERSISTENT_EPOCH,
  relabel?: (piece: Piece, order: number) => void,
): PieceTreeNode | null => {
  if (!node) return null

  const next = own(node, epoch)
  next.left = normalizePieceOrders(next.left, nextOrder, epoch, relabel)
  relabel?.(next.piece, nextOrder.value)
  next.piece = { ...next.piece, order: nextOrder.value }
  nextOrder.value += PIECE_ORDER_STEP
  next.right = normalizePieceOrders(next.right, nextOrder, epoch, relabel)
  return summarize(next)
}
