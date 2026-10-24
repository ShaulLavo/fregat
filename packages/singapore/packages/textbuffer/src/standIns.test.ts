import { describe, expect, test } from 'vitest'
import { allocateOrdersBetween, PIECE_ORDER_FLOOR, PIECE_ORDER_STEP } from './orders'
import {
  addStandIn,
  emptyStandInTable,
  foldStandIns,
  liveStandIn,
  standInOrder,
  isStandInRef,
  standInRef,
  type StandInTable,
} from './standIns'

const add = (table: StandInTable, order: number): StandInTable => addStandIn(table, order)[0]

describe('stand-in identities', () => {
  // Identity 0 folded first: a list holding only 0 must not read as empty.
  test('every identity stays one step from a live one through repeated folds', () => {
    let table = emptyStandInTable
    for (let id = 0; id < 12; id++) table = add(table, 1000 + id)
    ;[table] = foldStandIns(table, 1, 0)
    ;[table] = foldStandIns(table, 3, 2)
    ;[table] = foldStandIns(table, 3, 4)
    ;[table] = foldStandIns(table, 3, 1)
    for (const id of [7, 8, 9, 10, 11]) [table] = foldStandIns(table, 6, id)
    ;[table] = foldStandIns(table, 6, 3)
    for (const id of [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11]) {
      expect(liveStandIn(table, id)).toBe(6)
      expect(standInOrder(table, id)).toBe(1006)
    }
    expect(liveStandIn(table, 5)).toBe(5)
  })

  // Inserts at the front walk orders down; the one that would cross into the
  // identities' range gets no order, which makes the edit relabel instead.
  test('no order is ever allocated where identities are named', () => {
    expect(allocateOrdersBetween(null, PIECE_ORDER_FLOOR + PIECE_ORDER_STEP, 1)).toEqual([
      PIECE_ORDER_FLOOR,
    ])
    expect(allocateOrdersBetween(null, PIECE_ORDER_FLOOR + 10, 1)).toBeNull()
    expect(isStandInRef(PIECE_ORDER_FLOOR)).toBe(false)
    expect(isStandInRef(standInRef(0))).toBe(true)
    expect(Number.isSafeInteger(standInRef(2 ** 29 - 1))).toBe(true)
  })
})
