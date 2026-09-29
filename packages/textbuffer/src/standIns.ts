import { PIECE_ORDER_FLOOR } from './orders'

// Stand-in identities. A compacted tombstone's reverse-index entry names the
// identity of its stand-in, not an order, so relabelling orders or compacting
// again rewrites this table and leaves the entries of old insertions alone.
// A stand-in piece carries its identity in `start`, which it has no use for.

const BITS = 4
const WIDTH = 1 << BITS
const MASK = WIDTH - 1

// Entry values below the order floor name an identity, counting down from it.
export const isStandInRef = (value: number): boolean => value < PIECE_ORDER_FLOOR

export const standInRef = (id: number): number => PIECE_ORDER_FLOOR - 1 - id

export const standInOfRef = (value: number): number => PIECE_ORDER_FLOOR - 1 - value

// Identities folded into a live one, for moving them on when it folds in turn.
type Folded = number | { readonly left: Folded; readonly right: Folded }

// A live identity's stand-in, or the live identity a folded one leads to.
type Cell =
  | { readonly order: number; readonly size: number; readonly folded: Folded | null }
  | number

type Node = readonly (Node | Cell)[]

export type StandInTable = {
  readonly size: number
  readonly shift: number
  readonly root: Node
}

export const emptyStandInTable: StandInTable = { size: 0, shift: 0, root: [] }

const cellAt = (table: StandInTable, id: number): Cell => {
  let node = table.root
  for (let level = table.shift; level > 0; level -= BITS) node = node[(id >>> level) & MASK] as Node
  return node[id & MASK] as Cell
}

const setIn = (node: Node | undefined, level: number, id: number, cell: Cell): Node => {
  const next = node ? node.slice() : []
  const at = (id >>> level) & MASK
  next[at] = level === 0 ? cell : setIn(node?.[at] as Node | undefined, level - BITS, id, cell)
  return next
}

const withCell = (table: StandInTable, id: number, cell: Cell): StandInTable => {
  let { root, shift } = table
  while (id >= WIDTH << shift) {
    root = [root]
    shift += BITS
  }
  return { size: Math.max(table.size, id + 1), shift, root: setIn(root, shift, id, cell) }
}

type Live = Exclude<Cell, number>

const liveAt = (table: StandInTable, id: number): { id: number; live: Live } => {
  const cell = cellAt(table, id)
  if (typeof cell !== 'number') return { id, live: cell }
  return { id: cell, live: cellAt(table, cell) as Live }
}

// Folding keeps every folded identity one step from a live one.
export const standInOrder = (table: StandInTable, id: number): number =>
  liveAt(table, id).live.order

export const liveStandIn = (table: StandInTable, id: number): number => liveAt(table, id).id

export const addStandIn = (table: StandInTable, order: number): [StandInTable, number] => [
  withCell(table, table.size, { order, size: 1, folded: null }),
  table.size,
]

export const moveStandIn = (table: StandInTable, id: number, order: number): StandInTable => {
  const { live } = liveAt(table, id)
  return withCell(table, id, { ...live, order })
}

const pointFolded = (table: StandInTable, folded: Folded, to: number): StandInTable => {
  let next = table
  const pending: Folded[] = [folded]
  while (pending.length > 0) {
    const item = pending.pop()!
    if (typeof item === 'number') next = withCell(next, item, to)
    else pending.push(item.left, item.right)
  }
  return next
}

// The smaller identity group folds into the larger, so an identity is moved
// at most log2 of all identities times over its life.
export const foldStandIns = (
  table: StandInTable,
  first: number,
  second: number,
): [StandInTable, number] => {
  const a = liveAt(table, first)
  const b = liveAt(table, second)
  if (a.id === b.id) return [table, a.id]
  const [keep, fold] = a.live.size >= b.live.size ? [a, b] : [b, a]
  let next = pointFolded(table, fold.live.folded ?? fold.id, keep.id)
  next = withCell(next, fold.id, keep.id)
  // Identity 0 is a folded list of one, so these test for null, never truth.
  const moved: Folded =
    fold.live.folded === null ? fold.id : { left: fold.id, right: fold.live.folded }
  const folded = keep.live.folded === null ? moved : { left: keep.live.folded, right: moved }
  return [
    withCell(next, keep.id, {
      order: keep.live.order,
      size: keep.live.size + fold.live.size,
      folded,
    }),
    keep.id,
  ]
}
