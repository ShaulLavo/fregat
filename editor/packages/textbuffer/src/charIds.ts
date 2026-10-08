import type {
  AnchorLiveness,
  Piece,
  PieceBufferId,
  PieceTableSnapshot,
  PieceTreeNode,
} from './pieceTableTypes'
import type { InsertContext } from './internalTypes'
import {
  addIdentityRun,
  ensureUnusedCharIds,
  identityRunAtId,
  identityRunAtStorage,
  validateCharId,
  validateCharIdSpan,
  type CharId,
  type CharIdSpan,
  type IdentityIndex,
} from './identityRuns'
import { bufferSpanAt, extendTailChunk } from './buffers'
import { ensureValidRange, splitsSurrogatePair } from './reads'
import { applyReverseIndexChanges, lookupReverseIndex } from './reverseIndex'
import { createNormalizedSnapshot, createSnapshot, editingEpoch } from './snapshot'
import {
  findOriginalPiece,
  findPieceByOrder,
  findVisiblePieceContainingOffset,
  findVisiblePieceStartingAt,
  setAtPieceRanges,
  insertAtPieceBoundary,
  type AnchorLocation,
  type PieceVisibilityRange,
} from './tree'
import { ORIGINAL_BUFFER } from './node'

export { CharIdAllocator } from './identityRuns'
export type { CharId, CharIdSpan } from './identityRuns'

export type CharIdLocation = {
  readonly piece: Piece
  /** Chunk-relative storage unit, usable by a local piece-table anchor. */
  readonly unit: number
  readonly visibleStart: number
  /** Visible unit offset, or the gap at a hidden piece's start. */
  readonly offset: number
  readonly liveness: AnchorLiveness
}
export type CharIdBoundary =
  | { readonly after: CharId | 'start' }
  | { readonly before: CharId | 'end' }
export type CharIdInsertion = {
  readonly start: CharId
  readonly text: string
  readonly at: CharIdBoundary
}
export type CharIdVisibility = CharIdSpan & { readonly visible: boolean }
export type CharIdEdit = {
  readonly delete?: readonly CharIdSpan[]
  readonly insert?: CharIdInsertion
}

const identitiesOf = (snapshot: PieceTableSnapshot): IdentityIndex => {
  if (snapshot.consumed) throw new RangeError('cannot read a consumed identity snapshot')
  if (!snapshot.charIds) throw new RangeError('character identity is disabled for this document')
  return snapshot.charIds
}

const storageLocation = (
  snapshot: Pick<PieceTableSnapshot, 'root' | 'reverseIndex'>,
  buffer: PieceBufferId,
  unit: number,
): AnchorLocation | null => {
  if (buffer === ORIGINAL_BUFFER) return findOriginalPiece(snapshot.root, unit)
  const order = lookupReverseIndex(snapshot.reverseIndex, buffer, unit)
  if (order === undefined) return null
  const location = findPieceByOrder(snapshot.root, order)
  if (
    !location ||
    location.piece.buffer !== buffer ||
    unit < location.piece.start ||
    unit >= location.piece.start + location.piece.length
  )
    return null
  return location
}

/** Unknown IDs return null; hidden characters retain their exact storage position. */
export const locateCharId = (snapshot: PieceTableSnapshot, id: CharId): CharIdLocation | null => {
  validateCharId(id)
  const run = identityRunAtId(identitiesOf(snapshot), id)
  if (!run) return null
  const unit = run.offset + id.counter - run.counter
  const location = storageLocation(snapshot, run.buffer, unit)
  if (!location) throw new RangeError('character identity storage is missing')
  const { piece, visibleStart } = location
  return {
    piece,
    unit,
    visibleStart,
    offset: visibleStart + (piece.visible ? unit - piece.start : 0),
    liveness: piece.visible ? 'live' : 'deleted',
  }
}

const visibleLocation = (root: PieceTreeNode | null, offset: number): AnchorLocation => {
  const location =
    findVisiblePieceStartingAt(root, offset) ?? findVisiblePieceContainingOffset(root, offset)
  if (!location) throw new RangeError('visible character storage is missing')
  return location
}

/** The visible UTF-16 unit at offset. The document's end has no character. */
export const charIdAt = (snapshot: PieceTableSnapshot, offset: number): CharId | null => {
  const index = identitiesOf(snapshot)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.length)
    throw new RangeError('invalid character offset')
  if (offset === snapshot.length) return null
  const { piece, visibleStart } = visibleLocation(snapshot.root, offset)
  const unit = piece.start + offset - visibleStart
  const run = identityRunAtStorage(index, piece.buffer, unit)
  if (!run) throw new RangeError('visible character has no identity')
  return { bunch: run.bunch, counter: run.counter + unit - run.offset }
}

const appendSpan = (spans: CharIdSpan[], start: CharId, count: number): void => {
  const previous = spans.at(-1)
  if (
    previous &&
    previous.start.bunch === start.bunch &&
    previous.start.counter + previous.count === start.counter
  ) {
    spans[spans.length - 1] = { start: previous.start, count: previous.count + count }
    return
  }
  spans.push({ start, count })
}

/** Authoring-edge conversion: rejects a selection that cuts a surrogate pair. */
export const charIdSpansInRange = (
  snapshot: PieceTableSnapshot,
  from: number,
  to: number,
): readonly CharIdSpan[] => {
  const index = identitiesOf(snapshot)
  ensureValidRange(snapshot, from, to)
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to))
    throw new RangeError('invalid character range')
  if (splitsSurrogatePair(snapshot, from) || splitsSurrogatePair(snapshot, to))
    throw new RangeError('character range splits a surrogate pair')
  const spans: CharIdSpan[] = []
  let offset = from
  while (offset < to) {
    const { piece, visibleStart } = visibleLocation(snapshot.root, offset)
    const unit = piece.start + offset - visibleStart
    const run = identityRunAtStorage(index, piece.buffer, unit)
    if (!run) throw new RangeError('visible character has no identity')
    const count = Math.min(
      to - offset,
      piece.start + piece.length - unit,
      run.offset + run.count - unit,
    )
    appendSpan(spans, { bunch: run.bunch, counter: run.counter + unit - run.offset }, count)
    offset += count
  }
  return spans
}

type Boundary = { readonly piece: Piece; readonly offset: number } | null
const boundaryOf = (snapshot: PieceTableSnapshot, boundary: CharIdBoundary): Boundary => {
  const after = 'after' in boundary
  const id = after ? boundary.after : boundary.before
  if (id !== 'start' && id !== 'end') {
    const found = locateCharId(snapshot, id)
    if (!found) throw new RangeError('insertion boundary character is unknown')
    return { piece: found.piece, offset: found.unit - found.piece.start + (after ? 1 : 0) }
  }
  let node = snapshot.root
  if (!node) return null
  const side = after ? 'left' : 'right'
  while (node[side]) node = node[side]!
  return { piece: node.piece, offset: after ? 0 : node.piece.length }
}

const mergeRanges = (ranges: readonly PieceVisibilityRange[]): readonly PieceVisibilityRange[] => {
  const merged: PieceVisibilityRange[] = []
  for (const range of ranges.toSorted((a, b) => a.from - b.from)) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) {
      merged[merged.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) }
      continue
    }
    merged.push(range)
  }
  return merged
}

const ensureRetainedPayload = (
  snapshot: PieceTableSnapshot,
  buffer: PieceBufferId,
  from: number,
  to: number,
): void => {
  // Prove complete sparse coverage before editing the tree or advancing its epoch.
  while (from < to) from = Math.min(to, bufferSpanAt(snapshot.buffers, buffer, from).end)
}

const collectStorageRanges = (
  snapshot: PieceTableSnapshot,
  buffer: PieceBufferId,
  from: number,
  count: number,
  targets: Map<number, PieceVisibilityRange[]>,
  visible = false,
): void => {
  const end = from + count
  while (from < end) {
    const found = storageLocation(snapshot, buffer, from)
    if (!found) throw new RangeError('deletion character storage is missing')
    const piece = found.piece
    const to = Math.min(end, piece.start + piece.length)
    if (piece.visible !== visible) {
      if (visible) ensureRetainedPayload(snapshot, buffer, from, to)
      const ranges = targets.get(piece.order) ?? []
      ranges.push({ from: from - piece.start, to: to - piece.start, visible })
      targets.set(piece.order, ranges)
    }
    from = to
  }
}

const deletionTargets = (
  snapshot: PieceTableSnapshot,
  spans: readonly CharIdSpan[],
): ReadonlyMap<number, readonly PieceVisibilityRange[]> => {
  const index = identitiesOf(snapshot)
  const targets = new Map<number, PieceVisibilityRange[]>()
  for (const { start, count } of spans) {
    validateCharIdSpan(start, count)
    const end = start.counter + count
    let counter = start.counter
    while (counter < end) {
      const run = identityRunAtId(index, { bunch: start.bunch, counter })
      if (!run) throw new RangeError('deletion character is unknown')
      const taken = Math.min(end - counter, run.counter + run.count - counter)
      collectStorageRanges(snapshot, run.buffer, run.offset + counter - run.counter, taken, targets)
      counter += taken
    }
  }
  return new Map(Array.from(targets, ([order, ranges]) => [order, mergeRanges(ranges)]))
}

const canCoalesce = (index: IdentityIndex, boundary: Boundary, start: CharId): boolean => {
  if (!boundary || !boundary.piece.visible || boundary.offset !== boundary.piece.length)
    return false
  const { piece } = boundary
  const run = identityRunAtStorage(index, piece.buffer, piece.start + piece.length - 1)
  return (
    run !== null &&
    run.bunch === start.bunch &&
    run.counter + piece.start + piece.length - run.offset === start.counter
  )
}

/** One persistent edit, including an optional delete+insert replacement. Placement
 * is supplied by the ordering engine; remote spans never pass through offsets. */
export const applyCharIdEdit = (
  snapshot: PieceTableSnapshot,
  edit: CharIdEdit,
): PieceTableSnapshot => {
  let index = identitiesOf(snapshot)
  const insertion = edit.insert?.text.length ? edit.insert : undefined
  if (insertion) {
    ensureUnusedCharIds(index, insertion.start, insertion.text.length)
    boundaryOf(snapshot, insertion.at)
  }
  const targets = deletionTargets(snapshot, edit.delete ?? [])
  if (targets.size === 0 && !insertion) return snapshot
  const epoch = editingEpoch(snapshot)
  const changes: Piece[] = []
  const hiding = { changes, normalizeOrders: false, snap: null }
  let root = setAtPieceRanges(
    snapshot.root,
    targets,
    Array.from(targets.keys()).sort((a, b) => a - b),
    snapshot.buffers,
    hiding,
    epoch,
  )
  let buffers = snapshot.buffers
  let reverseIndex = snapshot.reverseIndex
  if (!insertion) {
    if (hiding.normalizeOrders)
      return createNormalizedSnapshot(buffers, root, reverseIndex, changes, index)
    return createSnapshot(buffers, root, applyReverseIndexChanges(reverseIndex, changes), index)
  }
  // Hiding may split the named boundary's piece. Resolve against the updated
  // local index before insertion, with one epoch for the entire transaction.
  if (hiding.normalizeOrders) {
    const normalized = createNormalizedSnapshot(buffers, root, reverseIndex, changes, index)
    root = normalized.root
    reverseIndex = normalized.reverseIndex
  } else {
    reverseIndex = applyReverseIndexChanges(reverseIndex, changes)
  }
  const boundarySnapshot = { ...snapshot, root, reverseIndex, consumed: false }
  const boundary = boundaryOf(boundarySnapshot, insertion.at)
  changes.length = 0
  const context: InsertContext = {
    changes,
    normalizeOrders: false,
    snap: null,
    probe: { text: insertion.text, snap: false, leftTurns: [], lineBreaks: 0, outcome: 'insert' },
    appendedBuffers: null,
  }
  root = insertAtPieceBoundary(
    root,
    boundary?.piece.order ?? null,
    boundary?.offset ?? 0,
    buffers,
    context,
    epoch,
    canCoalesce(index, boundary, insertion.start),
  )
  if (context.probe.outcome === 'coalesce') {
    const piece = boundary!.piece
    index = addIdentityRun(index, {
      ...insertion.start,
      count: insertion.text.length,
      buffer: piece.buffer,
      offset: piece.start + piece.length,
    })
    buffers = extendTailChunk(buffers, insertion.text, context.probe.lineBreaks)
  } else {
    let counter = insertion.start.counter
    for (const piece of changes) {
      if (piece.buffer < buffers.nextBufferSequence) continue
      index = addIdentityRun(index, {
        bunch: insertion.start.bunch,
        counter,
        count: piece.length,
        buffer: piece.buffer,
        offset: piece.start,
      })
      counter += piece.length
    }
    buffers = context.appendedBuffers!
  }
  if (context.normalizeOrders)
    return createNormalizedSnapshot(buffers, root, reverseIndex, changes, index)
  return createSnapshot(buffers, root, applyReverseIndexChanges(reverseIndex, changes), index)
}

export const insertByCharId = (
  snapshot: PieceTableSnapshot,
  insertion: CharIdInsertion,
): PieceTableSnapshot => applyCharIdEdit(snapshot, { insert: insertion })
export const deleteByCharId = (
  snapshot: PieceTableSnapshot,
  spans: readonly CharIdSpan[],
): PieceTableSnapshot => applyCharIdEdit(snapshot, { delete: spans })

/** Change retained IDs' visibility without allocating identities or copying their payloads.
 * Spans must be disjoint, so contradictory visibility cannot depend on input order. */
export const setCharIdVisibility = (
  snapshot: PieceTableSnapshot,
  spans: readonly CharIdVisibility[],
): PieceTableSnapshot => {
  const index = identitiesOf(snapshot)
  const targets = new Map<number, PieceVisibilityRange[]>()
  const sorted = spans.toSorted((a, b) => {
    if (a.start.bunch !== b.start.bunch) return a.start.bunch < b.start.bunch ? -1 : 1
    return a.start.counter - b.start.counter
  })
  let previous: CharIdVisibility | undefined
  for (const span of sorted) {
    validateCharIdSpan(span.start, span.count)
    if (typeof span.visible !== 'boolean') throw new RangeError('invalid character visibility')
    if (
      previous &&
      previous.start.bunch === span.start.bunch &&
      previous.start.counter + previous.count > span.start.counter
    )
      throw new RangeError('overlapping character visibility spans')
    previous = span
    const end = span.start.counter + span.count
    let counter = span.start.counter
    while (counter < end) {
      const run = identityRunAtId(index, { bunch: span.start.bunch, counter })
      if (!run) throw new RangeError('visibility character is unknown')
      const taken = Math.min(end - counter, run.counter + run.count - counter)
      collectStorageRanges(
        snapshot,
        run.buffer,
        run.offset + counter - run.counter,
        taken,
        targets,
        span.visible,
      )
      counter += taken
    }
  }
  if (!targets.size) return snapshot
  for (const [order, ranges] of targets)
    targets.set(
      order,
      ranges.toSorted((a, b) => a.from - b.from),
    )
  const changes: Piece[] = []
  const context = { changes, normalizeOrders: false, snap: null }
  const root = setAtPieceRanges(
    snapshot.root,
    targets,
    [...targets.keys()].sort((a, b) => a - b),
    snapshot.buffers,
    context,
    editingEpoch(snapshot),
  )
  if (context.normalizeOrders)
    return createNormalizedSnapshot(snapshot.buffers, root, snapshot.reverseIndex, changes, index)
  return createSnapshot(
    snapshot.buffers,
    root,
    applyReverseIndexChanges(snapshot.reverseIndex, changes),
    index,
  )
}
