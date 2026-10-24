import { describe, expect, it } from 'vitest'

import {
  createInitialBuffers,
  createOriginalPiece,
} from '@singapore-editor/textbuffer/internal/buffers'
import { PIECE_ORDER_STEP } from '@singapore-editor/textbuffer/internal/orders'
import {
  buildReverseIndex,
  reverseIndexEntries,
} from '@singapore-editor/textbuffer/internal/reverseIndex'
import { createPieceTableSnapshot, insertIntoPieceTable } from '@singapore-editor/textbuffer'
import {
  createNormalizedSnapshot,
  createSnapshot,
} from '@singapore-editor/textbuffer/internal/snapshot'
import { createNode } from '@singapore-editor/textbuffer/internal/node'
import { flattenNodes } from '@singapore-editor/textbuffer/internal/tree'

describe('piece table snapshots', () => {
  it('creates empty and non-empty initial snapshots', () => {
    const empty = createPieceTableSnapshot('')
    const text = createPieceTableSnapshot('abc')

    expect(empty).toMatchObject({ root: null, length: 0, pieceCount: 0 })
    expect(text.length).toBe(3)
    expect(text.pieceCount).toBe(1)
    // Only inserted buffers are indexed; the original is found through the tree.
    expect(text.reverseIndex.count).toBe(0)
  })

  it('derives aggregate length and piece count from the root', () => {
    const buffers = createInitialBuffers('abc')
    const root = createNode(createOriginalPiece(buffers)!)
    const snapshot = createSnapshot(buffers, root, buildReverseIndex(root))

    expect(snapshot.length).toBe(3)
    expect(snapshot.pieceCount).toBe(1)
  })

  it('normalizes piece orders and relabels the reverse index to them', () => {
    const edited = insertIntoPieceTable(createPieceTableSnapshot('abc'), 1, 'X')
    const snapshot = createNormalizedSnapshot(edited.buffers, edited.root, edited.reverseIndex, [])
    const pieces = flattenNodes(snapshot.root, []).map((node) => node.piece)

    expect(pieces.map((piece) => piece.order)).toEqual([1, 2, 3].map((n) => n * PIECE_ORDER_STEP))
    expect(reverseIndexEntries(snapshot.reverseIndex)).toEqual([
      { buffer: 1, start: 0, order: 2 * PIECE_ORDER_STEP },
    ])
  })
})
