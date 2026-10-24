import { describe, expect, it } from 'vitest'

import {
  allocateOrdersBetween,
  assignPieceOrders,
  PIECE_ORDER_MIN_GAP,
  PIECE_ORDER_STEP,
} from '@singapore-editor/textbuffer/internal/orders'
import type { Piece } from '@singapore-editor/textbuffer/internal/pieceTableTypes'

describe('piece table order allocation', () => {
  it('allocates stable order steps when either side is open', () => {
    expect(allocateOrdersBetween(null, null, 3)).toEqual([
      PIECE_ORDER_STEP,
      PIECE_ORDER_STEP * 2,
      PIECE_ORDER_STEP * 3,
    ])
    expect(allocateOrdersBetween(10, null, 2)).toEqual([
      10 + PIECE_ORDER_STEP,
      10 + PIECE_ORDER_STEP * 2,
    ])
    expect(allocateOrdersBetween(null, 3000, 2)).toEqual([
      3000 - PIECE_ORDER_STEP * 2,
      3000 - PIECE_ORDER_STEP,
    ])
  })

  it('spreads orders inside a bounded gap', () => {
    expect(allocateOrdersBetween(10, 40, 2)).toEqual([20, 30])
  })

  it('requests normalization when a gap is too small', () => {
    expect(allocateOrdersBetween(10, 10 + PIECE_ORDER_MIN_GAP, 1)).toBeNull()

    const result = assignPieceOrders([piece(), piece()], 10, 10 + PIECE_ORDER_MIN_GAP)

    expect(result.normalizeOrders).toBe(true)
    expect(result.pieces.map((item) => item.order)).toEqual([
      10 + PIECE_ORDER_MIN_GAP,
      10 + PIECE_ORDER_MIN_GAP * 2,
    ])
  })
})

function piece(): Piece {
  return {
    buffer: 7 as Piece['buffer'],
    start: 0,
    length: 1,
    order: 0,
    lineBreaks: 0,
    firstLineBreak: 0,
    visible: true,
  }
}
