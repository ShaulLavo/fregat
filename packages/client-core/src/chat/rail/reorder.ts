import { orderKeyBetween } from '@workspace/contracts'

/**
 * A row the rail can arrange: an explicit fractional key, or `null` for a row
 * the user has never dragged.
 */
export type RailOrderRow<TId extends string> = {
  readonly id: TId
  readonly orderKey: string | null
}

export type RailReorderIntent<TId extends string> = {
  readonly id: TId
  readonly orderKey: string
}

/**
 * Arranged rows come first, ordered by plain string comparison of their keys;
 * everything else keeps whatever stable fallback its list uses. Sorting the
 * keyed run to the top is what lets a drag write a single key: the moved row
 * only ever has to sort between two keys that already exist.
 */
export function compareOrderKeys(left: string | null, right: string | null) {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1

  return left < right ? -1 : 1
}

/**
 * The one key a drop has to write. The moved row is placed among the rows that
 * already hold keys, so the neighbours it lands between are always keyed and
 * the rows the user did not touch are never rewritten.
 *
 * A drop into the unarranged tail therefore lands the row at the end of the
 * arranged run rather than exactly where the pointer was released — that is the
 * closest position the single-key model can express, and the caller's optimistic
 * write shows it immediately instead of letting the row snap back later.
 *
 * `null` when the drop is a no-op or when the existing keys are too corrupt to
 * insert between; the caller leaves the server order alone.
 */
export function railReorderIntent<TId extends string>({
  activeId,
  overId,
  rows,
}: {
  readonly activeId: string
  readonly overId: string | null
  /** Every row of the list, in the order the rail is drawing it. */
  readonly rows: readonly RailOrderRow<TId>[]
}): RailReorderIntent<TId> | null {
  if (!overId || activeId === overId) return null

  const from = rows.findIndex((row) => row.id === activeId)
  const to = rows.findIndex((row) => row.id === overId)
  if (from < 0 || to < 0) return null

  const moved = rows[from]
  if (!moved) return null

  const arranged = movedRows(rows, from, to).filter(
    (row) => row.id === moved.id || row.orderKey !== null,
  )
  const index = arranged.findIndex((row) => row.id === moved.id)
  const orderKey = orderKeyBetween(
    arranged[index - 1]?.orderKey ?? null,
    arranged[index + 1]?.orderKey ?? null,
  )
  if (orderKey === null) return null

  return { id: moved.id, orderKey }
}

function movedRows<TRow>(rows: readonly TRow[], from: number, to: number): TRow[] {
  const next = [...rows]
  const [row] = next.splice(from, 1)
  if (!row) return next

  next.splice(to, 0, row)

  return next
}

const ORDER_DIGITS = 'abcdefghijklmnopqrstuvwxyz'

function spreadOrderKeys(count: number): string[] {
  let width = 2
  let space = ORDER_DIGITS.length ** width
  while (space <= (count + 1) * 2) {
    width += 1
    space *= ORDER_DIGITS.length
  }
  const step = space / (count + 1)
  const keys: string[] = []
  for (let i = 0; i < count; i += 1) {
    let value = Math.round(step * (i + 1))
    if (value % ORDER_DIGITS.length === 0) value += 1
    let key = ''
    for (let digit = 0; digit < width; digit += 1) {
      key = ORDER_DIGITS.charAt(value % ORDER_DIGITS.length) + key
      value = Math.floor(value / ORDER_DIGITS.length)
    }
    keys.push(key)
  }
  return keys
}

export function planRailReorder(input: {
  readonly orderedIds: readonly string[]

  readonly keysById: ReadonlyMap<string, string | null | undefined>
  readonly movedId: string
}): ReadonlyArray<{ readonly id: string; readonly orderKey: string }> {
  const { orderedIds, keysById, movedId } = input
  const visibleIds = new Set(orderedIds)
  const reservedKeys = new Set(
    [...keysById].flatMap(([id, key]) => (!visibleIds.has(id) && key != null ? [key] : [])),
  )
  const movedIndex = orderedIds.indexOf(movedId)
  if (movedIndex === -1) return []
  const beforeId = movedIndex > 0 ? orderedIds[movedIndex - 1] : null
  const afterId = movedIndex < orderedIds.length - 1 ? orderedIds[movedIndex + 1] : null
  const beforeKey = beforeId != null ? (keysById.get(beforeId) ?? null) : null
  const afterKey = afterId != null ? (keysById.get(afterId) ?? null) : null
  const beforeUsable = beforeId === null || beforeKey != null
  const afterUsable = afterId === null || afterKey != null
  if (beforeUsable && afterUsable) {
    let key = orderKeyBetween(beforeKey, afterKey)
    while (key !== null && reservedKeys.has(key)) key = orderKeyBetween(key, afterKey)
    if (key !== null) return [{ id: movedId, orderKey: key }]
  }
  const keys = spreadOrderKeys(orderedIds.length + reservedKeys.size)
    .filter((key) => !reservedKeys.has(key))
    .slice(0, orderedIds.length)
  return orderedIds.flatMap((id, index) => {
    const key = keys[index]!
    return keysById.get(id) === key ? [] : [{ id, orderKey: key }]
  })
}
