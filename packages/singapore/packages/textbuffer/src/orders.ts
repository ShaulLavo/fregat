import type { Piece } from './pieceTableTypes'

export const PIECE_ORDER_STEP = 1024
export const PIECE_ORDER_MIN_GAP = 1e-9
// No order goes below this: values under it name stand-ins (standIns.ts), and
// staying within V8's small integers keeps an index slot unboxed. Inserts at
// the front walk down toward it and relabel once they would cross it.
export const PIECE_ORDER_FLOOR = -(2 ** 29)

// Plain loops: this runs on every insert, and Array.from with a callback was
// the hottest frame of the zero-copy edit profile.
const orderSequence = (start: number, step: number, count: number): number[] => {
  const orders: number[] = []
  for (let index = 0; index < count; index += 1) orders.push(start + index * step)
  return orders
}

export const allocateOrdersBetween = (
  lower: number | null,
  upper: number | null,
  count: number,
): number[] | null => {
  if (count <= 0) return []
  if (lower === null && upper === null)
    return orderSequence(PIECE_ORDER_STEP, PIECE_ORDER_STEP, count)
  if (upper === null) return orderSequence((lower ?? 0) + PIECE_ORDER_STEP, PIECE_ORDER_STEP, count)
  if (lower === null) {
    const first = upper - count * PIECE_ORDER_STEP
    return first < PIECE_ORDER_FLOOR ? null : orderSequence(first, PIECE_ORDER_STEP, count)
  }

  const gap = upper - lower
  if (gap <= PIECE_ORDER_MIN_GAP * (count + 1)) return null

  const step = gap / (count + 1)
  const orders: number[] = []
  for (let index = 0; index < count; index += 1) orders.push(lower + step * (index + 1))
  return orders
}

// The one-order case of allocateOrdersBetween without the array: a split
// needs exactly one order for its right half.
export const allocateOrderBetween = (lower: number, upper: number | null): number | null => {
  if (upper === null) return lower + PIECE_ORDER_STEP
  const gap = upper - lower
  if (gap <= PIECE_ORDER_MIN_GAP * 2) return null
  return lower + gap / 2
}

export const assignPieceOrders = (
  pieces: readonly Piece[],
  lower: number | null,
  upper: number | null,
): { pieces: Piece[]; normalizeOrders: boolean } => {
  const orders = allocateOrdersBetween(lower, upper, pieces.length)

  if (!orders) {
    return {
      pieces: pieces.map((piece, index) => ({
        ...piece,
        order: (lower ?? 0) + (index + 1) * PIECE_ORDER_MIN_GAP,
      })),
      normalizeOrders: true,
    }
  }

  return {
    pieces: pieces.map((piece, index) => ({ ...piece, order: orders[index]! })),
    normalizeOrders: false,
  }
}
