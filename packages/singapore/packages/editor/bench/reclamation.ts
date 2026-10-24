import {
  anchorAfter,
  anchorBefore,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  resolveAnchor,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import { validatePieceTreeInvariants } from '@singapore-editor/textbuffer/debug'
import { bufferStoreExtent } from '@singapore-editor/textbuffer/internal/buffers'
import { createNode } from '@singapore-editor/textbuffer/internal/node'
import type { Piece, PieceTreeNode } from '@singapore-editor/textbuffer/internal/pieceTableTypes'
import { buildReverseIndex } from '@singapore-editor/textbuffer/internal/reverseIndex'
import { createSnapshot } from '@singapore-editor/textbuffer/internal/snapshot'
import { flattenPieces } from '@singapore-editor/textbuffer/internal/tree'

// This counts the snapshot's readable extent, not the backing log's heap retention.
export function storageExtent(snapshot: PieceTableSnapshot) {
  const extent = bufferStoreExtent(snapshot.buffers)
  if (!extent) throw new RangeError('expected piece buffer storage')
  let lineIndexCapacityBytes = 0
  for (const index of snapshot.buffers.lineIndexes.values()) {
    lineIndexCapacityBytes += index.offsets.byteLength
  }
  const validation = validatePieceTreeInvariants(snapshot)
  return {
    liveCodeUnits: snapshot.length,
    ...validation.counts,
    chunks: extent.retainedChunkCount,
    bufferIds: snapshot.buffers.nextBufferSequence,
    storedCodeUnits: extent.retainedCodeUnits,
    lineIndexCapacityBytes,
    invariantIssues: validation.issues,
  }
}

function balancedRoot(pieces: readonly Piece[], from: number, to: number): PieceTreeNode | null {
  if (from === to) return null
  const middle = (from + to) >>> 1
  return createNode(
    pieces[middle]!,
    balancedRoot(pieces, from, middle),
    balancedRoot(pieces, middle + 1, to),
  )
}

// Deliberately unsafe candidate, confined to the experiment. Never publish this root.
export function omitTombstones(snapshot: PieceTableSnapshot): PieceTableSnapshot {
  const pieces = flattenPieces(snapshot.root, []).filter((piece) => piece.visible)
  const root = balancedRoot(pieces, 0, pieces.length)
  return createSnapshot(snapshot.buffers, root, buildReverseIndex(root))
}

export function anchorRemovalProbe() {
  const initial = createPieceTableSnapshot('prefix suffix')
  const inserted = insertIntoPieceTable(initial, 7, 'old')
  const left = anchorBefore(inserted, 8)
  const right = anchorAfter(inserted, 8)
  const deleted = deleteFromPieceTable(inserted, 7, 3)
  const current = insertIntoPieceTable(deleted, 7, 'NEW')
  const candidate = omitTombstones(current)
  return {
    before: [resolveAnchor(current, left), resolveAnchor(current, right)],
    after: [resolveAnchor(candidate, left), resolveAnchor(candidate, right)],
    currentText: materializePieceTableFullText(current),
    candidateText: materializePieceTableFullText(candidate),
    retainedText: materializePieceTableFullText(inserted),
    beforeStorage: storageExtent(current),
    afterStorage: storageExtent(candidate),
  }
}

export function branchIdentityProbe() {
  const initial = createPieceTableSnapshot('prefix suffix')
  const left = insertIntoPieceTable(initial, 7, 'AAA')
  const right = insertIntoPieceTable(initial, 7, 'BBB')
  const leftAnchor = anchorAfter(left, 8)
  const rightAnchor = anchorAfter(right, 8)
  return {
    sharedLineage: left.buffers.identity === right.buffers.identity,
    leftAnchor,
    rightAnchor,
    leftText: materializePieceTableFullText(left),
    rightText: materializePieceTableFullText(right),
    leftIssues: validatePieceTreeInvariants(left).issues,
    rightIssues: validatePieceTreeInvariants(right).issues,
  }
}
