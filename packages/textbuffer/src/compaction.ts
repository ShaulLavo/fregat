import type { Piece, PieceBufferId, PieceTableSnapshot, PieceTreeNode } from './pieceTableTypes'
import { join } from './join'
import { createNode, isStandIn, ORIGINAL_BUFFER, own } from './node'
import { redirectReverseIndex } from './reverseIndex'
import { publishSnapshotPositions, retainPieceTableSnapshot } from './snapshot'
import { addStandIn, foldStandIns, liveStandIn, moveStandIn, type StandInTable } from './standIns'

// Tombstones matter only to deleted anchors, which read only where a gap scan
// stops (tree.ts). Text never lands between two tombstones, so a scan can stop
// in few ways any later edit tells apart: in its own run, at a visible piece,
// in another run, or past an end. Tombstones alike both ways share a stand-in.
const SEALED = -2
const FRONT = -1
const END = -3

// A stand-in sealed on both sides by its neighbours; it must stop no one else.
const TRANSPARENT = Number.MAX_SAFE_INTEGER as PieceBufferId

type Layout = {
  readonly pieces: readonly Piece[]
  // The nearest piece before (after) each one whose buffer is no newer.
  readonly previousAtMost: Int32Array
  readonly nextAtMost: Int32Array
  // For a tombstone, where its run of tombstones starts.
  readonly runStart: Int32Array
  // Runs of two or more tombstones, in document order.
  readonly runs: readonly Run[]
}

type Run = { readonly start: number; readonly end: number }

type Group = {
  readonly left: number
  readonly right: number
  readonly inserted: number[]
  insertedThreshold: number
  originalStart: number
  originalEnd: number
  originalBreaks: number
  firstLineBreak: number
  contiguous: boolean
}

type RunPlan = {
  readonly run: Run
  readonly pieces: readonly Piece[]
}

export type TombstoneCompactionResult = {
  // Runs replaced, and the tombstones that took with them.
  runs: number
  tombstones: number
  // Runs whose arrangement failed its check and were left as they were. Any
  // is a gap in the reasoning above, which the tests hold at zero.
  unverified: number
}

function* piecesInOrder(root: PieceTreeNode | null): Generator<void, Piece[]> {
  const pieces: Piece[] = []
  const path: PieceTreeNode[] = []
  let node = root
  while (node || path.length > 0) {
    for (; node; node = node.left) path.push(node)
    const next = path.pop()!
    pieces.push(next.piece)
    node = next.right
    if (pieces.length % 1024 === 0) yield
  }
  return pieces
}

// Counts pieces visited and stack entries popped alike: one piece can pop
// every piece before it, so a step is measured in both.
type Budget = { spent: number }

const WORK_PER_STEP = 1024

function* spend(budget: Budget): Generator<void> {
  if (++budget.spent < WORK_PER_STEP) return
  budget.spent = 0
  yield
}

// The nearest piece whose buffer is no newer, towards `step`'s side: -1 or
// the piece count when there is none.
function* nearestAtMost(
  pieces: readonly Piece[],
  step: 1 | -1,
  budget: Budget,
): Generator<void, Int32Array> {
  const count = pieces.length
  const nearest = new Int32Array(count)
  const stack: number[] = []
  const first = step === 1 ? 0 : count - 1
  const none = step === 1 ? -1 : count
  for (let at = first; at >= 0 && at < count; at += step) {
    while (stack.length > 0 && pieces[stack[stack.length - 1]!]!.buffer > pieces[at]!.buffer) {
      stack.pop()
      yield* spend(budget)
    }
    nearest[at] = stack.length > 0 ? stack[stack.length - 1]! : none
    stack.push(at)
    yield* spend(budget)
  }
  return nearest
}

function* readLayout(root: PieceTreeNode | null): Generator<void, Layout> {
  const pieces = yield* piecesInOrder(root)
  const budget: Budget = { spent: 0 }
  const count = pieces.length
  const runStart = new Int32Array(count)
  const runs: Run[] = []
  for (let at = 0; at < count; at++) {
    runStart[at] = at > 0 && !pieces[at - 1]!.visible ? runStart[at - 1]! : at
    const endsRun = !pieces[at]!.visible && (at === count - 1 || pieces[at + 1]!.visible)
    if (endsRun && runStart[at]! < at) runs.push({ start: runStart[at]!, end: at })
    yield* spend(budget)
  }
  const previousAtMost = yield* nearestAtMost(pieces, 1, budget)
  const nextAtMost = yield* nearestAtMost(pieces, -1, budget)
  return { pieces, previousAtMost, nextAtMost, runStart, runs }
}

// A visible piece and a run are told apart by parity.
const blockerKey = (layout: Layout, at: number): number =>
  layout.pieces[at]!.visible ? 2 * at : 2 * layout.runStart[at]! + 1

const leftKey = (layout: Layout, blocker: number, run: Run): number => {
  if (blocker >= run.start) return SEALED
  if (blocker < 0) return FRONT
  return blockerKey(layout, blocker)
}

// Nothing lands after the last visible piece, so a scan off the end of a
// trailing run stops as if inside it.
const rightKey = (layout: Layout, blocker: number, run: Run): number => {
  if (blocker <= run.end) return SEALED
  const count = layout.pieces.length
  if (blocker < count) return blockerKey(layout, blocker)
  const last = count - 1
  if (layout.pieces[last]!.visible) return END
  return layout.runStart[last] === run.start ? SEALED : blockerKey(layout, last)
}

const createGroup = (left: number, right: number): Group => ({
  left,
  right,
  inserted: [],
  insertedThreshold: Infinity,
  originalStart: -1,
  originalEnd: -1,
  originalBreaks: 0,
  firstLineBreak: 0,
  contiguous: true,
})

// Original tombstones stay pieces: original anchors are found by summing their lengths.
const addOriginal = (group: Group, piece: Piece): void => {
  if (group.originalStart < 0) {
    group.originalStart = piece.start
    group.firstLineBreak = piece.firstLineBreak
  } else if (group.originalEnd !== piece.start) {
    group.contiguous = false
  }
  group.originalEnd = piece.start + piece.length
  group.originalBreaks += piece.lineBreaks
}

// Keys run from END up to twice the piece count, so one number holds a pair.
function* groupMembers(layout: Layout, run: Run): Generator<void, Map<number, Group>> {
  const groups = new Map<number, Group>()
  const width = 2 * layout.pieces.length - END + 2
  for (let at = run.start; at <= run.end; at++) {
    if ((at - run.start) % 1024 === 1023) yield
    const left = leftKey(layout, layout.previousAtMost[at]!, run)
    const right = rightKey(layout, layout.nextAtMost[at]!, run)
    const key = (left - END) * width + (right - END)
    const group = groups.get(key) ?? createGroup(left, right)
    groups.set(key, group)
    const piece = layout.pieces[at]!
    if (piece.buffer === ORIGINAL_BUFFER) {
      addOriginal(group, piece)
      continue
    }
    group.inserted.push(at)
    group.insertedThreshold = Math.min(group.insertedThreshold, piece.buffer)
  }
  return groups
}

type Slot = { readonly group: Group; readonly threshold: number; readonly original: boolean }

// Within a group the stand-in goes where it keeps the group's open side open:
// before the original tombstone on the left, after it on the right.
const pushGroup = (slots: Slot[], group: Group, transparent: boolean): void => {
  const original = group.originalStart >= 0
  const standIn = group.inserted.length > 0
  const threshold = transparent ? TRANSPARENT : group.insertedThreshold
  const standInFirst = group.left !== SEALED && group.right === SEALED
  if (standIn && standInFirst) slots.push({ group, threshold, original: false })
  if (original) slots.push({ group, threshold: ORIGINAL_BUFFER, original: true })
  if (standIn && !standInFirst) slots.push({ group, threshold, original: false })
}

// Left-open groups by falling threshold, the both-open one, right-open groups
// by rising threshold; the sealed group sits where it has neighbours both ways.
// Left-open members are the run's prefix minima and right-open ones its suffix
// minima, so the order they are met in is already the threshold order.
function* arrange(groups: Iterable<Group>): Generator<void, Slot[]> {
  const leftOpen: Group[] = []
  const bothOpen: Group[] = []
  const rightOpen: Group[] = []
  let sealed: Group | null = null
  let seen = 0
  for (const group of groups) {
    if (++seen % 1024 === 0) yield
    if (group.left === SEALED && group.right === SEALED) sealed = group
    else if (group.right === SEALED) leftOpen.push(group)
    else if (group.left === SEALED) rightOpen.push(group)
    else bothOpen.push(group)
  }
  const slots: Slot[] = []
  const sealedAfterLeft = leftOpen.length > 0
  const parts = [leftOpen, sealed && sealedAfterLeft ? [sealed] : [], bothOpen]
  parts.push(sealed && !sealedAfterLeft ? [sealed] : [], rightOpen)
  for (const part of parts) {
    for (let at = 0; at < part.length; at++) {
      pushGroup(slots, part[at]!, part[at] === sealed)
      if (at % 1024 === 1023) yield
    }
  }
  return slots
}

// Every slot must end both scans where its group's tombstones did. A slot is
// sealed on a side when a slot there is no newer. Otherwise its threshold is a
// buffer of one of its group's own tombstones, open on that side, so its scan
// leaves the run and stops where theirs did; off a trailing run's end that
// counts as sealed. The arrangement is checked per run rather than trusted.
function* scansMatch(slots: readonly Slot[], trailing: boolean): Generator<void, boolean> {
  const rightMinimum = new Float64Array(slots.length + 1)
  rightMinimum[slots.length] = Infinity
  for (let at = slots.length - 1; at >= 0; at--) {
    rightMinimum[at] = Math.min(rightMinimum[at + 1]!, slots[at]!.threshold)
    if (at % 1024 === 0) yield
  }
  let leftMinimum = Infinity
  for (let at = 0; at < slots.length; at++) {
    const { group, threshold } = slots[at]!
    const sealedLeft = leftMinimum <= threshold
    const sealedRight = rightMinimum[at + 1]! <= threshold
    leftMinimum = Math.min(leftMinimum, threshold)
    if (sealedLeft !== (group.left === SEALED)) return false
    if (sealedRight && group.right !== SEALED) return false
    if (!sealedRight && group.right === SEALED && !trailing) return false
    if (at % 1024 === 1023) yield
  }
  return true
}

// Scans from outside stop at a run's oldest piece, and original offsets are a
// prefix sum, so both must come through unchanged.
function* outsideMatches(
  layout: Layout,
  run: Run,
  slots: readonly Slot[],
): Generator<void, boolean> {
  let oldest = Infinity
  let originalStart = -1
  let originalEnd = -1
  for (let at = run.start; at <= run.end; at++) {
    const piece = layout.pieces[at]!
    oldest = Math.min(oldest, piece.buffer)
    if ((at - run.start) % 4096 === 4095) yield
    if (piece.buffer !== ORIGINAL_BUFFER) continue
    if (originalStart < 0) originalStart = piece.start
    originalEnd = piece.start + piece.length
  }
  let placed = Infinity
  let cursor = originalStart
  for (let at = 0; at < slots.length; at++) {
    const slot = slots[at]!
    if (at % 1024 === 1023) yield
    placed = Math.min(placed, slot.threshold)
    if (!slot.original) continue
    if (!slot.group.contiguous || slot.group.originalStart !== cursor) return false
    cursor = slot.group.originalEnd
  }
  return placed === oldest && cursor === originalEnd
}

const originalPiece = (group: Group, order: number): Piece => ({
  buffer: ORIGINAL_BUFFER,
  start: group.originalStart,
  length: group.originalEnd - group.originalStart,
  order,
  lineBreaks: group.originalBreaks,
  firstLineBreak: group.firstLineBreak,
  visible: false,
})

const standInPiece = (threshold: number, order: number, identity: number): Piece => ({
  buffer: threshold as PieceBufferId,
  start: identity,
  length: 0,
  order,
  lineBreaks: 0,
  firstLineBreak: 0,
  visible: false,
})

// What a pass writes besides the tree: the identity table, and buffer, start
// and identity triples for the entries of tombstones it compacts.
type Claims = { table: StandInTable; readonly redirects: number[] }

// A group's stand-in keeps the identities of the stand-ins it replaces, folded
// into one; entries naming any of them need no rewrite. Only the group's real
// tombstones are pointed at it.
function* claimGroup(
  claims: Claims,
  layout: Layout,
  group: Group,
  order: number,
): Generator<void, number> {
  let identity = -1
  for (let at = 0; at < group.inserted.length; at++) {
    if (at % 1024 === 1023) yield
    const piece = layout.pieces[group.inserted[at]!]!
    if (!isStandIn(piece)) continue
    if (identity < 0) identity = liveStandIn(claims.table, piece.start)
    else [claims.table, identity] = foldStandIns(claims.table, identity, piece.start)
  }
  if (identity < 0) [claims.table, identity] = addStandIn(claims.table, order)
  else claims.table = moveStandIn(claims.table, identity, order)
  for (let at = 0; at < group.inserted.length; at++) {
    if (at % 1024 === 1023) yield
    const piece = layout.pieces[group.inserted[at]!]!
    if (!isStandIn(piece)) claims.redirects.push(piece.buffer, piece.start, identity)
  }
  return identity
}

// The stand-ins take the orders of the run's first pieces, which already sit
// between the run's neighbours. Every pass over the run yields, so one long run
// cannot hold a maintenance slice.
function* planRun(
  layout: Layout,
  run: Run,
  claims: Claims,
): Generator<void, RunPlan | 'kept' | 'unverified'> {
  const groups = yield* groupMembers(layout, run)
  const slots = yield* arrange(groups.values())
  if (slots.length > run.end - run.start) return 'kept'
  const trailing = run.end === layout.pieces.length - 1
  if (!(yield* scansMatch(slots, trailing))) return 'unverified'
  if (!(yield* outsideMatches(layout, run, slots))) return 'unverified'
  const pieces: Piece[] = []
  for (let at = 0; at < slots.length; at++) {
    const { group, threshold, original } = slots[at]!
    const order = layout.pieces[run.start + at]!.order
    if (at % 1024 === 1023) yield
    if (original) {
      pieces.push(originalPiece(group, order))
      continue
    }
    const identity = yield* claimGroup(claims, layout, group, order)
    pieces.push(standInPiece(threshold, order, identity))
  }
  return { run, pieces }
}

// Nodes with an order below `order`, and the rest.
const splitBelow = (
  node: PieceTreeNode | null,
  order: number,
  epoch: number,
): [PieceTreeNode | null, PieceTreeNode | null] => {
  if (!node) return [null, null]
  if (node.piece.order < order) {
    const [lower, upper] = splitBelow(node.right, order, epoch)
    return [join(node.left, own(node, epoch), lower, epoch), upper]
  }
  const [lower, upper] = splitBelow(node.left, order, epoch)
  return [lower, join(upper, own(node, epoch), node.right, epoch)]
}

const balancedRun = (
  pieces: readonly Piece[],
  from: number,
  to: number,
  epoch: number,
): PieceTreeNode | null => {
  if (from >= to) return null
  const middle = (from + to) >>> 1
  const left = balancedRun(pieces, from, middle, epoch)
  const right = balancedRun(pieces, middle + 1, to, epoch)
  return createNode(pieces[middle]!, left, right, epoch)
}

// The run's pieces join in balanced blocks, a yield between each.
function* replaceRun(
  root: PieceTreeNode | null,
  layout: Layout,
  plan: RunPlan,
  epoch: number,
): Generator<void, PieceTreeNode> {
  const { run, pieces } = plan
  const following = layout.pieces[run.end + 1]
  const [before, rest] = splitBelow(root, layout.pieces[run.start]!.order, epoch)
  const [, after] = splitBelow(rest, following ? following.order : Infinity, epoch)
  let left = before
  const last = pieces.length - 1
  for (let from = 0; from < last; from += 1024) {
    const to = Math.min(from + 1024, last)
    const block = balancedRun(pieces, from + 1, to, epoch)
    left = join(left, createNode(pieces[from]!, null, null, epoch), block, epoch)
    yield
  }
  return join(left, createNode(pieces[last]!, null, null, epoch), after, epoch)
}

// Rebuilt nodes carry an epoch no lineage ever reaches, so every later edit
// copies them like any retained node.
let compactionEpoch = 0

// Compacts every run of tombstones in `snapshot` and republishes it in place.
// Each deleted anchor resolves to the same offset as before, in this snapshot
// and in every snapshot edited from it.
export function* compactTombstones(
  snapshot: PieceTableSnapshot,
): Generator<void, TombstoneCompactionResult> {
  const result: TombstoneCompactionResult = { runs: 0, tombstones: 0, unverified: 0 }
  if (snapshot.consumed || !snapshot.root) return result
  retainPieceTableSnapshot(snapshot)
  const root = snapshot.root
  const layout = yield* readLayout(root)
  const claims: Claims = { table: snapshot.reverseIndex.standIns, redirects: [] }
  const plans: RunPlan[] = []
  for (const run of layout.runs) {
    const plan = yield* planRun(layout, run, claims)
    if (plan === 'unverified') result.unverified++
    else if (plan !== 'kept') plans.push(plan)
    yield
  }
  if (plans.length === 0) return result

  const epoch = --compactionEpoch
  let next: PieceTreeNode | null = root
  for (const plan of plans) {
    next = yield* replaceRun(next, layout, plan, epoch)
    result.runs++
    result.tombstones += plan.run.end - plan.run.start + 1 - plan.pieces.length
    yield
  }
  const reverseIndex = yield* redirectReverseIndex(
    snapshot.reverseIndex,
    claims.redirects,
    claims.table,
  )
  if (!publishSnapshotPositions(snapshot, root, next, reverseIndex)) {
    return { runs: 0, tombstones: 0, unverified: result.unverified }
  }
  return result
}

// A standalone caller drains the same incremental pass.
export function compactPieceTableTombstones(
  snapshot: PieceTableSnapshot,
): TombstoneCompactionResult {
  const job = compactTombstones(snapshot)
  for (;;) {
    const step = job.next()
    if (step.done) return step.value
  }
}
