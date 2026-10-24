import type {
  AnchorBias,
  Piece,
  PieceBufferId,
  PieceTableReverseBranch,
  PieceTableReverseIndex,
  PieceTableReverseSlot,
  PieceTableReverseSplitNode,
  PieceTableReverseTail,
  PieceTreeNode,
} from './pieceTableTypes'
import { isStandIn, ORIGINAL_BUFFER } from './node'
import {
  emptyStandInTable,
  isStandInRef,
  moveStandIn,
  standInOfRef,
  standInOrder,
  standInRef,
  type StandInTable,
} from './standIns'

const BITS = 4
const WIDTH = 1 << BITS
const MASK = WIDTH - 1

type Leaf = readonly PieceTableReverseSlot[]

// A literal, so the array holds tagged values from the start: `new Array`
// would begin as small integers and be rewritten on its first order.
const emptySlots = (): PieceTableReverseSlot[] => [
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
]

// The one place an index is made, so every one has the same hidden class.
const reverseIndexOf = (
  count: number,
  shift: number,
  root: PieceTableReverseIndex['root'],
  tail: PieceTableReverseTail,
  standIns: StandInTable,
): PieceTableReverseIndex => ({ count, shift, root, tail, standIns })

const createReverseIndex = (): PieceTableReverseIndex =>
  reverseIndexOf(0, BITS, null, { slots: emptySlots(), used: 0 }, emptyStandInTable)

// Where the tail begins. A full tail stays the tail until the next append.
const tailOffset = (count: number): number => (count < WIDTH ? 0 : ((count - 1) >>> BITS) << BITS)

const splitHeight = (node: PieceTableReverseSplitNode | null): number => (node ? node.height : 0)

const splitNode = (
  start: number,
  order: number,
  left: PieceTableReverseSplitNode | null,
  right: PieceTableReverseSplitNode | null,
): PieceTableReverseSplitNode => {
  const leftHeight = splitHeight(left)
  const rightHeight = splitHeight(right)
  return {
    start,
    order,
    height: (leftHeight > rightHeight ? leftHeight : rightHeight) + 1,
    left,
    right,
  }
}

// AVL repair while rebuilding a node one of whose sides grew by at most one.
const balancedSplitNode = (
  start: number,
  order: number,
  left: PieceTableReverseSplitNode | null,
  right: PieceTableReverseSplitNode | null,
): PieceTableReverseSplitNode => {
  const lean = splitHeight(left) - splitHeight(right)
  if (lean > 1) {
    const pivot = left!
    if (splitHeight(pivot.left) >= splitHeight(pivot.right)) {
      return splitNode(
        pivot.start,
        pivot.order,
        pivot.left,
        splitNode(start, order, pivot.right, right),
      )
    }
    const inner = pivot.right!
    return splitNode(
      inner.start,
      inner.order,
      splitNode(pivot.start, pivot.order, pivot.left, inner.left),
      splitNode(start, order, inner.right, right),
    )
  }
  if (lean < -1) {
    const pivot = right!
    if (splitHeight(pivot.right) >= splitHeight(pivot.left)) {
      return splitNode(
        pivot.start,
        pivot.order,
        splitNode(start, order, left, pivot.left),
        pivot.right,
      )
    }
    const inner = pivot.left!
    return splitNode(
      inner.start,
      inner.order,
      splitNode(start, order, left, inner.left),
      splitNode(pivot.start, pivot.order, inner.right, pivot.right),
    )
  }
  return splitNode(start, order, left, right)
}

const insertSplit = (
  node: PieceTableReverseSplitNode | null,
  start: number,
  order: number,
): PieceTableReverseSplitNode => {
  if (!node) return splitNode(start, order, null, null)
  if (start === node.start) return splitNode(start, order, node.left, node.right)
  if (start < node.start) {
    return balancedSplitNode(
      node.start,
      node.order,
      insertSplit(node.left, start, order),
      node.right,
    )
  }
  return balancedSplitNode(node.start, node.order, node.left, insertSplit(node.right, start, order))
}

// A cut keeps the first part's key and order, so only later parts arrive
// here, and a slot that held one order becomes that piece plus the new one.
const slotWithPiece = (slot: PieceTableReverseSlot, piece: Piece): PieceTableReverseSlot => {
  if (slot === undefined) return piece.order
  const pieces = typeof slot === 'number' ? splitNode(0, slot, null, null) : slot
  return insertSplit(pieces, piece.start, piece.order)
}

// The slot of inserted buffer `at + 1`.
export const reverseIndexSlot = (
  index: PieceTableReverseIndex,
  at: number,
): PieceTableReverseSlot => {
  if (at < 0 || at >= index.count) return undefined
  const offset = tailOffset(index.count)
  if (at >= offset) return index.tail.slots[at - offset]

  let node = index.root as PieceTableReverseBranch
  for (let level = index.shift; level > BITS; level -= BITS) {
    node = node[(at >>> level) & MASK] as PieceTableReverseBranch
  }
  return (node[(at >>> BITS) & MASK] as Leaf)[at & MASK]
}

const privateTail = (index: PieceTableReverseIndex, length: number): PieceTableReverseSlot[] => {
  const slots = emptySlots()
  for (let at = 0; at < length; at += 1) slots[at] = index.tail.slots[at]
  return slots
}

// Every copy of a vector node, so the counters see each one.
const copyBranch = <Node extends readonly unknown[]>(node: Node): Node[number][] => node.slice()

const pathTo = (level: number, leaf: Leaf): PieceTableReverseBranch | Leaf =>
  level === 0 ? leaf : [pathTo(level - BITS, leaf)]

const pushLeaf = (
  parent: PieceTableReverseBranch,
  level: number,
  last: number,
  leaf: Leaf,
): PieceTableReverseBranch => {
  const next = copyBranch(parent)
  const at = (last >>> level) & MASK
  const child = parent[at] as PieceTableReverseBranch | undefined
  if (level === BITS) next[at] = leaf
  else next[at] = child ? pushLeaf(child, level - BITS, last, leaf) : pathTo(level - BITS, leaf)
  return next
}

// The full tail becomes a leaf of the vector and `slot` starts the next tail.
const appendPastFullTail = (
  index: PieceTableReverseIndex,
  slot: PieceTableReverseSlot,
): PieceTableReverseIndex => {
  const leaf = index.tail.slots
  const slots = emptySlots()
  slots[0] = slot
  const tail = { slots, used: 1 }
  const count = index.count + 1
  const root = index.root as PieceTableReverseBranch | null
  if (!root) return reverseIndexOf(count, BITS, [leaf], tail, index.standIns)
  if (index.count >>> BITS > 1 << index.shift) {
    const grown = [root, pathTo(index.shift, leaf)]
    return reverseIndexOf(count, index.shift + BITS, grown, tail, index.standIns)
  }
  return reverseIndexOf(
    count,
    index.shift,
    pushLeaf(root, index.shift, index.count - 1, leaf),
    tail,
    index.standIns,
  )
}

// The newest buffer always has the next id, so it is an append. The first
// snapshot to append after its parent writes the shared tail's free slot and
// copies nothing; a sibling branch that comes second takes a private tail.
const appendSlot = (
  index: PieceTableReverseIndex,
  slot: PieceTableReverseSlot,
): PieceTableReverseIndex => {
  const length = index.count - tailOffset(index.count)
  if (length === WIDTH) return appendPastFullTail(index, slot)

  const tail =
    index.tail.used === length ? index.tail : { slots: privateTail(index, length), used: length }
  tail.slots[length] = slot
  tail.used = length + 1
  return reverseIndexOf(index.count + 1, index.shift, index.root, tail, index.standIns)
}

const replaceInBranch = (
  node: PieceTableReverseBranch,
  level: number,
  at: number,
  slot: PieceTableReverseSlot,
): PieceTableReverseBranch => {
  const next = copyBranch(node)
  const child = (at >>> level) & MASK
  if (level > BITS) {
    next[child] = replaceInBranch(node[child] as PieceTableReverseBranch, level - BITS, at, slot)
    return next
  }
  const leaf = copyBranch(node[child] as Leaf)
  leaf[at & MASK] = slot
  next[child] = leaf
  return next
}

// A filled slot is visible to older snapshots, so replacing one copies.
const replaceSlot = (
  index: PieceTableReverseIndex,
  at: number,
  slot: PieceTableReverseSlot,
): PieceTableReverseIndex => {
  const offset = tailOffset(index.count)
  if (at >= offset) {
    const length = index.count - offset
    const slots = privateTail(index, length)
    slots[at - offset] = slot
    const tail = { slots, used: length }
    return reverseIndexOf(index.count, index.shift, index.root, tail, index.standIns)
  }
  const root = replaceInBranch(index.root as PieceTableReverseBranch, index.shift, at, slot)
  return reverseIndexOf(index.count, index.shift, root, index.tail, index.standIns)
}

const addPiece = (index: PieceTableReverseIndex, piece: Piece): PieceTableReverseIndex => {
  const at = piece.buffer - 1
  let next = index
  while (next.count < at) next = appendSlot(next, undefined)
  if (next.count === at) return appendSlot(next, piece.order)
  return replaceSlot(next, at, slotWithPiece(reverseIndexSlot(next, at), piece))
}

// `pieces` are the ones an edit gave a new key: inserted text and the later
// parts of a cut. A tombstone, a coalesced tail and a cut's first part keep
// their key and order, and an entry holds nothing else, so they write nothing.
export const applyReverseIndexChanges = (
  index: PieceTableReverseIndex,
  pieces: readonly Piece[],
): PieceTableReverseIndex => {
  let next = index
  for (const piece of pieces) {
    if (piece.buffer === ORIGINAL_BUFFER) continue
    next = addPiece(next, piece)
  }
  return next
}

const balancedSplit = (
  entries: readonly number[],
  from: number,
  to: number,
): PieceTableReverseSplitNode | null => {
  if (from >= to) return null
  const middle = (from + to) >>> 1
  return splitNode(
    middle === 0 ? 0 : entries[middle * 2]!,
    entries[middle * 2 + 1]!,
    balancedSplit(entries, from, middle),
    balancedSplit(entries, middle + 1, to),
  )
}

// Start and order pairs per buffer. A buffer's pieces keep their buffer order
// in the document, so walking the tree in order leaves each list sorted. A
// stand-in's buffer is a threshold, and its entries belong to other buffers.
const collectEntries = (node: PieceTreeNode | null, buffers: (number[] | undefined)[]): void => {
  if (!node) return
  collectEntries(node.left, buffers)
  const piece = node.piece
  if (piece.buffer !== ORIGINAL_BUFFER && !isStandIn(piece)) {
    const entries = (buffers[piece.buffer - 1] ??= [])
    entries.push(piece.start, piece.order)
  }
  collectEntries(node.right, buffers)
}

const slotOf = (entries: readonly number[] | undefined): PieceTableReverseSlot => {
  if (!entries) return undefined
  if (entries.length === 2) return entries[1]
  return balancedSplit(entries, 0, entries.length >>> 1)!
}

const indexOf = (buffers: readonly (number[] | undefined)[]): PieceTableReverseIndex => {
  let index = createReverseIndex()
  for (let at = 0; at < buffers.length; at += 1) index = appendSlot(index, slotOf(buffers[at]))
  return index
}

export const buildReverseIndex = (root: PieceTreeNode | null): PieceTableReverseIndex => {
  const buffers: (number[] | undefined)[] = []
  collectEntries(root, buffers)
  return indexOf(buffers)
}

// The entry holding `unit`, the one keyed at or before it, set to `value`.
const withSplitValue = (
  node: PieceTableReverseSplitNode,
  unit: number,
  value: number,
): PieceTableReverseSplitNode => {
  if (node.start > unit) {
    return splitNode(node.start, node.order, withSplitValue(node.left!, unit, value), node.right)
  }
  if (node.right && lowestStart(node.right) <= unit) {
    return splitNode(node.start, node.order, node.left, withSplitValue(node.right, unit, value))
  }
  return splitNode(node.start, value, node.left, node.right)
}

const lowestStart = (node: PieceTableReverseSplitNode): number => {
  let lowest = node
  while (lowest.left) lowest = lowest.left
  return lowest.start
}

const withValue = (
  slot: PieceTableReverseSlot,
  unit: number,
  value: number,
): PieceTableReverseSlot => (typeof slot === 'object' ? withSplitValue(slot, unit, value) : value)

// Buffer index to the values its entries take, keyed by a unit each covers.
type SlotUpdates = Map<number, number[]>

const updatedSlot = (slot: PieceTableReverseSlot, values: readonly number[]) => {
  let next = slot
  for (let at = 0; at < values.length; at += 2) next = withValue(next, values[at]!, values[at + 1]!)
  return next
}

// Copies each node on the way to an updated slot once, however many share it.
const updatedBranch = (
  node: PieceTableReverseBranch,
  level: number,
  indices: readonly number[],
  from: number,
  to: number,
  updates: SlotUpdates,
): PieceTableReverseBranch => {
  const next = node.slice()
  for (let at = from; at < to;) {
    const child = (indices[at]! >>> level) & MASK
    let end = at
    while (end < to && ((indices[end]! >>> level) & MASK) === child) end++
    next[child] =
      level === BITS
        ? updatedLeaf(node[child] as Leaf, indices, at, end, updates)
        : updatedBranch(
            node[child] as PieceTableReverseBranch,
            level - BITS,
            indices,
            at,
            end,
            updates,
          )
    at = end
  }
  return next
}

const updatedLeaf = (
  leaf: Leaf,
  indices: readonly number[],
  from: number,
  to: number,
  updates: SlotUpdates,
): Leaf => {
  const next = leaf.slice()
  for (let at = from; at < to; at++) {
    const index = indices[at]!
    next[index & MASK] = updatedSlot(next[index & MASK], updates.get(index)!)
  }
  return next
}

const updateSlots = (
  index: PieceTableReverseIndex,
  updates: SlotUpdates,
  standIns: StandInTable,
): PieceTableReverseIndex => {
  const indices = [...updates.keys()].sort((left, right) => left - right)
  const offset = tailOffset(index.count)
  const inTail = indices.findIndex((at) => at >= offset)
  const split = inTail < 0 ? indices.length : inTail
  const root =
    split > 0
      ? updatedBranch(
          index.root as PieceTableReverseBranch,
          index.shift,
          indices,
          0,
          split,
          updates,
        )
      : index.root
  if (split === indices.length)
    return reverseIndexOf(index.count, index.shift, root, index.tail, standIns)
  const length = index.count - offset
  const slots = privateTail(index, length)
  for (let at = split; at < indices.length; at++) {
    const at2 = indices[at]! - offset
    slots[at2] = updatedSlot(slots[at2], updates.get(indices[at]!)!)
  }
  return reverseIndexOf(index.count, index.shift, root, { slots, used: length }, standIns)
}

const addUpdate = (updates: SlotUpdates, buffer: number, unit: number, value: number): void => {
  const values = updates.get(buffer - 1) ?? []
  values.push(unit, value)
  updates.set(buffer - 1, values)
}

// After a relabel: each live inserted piece's entry takes its new order, and
// each stand-in's identity its stand-in's. `pieces` holds buffer, start and
// order triples, `standIns` identity and order pairs. Old insertions' entries
// name identities, so none of them is touched.
export const relabelReverseIndex = (
  index: PieceTableReverseIndex,
  pieces: readonly number[],
  standIns: readonly number[],
): PieceTableReverseIndex => {
  const updates: SlotUpdates = new Map()
  for (let at = 0; at < pieces.length; at += 3) {
    addUpdate(updates, pieces[at]!, pieces[at + 1]!, pieces[at + 2]!)
  }
  let table = index.standIns
  for (let at = 0; at < standIns.length; at += 2) {
    table = moveStandIn(table, standIns[at]!, standIns[at + 1]!)
  }
  return updateSlots(index, updates, table)
}

// Compacted tombstones' entries name their stand-ins' identities: `entries`
// holds buffer, start and identity triples. Written in batches between yields.
export function* redirectReverseIndex(
  index: PieceTableReverseIndex,
  entries: readonly number[],
  standIns: StandInTable,
): Generator<void, PieceTableReverseIndex> {
  let next = updateSlots(index, new Map(), standIns)
  for (let from = 0; from < entries.length; from += 3 * 1024) {
    const updates: SlotUpdates = new Map()
    const to = Math.min(entries.length, from + 3 * 1024)
    for (let at = from; at < to; at += 3) {
      addUpdate(updates, entries[at]!, entries[at + 1]!, standInRef(entries[at + 2]!))
    }
    next = updateSlots(next, updates, standIns)
    yield
  }
  return next
}

const orderOfPieceStartingAtOrBefore = (
  pieces: PieceTableReverseSplitNode,
  unit: number,
): number => {
  let node: PieceTableReverseSplitNode | null = pieces
  let order = Number.NaN
  while (node) {
    if (node.start <= unit) {
      order = node.order
      node = node.right
      continue
    }
    node = node.left
  }
  return order
}

// The unit an anchor holds on to: the one before it under left bias, which is
// what puts an anchor on a cut into the piece ending there.
export const anchoredUnit = (offset: number, bias: AnchorBias): number =>
  bias === 'left' && offset > 0 ? offset - 1 : offset

// Order of the inserted buffer's piece that holds `unit`, if the buffer is
// indexed. The caller checks the piece it leads to: entries carry no lengths.
export const lookupReverseIndex = (
  index: PieceTableReverseIndex,
  buffer: PieceBufferId,
  unit: number,
): number | undefined => {
  const slot = reverseIndexSlot(index, buffer - 1)
  const value = typeof slot === 'object' ? orderOfPieceStartingAtOrBefore(slot, unit) : slot
  return value === undefined ? undefined : resolved(index, value)
}

// An identity leads to its stand-in's order; any other value is an order.
const resolved = (index: PieceTableReverseIndex, value: number): number =>
  isStandInRef(value) ? standInOrder(index.standIns, standInOfRef(value)) : value

export type ReverseIndexEntry = {
  readonly buffer: PieceBufferId
  readonly start: number
  readonly order: number
}

const collectSplitEntries = (
  index: PieceTableReverseIndex,
  node: PieceTableReverseSplitNode | null,
  buffer: PieceBufferId,
  entries: ReverseIndexEntry[],
): void => {
  if (!node) return
  collectSplitEntries(index, node.left, buffer, entries)
  entries.push({ buffer, start: node.start, order: resolved(index, node.order) })
  collectSplitEntries(index, node.right, buffer, entries)
}

// Every entry in key order, for inspection, with identities led to orders. A
// buffer's first entry reads start 0 whatever its piece's start is.
export const reverseIndexEntries = (index: PieceTableReverseIndex): ReverseIndexEntry[] => {
  const entries: ReverseIndexEntry[] = []
  for (let at = 0; at < index.count; at += 1) {
    const slot = reverseIndexSlot(index, at)
    const buffer = (at + 1) as PieceBufferId
    if (typeof slot === 'number') entries.push({ buffer, start: 0, order: resolved(index, slot) })
    else if (slot) collectSplitEntries(index, slot, buffer, entries)
  }
  return entries
}

export const coversAnchorOffset = (piece: Piece, offset: number): boolean =>
  offset >= piece.start && offset <= piece.start + piece.length
