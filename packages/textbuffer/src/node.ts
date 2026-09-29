import type { Piece, PieceBufferId, PieceTreeNode } from './pieceTableTypes'

// Chunk 0, the text the document was created from.
export const ORIGINAL_BUFFER = 0 as PieceBufferId

export const getSubtreeVisibleLength = (node: PieceTreeNode | null): number =>
  node ? node.subtreeVisibleLength : 0

export const getSubtreePieces = (node: PieceTreeNode | null): number =>
  node ? node.subtreePieces : 0

export const getSubtreeLineBreaks = (node: PieceTreeNode | null): number =>
  node ? node.subtreeLineBreaks : 0

// Orders rise in document order, so a subtree's bounds are its end pieces'.
// Stored per node they were two boxed HeapNumbers, most of the tree's objects.
export const firstOrder = (node: PieceTreeNode): number => {
  while (node.left) node = node.left
  return node.piece.order
}

export const lastOrder = (node: PieceTreeNode): number => {
  while (node.right) node = node.right
  return node.piece.order
}

// A tombstone with no text, put in by compaction for inserted tombstones whose
// deleted anchors resolve alike; their reverse-index entries lead here. Its
// buffer is the threshold gap scans compare against, not a buffer id. Edits
// never make one, which is how an order relabel tells them apart.
export const isStandIn = (piece: Piece): boolean => piece.length === 0

export const getPieceVisibleLength = (piece: Piece): number => (piece.visible ? piece.length : 0)

export const getPieceVisibleLineBreaks = (piece: Piece): number =>
  piece.visible ? piece.lineBreaks : 0

// NaN never equals itself, so a caller without a lineage clones every node it
// touches and stamps the copies unownable. That is plain path copying.
export const PERSISTENT_EPOCH = Number.NaN

const cloneNode = (node: PieceTreeNode, epoch: number): PieceTreeNode => ({
  piece: node.piece,
  left: node.left,
  right: node.right,
  height: node.height,
  epoch,
  subtreeOriginalLength: node.subtreeOriginalLength,
  subtreeVisibleLength: node.subtreeVisibleLength,
  subtreePieces: node.subtreePieces,
  subtreeLineBreaks: node.subtreeLineBreaks,
  subtreeMinBuffer: node.subtreeMinBuffer,
})

export const own = (node: PieceTreeNode, epoch: number): PieceTreeNode =>
  node.epoch === epoch ? node : cloneNode(node, epoch)

// One pass over the two children for the height and all five summaries. This
// runs on every node an edit touches, so the children are read once each and
// the bounds are compared inline rather than through Math.min.
export const summarize = (node: PieceTreeNode): PieceTreeNode => {
  const piece = node.piece
  const left = node.left
  const right = node.right
  let height = 0
  let original = piece.buffer === ORIGINAL_BUFFER ? piece.length : 0
  let visible = piece.visible ? piece.length : 0
  let lineBreaks = piece.visible ? piece.lineBreaks : 0
  let pieces = 1
  let minBuffer: number = piece.buffer
  if (left) {
    height = left.height
    original += left.subtreeOriginalLength
    visible += left.subtreeVisibleLength
    lineBreaks += left.subtreeLineBreaks
    pieces += left.subtreePieces
    if (left.subtreeMinBuffer < minBuffer) minBuffer = left.subtreeMinBuffer
  }
  if (right) {
    if (right.height > height) height = right.height
    original += right.subtreeOriginalLength
    visible += right.subtreeVisibleLength
    lineBreaks += right.subtreeLineBreaks
    pieces += right.subtreePieces
    if (right.subtreeMinBuffer < minBuffer) minBuffer = right.subtreeMinBuffer
  }
  node.height = height + 1
  node.subtreeOriginalLength = original
  node.subtreeVisibleLength = visible
  node.subtreePieces = pieces
  node.subtreeLineBreaks = lineBreaks
  node.subtreeMinBuffer = minBuffer
  return node
}

export const createNode = (
  piece: Piece,
  left: PieceTreeNode | null = null,
  right: PieceTreeNode | null = null,
  epoch = PERSISTENT_EPOCH,
): PieceTreeNode =>
  summarize({
    piece,
    left,
    right,
    height: 1,
    epoch,
    subtreeOriginalLength: 0,
    subtreeVisibleLength: 0,
    subtreePieces: 0,
    subtreeLineBreaks: 0,
    subtreeMinBuffer: 0,
  })
