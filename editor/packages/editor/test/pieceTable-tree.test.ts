import { describe, expect, it } from 'vitest'

import {
  createInitialBuffers,
  createOriginalPiece,
} from '@singapore-editor/textbuffer/internal/buffers'
import { PIECE_ORDER_STEP } from '@singapore-editor/textbuffer/internal/orders'
import type { EditContext } from '@singapore-editor/textbuffer/internal/internalTypes'
import { createNode, getSubtreeVisibleLength } from '@singapore-editor/textbuffer/internal/node'
import {
  collectTextInRange,
  findOriginalPiece,
  findPieceByOrder,
  findVisiblePieceContainingOffset,
  flattenPieces,
  hideVisibleRange,
  normalizePieceOrders,
} from '@singapore-editor/textbuffer/internal/tree'

describe('piece table tree', () => {
  it('builds trees, collects ranges, and finds visible pieces', () => {
    const buffers = createInitialBuffers('abcdef')
    const piece = createOriginalPiece(buffers)!
    const tree = createNode(piece)
    const chunks: string[] = []

    collectTextInRange(tree, buffers, 1, 5, chunks)

    expect(getSubtreeVisibleLength(tree)).toBe(6)
    expect(chunks.join('')).toBe('bcde')
    expect(findVisiblePieceContainingOffset(tree, 3)?.piece).toEqual(piece)
    expect(findPieceByOrder(tree, piece.order)).toEqual({ piece, visibleStart: 0 })
    expect(findOriginalPiece(tree, 5)).toEqual({ piece, visibleStart: 0 })
    expect(findOriginalPiece(tree, 6)).toBeNull()
  })

  it('cuts a piece in place when a range inside it is hidden', () => {
    const buffers = createInitialBuffers('abcdef')
    const tree = createNode(createOriginalPiece(buffers)!)
    const context: EditContext = { changes: [], normalizeOrders: false, snap: null }
    const hidden = hideVisibleRange(tree, 2, 4, buffers, context, Number.NaN)

    expect(tree.piece.length).toBe(6)
    expect(flattenPieces(hidden, []).map((piece) => [piece.length, piece.visible])).toEqual([
      [2, true],
      [2, false],
      [2, true],
    ])
    // The first part keeps the original key and order, so only the later
    // parts are new to the reverse index.
    expect(context.changes.map((piece) => [piece.start, piece.length])).toEqual([
      [2, 2],
      [4, 2],
    ])
  })

  it('hides a whole tree and normalizes orders without mutating the source tree', () => {
    const buffers = createInitialBuffers('abc')
    const tree = createNode({ ...createOriginalPiece(buffers)!, order: 1 })
    const context: EditContext = { changes: [], normalizeOrders: false, snap: null }
    const invisible = hideVisibleRange(tree, 0, 3, buffers, context, Number.NaN)
    const normalized = normalizePieceOrders(invisible, { value: PIECE_ORDER_STEP })

    expect(tree.piece.visible).toBe(true)
    expect(invisible?.piece.visible).toBe(false)
    // A tombstone keeps its key and order: nothing for the reverse index.
    expect(context.changes).toHaveLength(0)
    expect(normalized?.piece.order).toBe(PIECE_ORDER_STEP)
  })
})
