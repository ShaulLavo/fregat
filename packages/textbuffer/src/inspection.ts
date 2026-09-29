import type {
  Piece,
  PieceBufferId,
  PieceBufferLineIndex,
  PieceTableReverseSplitNode,
  PieceTableSnapshot,
  PieceTreeNode,
} from './pieceTableTypes'
import { createInspectionLabels, walkInspectionTree } from './inspectionWalk'
import { lookupReverseIndex, reverseIndexEntries, reverseIndexSlot } from './reverseIndex'
import {
  bufferLength,
  bufferSpanAt,
  bufferStoreExtent,
  chunkOfBuffer,
  retiredBufferLength,
} from './buffers'
import { isStandIn, ORIGINAL_BUFFER } from './node'
import { liveStandIn, standInOrder } from './standIns'

export type PieceTreeIssueKind =
  | 'cycle'
  | 'structure'
  | 'ordering'
  | 'aggregate'
  | 'buffer-bounds'
  | 'line-breaks'
  | 'balance'
  | 'snapshot'
  | 'reverse-index'
  | 'line-index'
export type PieceTreeIssue = {
  readonly kind: PieceTreeIssueKind
  readonly node: string
  readonly field: string
  readonly expected: number | string | boolean
  readonly actual: number | string | boolean | undefined
}
export type PieceTreeValidation = {
  readonly issues: readonly PieceTreeIssue[]
  readonly counts: {
    readonly nodes: number
    readonly visible: number
    readonly invisible: number
    readonly reverseEntries: number
    readonly lineIndexes: number
  }
}

type Report = (
  kind: PieceTreeIssueKind,
  node: string,
  field: string,
  expected: PieceTreeIssue['expected'],
  actual: PieceTreeIssue['actual'],
) => void
type Stored = Pick<
  PieceTreeNode,
  | 'subtreeOriginalLength'
  | 'subtreeVisibleLength'
  | 'subtreePieces'
  | 'subtreeLineBreaks'
  | 'subtreeMinBuffer'
>
// Order bounds are not stored on nodes; they are recomputed to check ordering.
type Totals = Stored & { readonly minOrder: number; readonly maxOrder: number }
const stored: Stored = {
  subtreeOriginalLength: 0,
  subtreeVisibleLength: 0,
  subtreePieces: 0,
  subtreeLineBreaks: 0,
  subtreeMinBuffer: Infinity,
}
const empty: Totals = { ...stored, minOrder: Infinity, maxOrder: -Infinity }
export const inspectionPieceFields = [
  'buffer',
  'start',
  'length',
  'order',
  'lineBreaks',
  'firstLineBreak',
  'visible',
] as const
export const inspectionPieceKey = (piece: Pick<Piece, 'buffer' | 'start'>): string =>
  JSON.stringify([piece.buffer, piece.start])

function rawLineBreaks(text: string, start: number, end: number): number {
  let count = 0
  for (let at = start; at < end; at++) if (text.charCodeAt(at) === 10) count++
  return count
}

// Break offsets of each chunk, read from the text once per validation.
type ChunkBreaks = Map<number, number[]>

function chunkBreaksBefore(breaks: ChunkBreaks, chunk: number, text: string, end: number): number {
  let offsets = breaks.get(chunk)
  if (!offsets) {
    offsets = []
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) offsets.push(at)
    breaks.set(chunk, offsets)
  }
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle]! < end) low = middle + 1
    else high = middle
  }
  return low
}

function checkPiece(
  snapshot: PieceTableSnapshot,
  node: PieceTreeNode,
  id: string,
  chunkBreaks: ChunkBreaks,
  report: Report,
): number {
  const piece = node.piece
  if (isStandIn(piece)) return checkStandIn(snapshot, piece, id, report)
  const text = snapshot.buffers.chunks.get(piece.buffer)
  const retiredLength = retiredBufferLength(snapshot.buffers, piece.buffer)
  if (retiredLength !== undefined) return checkRetiredPiece(piece, retiredLength, id, report)
  if (text === undefined) return checkSparsePiece(snapshot, piece, id, report)
  const validStart =
    Number.isSafeInteger(piece.start) && piece.start >= 0 && piece.start <= (text?.length ?? 0)
  const validLength =
    Number.isSafeInteger(piece.length) &&
    piece.length > 0 &&
    piece.start + piece.length <= (text?.length ?? 0)
  if (!validStart)
    report('buffer-bounds', id, 'piece.start', `integer in [0, ${text?.length ?? 0}]`, piece.start)
  if (!validLength)
    report(
      'buffer-bounds',
      id,
      'piece.length',
      `positive integer with end <= ${text?.length ?? 0}`,
      piece.length,
    )
  if (!Number.isFinite(piece.order))
    report('ordering', id, 'piece.order', 'finite order', piece.order)
  if (text === undefined || !validStart || !validLength) return NaN
  const breaks = rawLineBreaks(text, piece.start, piece.start + piece.length)
  report('line-breaks', id, 'piece.lineBreaks', breaks, piece.lineBreaks)
  const chunk = chunkOfBuffer(snapshot.buffers, piece.buffer)
  const before = chunkBreaksBefore(chunkBreaks, chunk, text, piece.start)
  report('line-breaks', id, 'piece.firstLineBreak', before, piece.firstLineBreak)
  const index = snapshot.buffers.lineIndexes.get(chunk)
  if (index && index.scannedLength > piece.start) {
    const end = Math.min(piece.start + piece.length, index.scannedLength)
    const indexedBreaks = checkSpanBreaks(text, piece.start, end, 0, index, before, id, report)
    checkIndexedRange(index, piece.start, end, indexedBreaks, id, report)
  }
  return breaks
}

function checkSparsePiece(
  snapshot: PieceTableSnapshot,
  piece: Piece,
  id: string,
  report: Report,
): number {
  let length: number
  try {
    length = bufferLength(snapshot.buffers, piece.buffer)
  } catch {
    report('buffer-bounds', id, 'piece.buffer', 'existing buffer', piece.buffer)
    return NaN
  }
  if (!piece.visible) return checkRetiredPiece(piece, length, id, report)
  const validRange =
    Number.isSafeInteger(piece.start) &&
    Number.isSafeInteger(piece.length) &&
    piece.start >= 0 &&
    piece.length > 0 &&
    piece.start + piece.length <= length
  report('buffer-bounds', id, 'piece.range', true, validRange)
  report('ordering', id, 'piece.order.finite', true, Number.isFinite(piece.order))
  if (!validRange) return NaN
  try {
    return checkSparseBreaks(snapshot, piece, id, report)
  } catch {
    report('buffer-bounds', id, 'retained.visible', true, false)
    return NaN
  }
}

function checkSparseBreaks(
  snapshot: PieceTableSnapshot,
  piece: Piece,
  id: string,
  report: Report,
): number {
  const index = snapshot.buffers.lineIndexes.get(chunkOfBuffer(snapshot.buffers, piece.buffer))
  let breaks = 0
  let at = piece.start
  const end = at + piece.length
  while (at < end) {
    const span = bufferSpanAt(snapshot.buffers, piece.buffer, at)
    const stop = Math.min(end, span.end)
    breaks += checkSpanBreaks(
      span.text,
      at - span.start,
      stop - span.start,
      span.start,
      index,
      piece.firstLineBreak + breaks,
      id,
      report,
    )
    at = stop
  }
  report('line-breaks', id, 'piece.lineBreaks', breaks, piece.lineBreaks)
  if (index) {
    checkIndexedRange(index, piece.start, end, breaks, id, report)
    report(
      'line-breaks',
      id,
      'piece.firstLineBreak',
      lineIndexBefore(index, piece.start),
      piece.firstLineBreak,
    )
  }
  return breaks
}

function checkIndexedRange(
  index: PieceBufferLineIndex,
  start: number,
  end: number,
  breaks: number,
  id: string,
  report: Report,
): void {
  const count = lineIndexBefore(index, end) - lineIndexBefore(index, start)
  report('line-index', id, 'count', breaks, count)
}

function lineIndexBefore(index: PieceBufferLineIndex, at: number): number {
  let low = 0
  let high = index.count
  while (low < high) {
    const middle = (low + high) >>> 1
    if (index.offsets[middle]! < at) low = middle + 1
    else high = middle
  }
  return low
}

function checkSpanBreaks(
  text: string,
  from: number,
  to: number,
  base: number,
  index: PieceBufferLineIndex | undefined,
  ordinal: number,
  id: string,
  report: Report,
): number {
  let count = 0
  for (let at = text.indexOf('\n', from); at !== -1 && at < to; at = text.indexOf('\n', at + 1)) {
    report(
      'line-index',
      id,
      `offsets[${ordinal + count}]`,
      base + at,
      index && ordinal + count < index.count ? index.offsets[ordinal + count] : undefined,
    )
    count++
  }
  return count
}

// A stand-in holds no text; its buffer is a threshold, which may exceed every
// id, and its start a live identity that leads back to its own order.
function checkStandIn(
  snapshot: PieceTableSnapshot,
  piece: Piece,
  id: string,
  report: Report,
): number {
  const table = snapshot.reverseIndex.standIns
  report('buffer-bounds', id, 'standIn.visible', false, piece.visible)
  const known = Number.isSafeInteger(piece.start) && piece.start >= 0 && piece.start < table.size
  report('reverse-index', id, 'standIn.identity', true, known)
  if (known) {
    report('reverse-index', id, 'standIn.live', piece.start, liveStandIn(table, piece.start))
    report('reverse-index', id, 'standIn.order', piece.order, standInOrder(table, piece.start))
  }
  report('line-breaks', id, 'standIn.lineBreaks', 0, piece.lineBreaks)
  report('ordering', id, 'piece.order.finite', true, Number.isFinite(piece.order))
  const validThreshold = Number.isSafeInteger(piece.buffer) && piece.buffer > ORIGINAL_BUFFER
  report('buffer-bounds', id, 'standIn.threshold', true, validThreshold)
  return 0
}

function checkRetiredPiece(piece: Piece, length: number, id: string, report: Report): number {
  report('buffer-bounds', id, 'retired.visible', false, piece.visible)
  const validRange =
    Number.isSafeInteger(piece.start) &&
    Number.isSafeInteger(piece.length) &&
    piece.start >= 0 &&
    piece.length > 0 &&
    piece.start + piece.length <= length
  report('buffer-bounds', id, 'retired.range', true, validRange)
  report('ordering', id, 'piece.order.finite', true, Number.isFinite(piece.order))
  const validBreaks =
    Number.isSafeInteger(piece.lineBreaks) &&
    piece.lineBreaks >= 0 &&
    piece.lineBreaks <= piece.length &&
    Number.isSafeInteger(piece.firstLineBreak) &&
    piece.firstLineBreak >= 0
  report('line-breaks', id, 'retired.lineBreaks', true, validBreaks)
  // The retired text cannot be recounted; invisible pieces contribute zero breaks.
  return piece.lineBreaks
}

function checkTotals(
  node: PieceTreeNode,
  left: Totals,
  right: Totals,
  breaks: number,
  id: string,
  report: Report,
): Totals {
  const p = node.piece
  const result: Totals = {
    subtreeOriginalLength:
      left.subtreeOriginalLength +
      (p.buffer === ORIGINAL_BUFFER ? p.length : 0) +
      right.subtreeOriginalLength,
    subtreeVisibleLength:
      left.subtreeVisibleLength + (p.visible ? p.length : 0) + right.subtreeVisibleLength,
    subtreePieces: left.subtreePieces + 1 + right.subtreePieces,
    subtreeLineBreaks: left.subtreeLineBreaks + (p.visible ? breaks : 0) + right.subtreeLineBreaks,
    subtreeMinBuffer: Math.min(left.subtreeMinBuffer, p.buffer, right.subtreeMinBuffer),
    minOrder: Math.min(left.minOrder, p.order, right.minOrder),
    maxOrder: Math.max(left.maxOrder, p.order, right.maxOrder),
  }
  for (const field of Object.keys(stored) as Array<keyof Stored>)
    report('aggregate', id, field, result[field], node[field])
  if (left.maxOrder >= p.order) report('ordering', id, 'left.order', `< ${p.order}`, left.maxOrder)
  if (right.minOrder <= p.order)
    report('ordering', id, 'right.order', `> ${p.order}`, right.minOrder)
  return result
}

// Sibling heights at most one apart, in both trees.
function checkBalance(node: PieceTreeNode, id: string, report: Report): void {
  const left = node.left?.height ?? 0
  const right = node.right?.height ?? 0
  report('balance', id, 'height', 1 + Math.max(left, right), node.height)
  if (Math.abs(left - right) > 1) {
    report('balance', id, 'children', 'balanced subtrees', 'unbalanced')
  }
}

function checkSplitBalance(
  node: PieceTableReverseSplitNode | null,
  id: string,
  report: Report,
): number {
  if (!node) return 0
  const left = checkSplitBalance(node.left, id, report)
  const right = checkSplitBalance(node.right, id, report)
  report('balance', id, `height@${node.start}`, 1 + Math.max(left, right), node.height)
  if (Math.abs(left - right) > 1)
    report('balance', id, `children@${node.start}`, 'balanced subtrees', 'unbalanced')
  return node.height
}

function checkLineIndex(index: PieceBufferLineIndex, id: string, report: Report): void {
  report(
    'line-index',
    id,
    'scannedLength.valid',
    true,
    Number.isSafeInteger(index.scannedLength) && index.scannedLength >= 0,
  )
  const countValid =
    Number.isSafeInteger(index.count) && index.count >= 0 && index.count <= index.offsets.length
  if (!countValid) {
    report('line-index', id, 'count', `integer in [0, ${index.offsets.length}]`, index.count)
    return
  }
  let previous = -1
  for (let at = 0; at < index.count; at++) {
    const offset = index.offsets[at]!
    report(
      'line-index',
      id,
      `offsets[${at}].valid`,
      true,
      offset > previous && offset < index.scannedLength,
    )
    previous = offset
  }
}

// The store is shared with newer snapshots; the extent is what this snapshot
// may see of it, and it must agree with the id sequence the snapshot mints from.
function checkStoreExtent(snapshot: PieceTableSnapshot, report: Report): void {
  const extent = bufferStoreExtent(snapshot.buffers)
  if (!extent) return
  const buffers = snapshot.buffers
  report(
    'buffer-bounds',
    'buffers',
    'nextBufferSequence',
    extent.bufferCount,
    buffers.nextBufferSequence,
  )
  report('buffer-bounds', 'buffers', 'chunks.size', extent.chunkCount, buffers.chunks.size)
  report('buffer-bounds', 'buffers', 'chunkWithinLimit', true, extent.overflowingChunk === null)
}

// What anchor resolution takes for granted about the document order: a
// buffer's pieces appear in buffer order with nothing missing between them,
// and whatever sits between two of them is newer than they are. Only a
// compacted tombstone may be missing, and its entry leads to a stand-in.
function checkBufferOrder(
  pieces: readonly PieceTreeNode[],
  leadsToStandIn: (buffer: number, unit: number) => boolean,
  label: (node: PieceTreeNode) => string,
  report: Report,
): void {
  const ends = new Map<number, number>()
  const open: number[] = []
  const closed = new Set<number>()
  for (const node of pieces) {
    const { buffer, start, length } = node.piece
    if (isStandIn(node.piece)) continue
    const expected = ends.get(buffer) ?? (buffer === ORIGINAL_BUFFER ? 0 : start)
    const compacted = start > expected && leadsToStandIn(buffer, expected)
    if (!compacted) report('ordering', label(node), 'piece.start', expected, start)
    ends.set(buffer, start + length)

    while (open.length > 0 && open[open.length - 1]! > buffer) closed.add(open.pop()!)
    if (closed.has(buffer))
      report('ordering', label(node), 'piece.buffer', 'no older piece inside a buffer', buffer)
    if (open[open.length - 1] !== buffer) open.push(buffer)
  }
}

// One entry per inserted piece, keyed by its start, or by 0 for a buffer's
// first piece, and holding its order. The other entries belong to compacted
// tombstones and lead to stand-ins; a buffer whose first piece was compacted
// keys its first remaining piece by start.
function checkReverseIndex(
  snapshot: PieceTableSnapshot,
  pieces: readonly PieceTreeNode[],
  byOrder: ReadonlyMap<number, PieceTreeNode>,
  label: (node: PieceTreeNode) => string,
  report: Report,
): number {
  const entries = reverseIndexEntries(snapshot.reverseIndex)
  const orders = new Map<string, number>()
  for (const entry of entries) orders.set(inspectionPieceKey(entry), entry.order)
  if (orders.size !== entries.length)
    report('reverse-index', 'reverse', 'keys', 'unique buffer/start', 'duplicate')
  const leadsToStandIn = (order: number | undefined): boolean => {
    const node = order === undefined ? undefined : byOrder.get(order)
    return node !== undefined && isStandIn(node.piece)
  }

  const seen = new Set<number>()
  let expected = 0
  for (const node of pieces) {
    const piece = node.piece
    if (piece.buffer === ORIGINAL_BUFFER || isStandIn(piece)) continue
    expected++
    const first =
      !seen.has(piece.buffer) &&
      !leadsToStandIn(orders.get(inspectionPieceKey({ ...piece, start: 0 })))
    const key = inspectionPieceKey({ buffer: piece.buffer, start: first ? 0 : piece.start })
    seen.add(piece.buffer)
    report('reverse-index', label(node), `reverseEntry ${key}`, piece.order, orders.get(key))
  }
  for (const entry of entries) {
    if (leadsToStandIn(entry.order)) expected++
    else if (!byOrder.has(entry.order))
      report(
        'reverse-index',
        'reverse',
        `entry ${inspectionPieceKey(entry)}`,
        'a piece',
        entry.order,
      )
  }
  report('reverse-index', 'reverse', 'entries', expected, entries.length)

  for (let at = 0; at < snapshot.reverseIndex.count; at++) {
    const slot = reverseIndexSlot(snapshot.reverseIndex, at)
    if (typeof slot === 'object') checkSplitBalance(slot, `reverse buffer ${at + 1}`, report)
  }
  return entries.length
}

export function validatePieceTreeInvariants(
  snapshot: PieceTableSnapshot,
  label = createInspectionLabels(),
): PieceTreeValidation {
  const issues: PieceTreeIssue[] = []
  const report: Report = (kind, node, field, expected, actual) => {
    if (Object.is(expected, actual)) return
    issues.push(Object.freeze({ kind, node, field, expected, actual }))
  }
  const totals = new Map<PieceTreeNode, Totals>()
  const breaks = new Map<PieceTreeNode, number>()
  const pieces = new Map<string, PieceTreeNode>()
  const visited: PieceTreeNode[] = []
  const chunkBreaks: ChunkBreaks = new Map()
  const counts = { nodes: 0, visible: 0, invisible: 0, reverseEntries: 0, lineIndexes: 0 }
  walkInspectionTree(
    snapshot.root,
    ({ node }) => {
      counts.nodes++
      visited.push(node)
      if (node.piece.visible) counts.visible++
      else counts.invisible++
      const id = label(node)
      breaks.set(node, checkPiece(snapshot, node, id, chunkBreaks, report))
      checkBalance(node, id, report)
      if (isStandIn(node.piece)) return
      const key = inspectionPieceKey(node.piece)
      if (pieces.has(key)) report('structure', id, 'piece.key', 'unique buffer/start', key)
      pieces.set(key, node)
    },
    (node) => {
      const left = node.left ? totals.get(node.left) : empty
      const right = node.right ? totals.get(node.right) : empty
      if (!left || !right) return
      totals.set(node, checkTotals(node, left, right, breaks.get(node) ?? NaN, label(node), report))
    },
    ({ node, parent, edge }, cycle) =>
      report(
        cycle ? 'cycle' : 'structure',
        parent ? label(parent) : label(node),
        edge,
        'tree child',
        label(node),
      ),
  )
  const rootTotals = snapshot.root ? totals.get(snapshot.root) : empty
  if (rootTotals) {
    report('snapshot', 'snapshot', 'length', rootTotals.subtreeVisibleLength, snapshot.length)
    report('snapshot', 'snapshot', 'pieceCount', rootTotals.subtreePieces, snapshot.pieceCount)
  }
  // Document order is the order of the orders; a cyclic tree cannot be walked for it.
  const ordered = visited.toSorted((a, b) => a.piece.order - b.piece.order)
  const byOrder = new Map(ordered.map((node) => [node.piece.order, node]))
  const leadsToStandIn = (buffer: number, unit: number): boolean => {
    const order = lookupReverseIndex(snapshot.reverseIndex, buffer as PieceBufferId, unit)
    const node = order === undefined ? undefined : byOrder.get(order)
    return node !== undefined && isStandIn(node.piece)
  }
  checkBufferOrder(ordered, leadsToStandIn, label, report)
  counts.reverseEntries = checkReverseIndex(snapshot, ordered, byOrder, label, report)
  for (const [chunk, index] of snapshot.buffers.lineIndexes) {
    counts.lineIndexes++
    checkLineIndex(index, `chunk ${chunk}`, report)
  }
  checkStoreExtent(snapshot, report)
  return Object.freeze({ issues: Object.freeze(issues), counts: Object.freeze(counts) })
}
