import type {
  Piece,
  PieceTableBuffers,
  PieceTableReverseIndex,
  PieceTableTreeSnapshot,
  PieceTreeNode,
} from './pieceTableTypes'
import { createInitialBuffers, createOriginalPiece, type PieceTableBufferOptions } from './buffers'
import { applyReverseIndexChanges, buildReverseIndex, relabelReverseIndex } from './reverseIndex'
import { normalizePieceOrders } from './tree'
import {
  createNode,
  getSubtreePieces,
  getSubtreeVisibleLength,
  isStandIn,
  ORIGINAL_BUFFER,
} from './node'
import { PIECE_ORDER_STEP } from './orders'
import { DEFAULT_DOCUMENT_LINE_ENDING, normalizeDocumentText } from './lineEndings'

class StoredSnapshot implements PieceTableTreeSnapshot {
  readonly length: number
  pieceCount: number
  readonly epoch: number
  consumed = false

  constructor(
    public buffers: PieceTableBuffers,
    public root: PieceTreeNode | null,
    public reverseIndex: PieceTableReverseIndex,
  ) {
    this.length = getSubtreeVisibleLength(root)
    this.pieceCount = getSubtreePieces(root)
    this.epoch = buffers.lineage.epoch
  }
}

export const createSnapshot = (
  buffers: PieceTableBuffers,
  root: PieceTreeNode | null,
  reverseIndex: PieceTableReverseIndex,
): PieceTableTreeSnapshot => new StoredSnapshot(buffers, root, reverseIndex)

// Only physical storage changes. Text, coordinates and snapshot identity stay fixed.
export function publishSnapshotStorage(
  snapshot: PieceTableTreeSnapshot,
  expected: PieceTableBuffers,
  next: PieceTableBuffers,
): boolean {
  if (!(snapshot instanceof StoredSnapshot) || snapshot.consumed || snapshot.buffers !== expected)
    return false
  snapshot.buffers = next
  return true
}

// Only the tree and its index change: every anchor resolves as it did, so
// text, coordinates and snapshot identity stay fixed. See compaction.ts.
export function publishSnapshotPositions(
  snapshot: PieceTableTreeSnapshot,
  expected: PieceTreeNode | null,
  root: PieceTreeNode | null,
  reverseIndex: PieceTableReverseIndex,
): boolean {
  if (!(snapshot instanceof StoredSnapshot) || snapshot.consumed || snapshot.root !== expected)
    return false
  snapshot.root = root
  snapshot.reverseIndex = reverseIndex
  snapshot.pieceCount = getSubtreePieces(root)
  return true
}

// Orders ran out of room somewhere, so every piece is relabelled. Only the
// entries of pieces in the tree and the stand-ins' identities follow; entries
// of compacted insertions name identities and stay as they are.
export const createNormalizedSnapshot = (
  buffers: PieceTableBuffers,
  root: PieceTreeNode | null,
  previous: PieceTableReverseIndex,
  changes: readonly Piece[],
): PieceTableTreeSnapshot => {
  const epoch = buffers.lineage.epoch
  const pieces: number[] = []
  const standIns: number[] = []
  const normalizedRoot = normalizePieceOrders(
    root,
    { value: PIECE_ORDER_STEP },
    epoch,
    (piece, order) => {
      if (isStandIn(piece)) standIns.push(piece.start, order)
      else if (piece.buffer !== ORIGINAL_BUFFER) pieces.push(piece.buffer, piece.start, order)
    },
  )
  const withChanges = applyReverseIndexChanges(previous, changes)
  return createSnapshot(buffers, normalizedRoot, relabelReverseIndex(withChanges, pieces, standIns))
}

// Makes the snapshot persistent: nothing created before this call is ever
// mutated again. A snapshot older than the lineage epoch already is.
export const retainPieceTableSnapshot = <Snapshot extends PieceTableTreeSnapshot>(
  snapshot: Snapshot,
): Snapshot => {
  const lineage = snapshot.buffers.lineage
  if (snapshot.epoch === lineage.epoch) lineage.epoch += 1
  return snapshot
}

// The epoch an edit of this snapshot writes with. Auto-retain keeps today's
// behaviour: every edit clones its path. Otherwise a transient snapshot is
// consumed by the edit and a second edit of it would read mutated nodes.
export const editingEpoch = (snapshot: PieceTableTreeSnapshot): number => {
  const lineage = snapshot.buffers.lineage
  if (lineage.autoRetain) return retainPieceTableSnapshot(snapshot).buffers.lineage.epoch
  if (snapshot.consumed) throw new Error('piece table snapshot already edited in place')
  if (snapshot.epoch === lineage.epoch) snapshot.consumed = true
  return lineage.epoch
}

export type CreatePieceTableSnapshotOptions = PieceTableBufferOptions & {
  // Skip ingestion normalization when the caller already holds LF-only text
  // (snapshot round-trips, undo restores, worker-side reconstruction).
  readonly normalized?: boolean
}

export const createPieceTableSnapshot = (
  original: string,
  options: CreatePieceTableSnapshotOptions = {},
): PieceTableTreeSnapshot => {
  const ingested = options.normalized
    ? null
    : normalizeDocumentText(original, options.lineEnding ?? DEFAULT_DOCUMENT_LINE_ENDING)
  const buffers = createInitialBuffers(ingested ? ingested.text : original, {
    ...options,
    lineEnding: ingested ? ingested.lineEnding : options.lineEnding,
    byteOrderMark: ingested ? ingested.byteOrderMark : options.byteOrderMark,
    containsUnusualLineTerminators: ingested
      ? ingested.containsUnusualLineTerminators
      : options.containsUnusualLineTerminators,
  })
  const originalPiece = createOriginalPiece(buffers)
  const epoch = buffers.lineage.epoch
  const root = originalPiece ? createNode(originalPiece, null, null, epoch) : null
  return createSnapshot(buffers, root, buildReverseIndex(root))
}
