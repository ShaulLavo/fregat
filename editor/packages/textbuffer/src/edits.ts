import type {
  Piece,
  PieceTableBuffers,
  PieceTableEdit,
  PieceTableTreeSnapshot,
  PieceTreeNode,
} from './pieceTableTypes'
import type { EditContext, HideSnap, InsertContext } from './internalTypes'
import { extendTailChunk } from './buffers'
import { applyReverseIndexChanges } from './reverseIndex'
import { codeUnitAt, ensureValidRange, splitsSurrogatePair } from './reads'
import { isHighSurrogate, isLowSurrogate, mendsCutAtEnd, mendsCutAtStart } from './surrogates'
import { createNormalizedSnapshot, createSnapshot, editingEpoch } from './snapshot'
import { getSubtreeVisibleLength } from './node'
import { hideVisibleRange, insertAtVisibleOffset } from './tree'

const compareEditsDescending = (left: PieceTableEdit, right: PieceTableEdit): number => {
  if (left.from !== right.from) return right.from - left.from
  return right.to - left.to
}

// Results of snapBatchEditRanges, by the snapshot they were snapped against.
const snappedAgainst = new WeakMap<readonly PieceTableEdit[], PieceTableTreeSnapshot>()

type BatchBoundaries = {
  readonly starts: ReadonlyMap<number, number>
  readonly ends: ReadonlyMap<number, number>
}

// Counted rather than a set membership test because several siblings may share
// a boundary, and only over the range edits: a collapsed edit consumes nothing
// at the offset it sits on, and snapEditToCodePoints moves it off that offset
// anyway, so crediting it with a surrogate half leaves the half behind.
const coveredByAnother = (boundaries: ReadonlyMap<number, number>, offset: number): boolean =>
  (boundaries.get(offset) ?? 0) > 0

// An edit only corrupts the buffer when it leaves half a surrogate pair behind,
// and it only does that when the replacement text does not put the missing half
// back. Checking the range alone would also widen edits that are already whole:
// syncTextEdit (editor/textEdits.ts) diffs by code unit, so swapping one emoji
// for another arrives as a replacement of a low surrogate by another low
// surrogate — perfectly safe, and expanding it would delete the character the
// caller was building. So the test is on the text this edit leaves behind, not
// on where its endpoints happen to fall.
const orphansSurrogateAtStart = (
  snapshot: PieceTableTreeSnapshot,
  edit: PieceTableEdit,
  boundaries: BatchBoundaries,
): boolean => {
  if (!splitsSurrogatePair(snapshot, edit.from)) return false
  // A sibling edit ending here consumes the leading half, so the pair leaves the
  // document whole rather than in halves.
  if (coveredByAnother(boundaries.ends, edit.from)) return false
  return !mendsCutAtStart(edit.text)
}

const orphansSurrogateAtEnd = (
  snapshot: PieceTableTreeSnapshot,
  edit: PieceTableEdit,
  boundaries: BatchBoundaries,
): boolean => {
  if (!splitsSurrogatePair(snapshot, edit.to)) return false
  if (coveredByAnother(boundaries.starts, edit.to)) return false
  return !mendsCutAtEnd(edit.text)
}

const snapEditToCodePoints = (
  snapshot: PieceTableTreeSnapshot,
  edit: PieceTableEdit,
  boundaries: BatchBoundaries,
): PieceTableEdit => {
  if (!snapshot.buffers.containsSurrogates) return edit

  const atStart = orphansSurrogateAtStart(snapshot, edit, boundaries)
  const atEnd = orphansSurrogateAtEnd(snapshot, edit, boundaries)
  if (!atStart && !atEnd) return edit

  // Asymmetric on purpose: a non-empty range expands outward so that deleting
  // half an emoji deletes the emoji, while a collapsed one moves left instead —
  // expanding a caret would turn an insertion point into a selection.
  if (edit.from === edit.to) return { ...edit, from: edit.from - 1, to: edit.to - 1 }
  return { ...edit, from: atStart ? edit.from - 1 : edit.from, to: atEnd ? edit.to + 1 : edit.to }
}

// Only snapping can produce an overlap here — the batch was checked before it —
// and the overlap is the one surrogate half both neighbours expanded across, so
// concatenating in document order is the whole of the repair. Throwing instead
// would surface a lone RangeError out of an ordinary multi-cursor replace.
const mergeSnappedOverlaps = (edits: readonly PieceTableEdit[]): readonly PieceTableEdit[] => {
  const merged: PieceTableEdit[] = []
  for (const edit of edits) {
    const previous = merged.at(-1)
    if (previous && edit.from < previous.to) {
      merged[merged.length - 1] = {
        from: previous.from,
        to: Math.max(previous.to, edit.to),
        text: previous.text + edit.text,
      }
      continue
    }

    merged.push(edit)
  }

  return merged
}

/**
 * The edits a batch will actually apply: validated, ordered, and snapped off any
 * surrogate pair they would otherwise split. Callers that report a change to
 * anyone else — the session's change events, undo inversion, incremental
 * re-render — must describe these, not the edits they were handed, or every
 * consumer is told about a transformation that did not happen.
 *
 * Snapping is idempotent, so a caller may run this and still hand the result to
 * applyBatchToPieceTable.
 */
export const snapBatchEditRanges = (
  snapshot: PieceTableTreeSnapshot,
  edits: readonly PieceTableEdit[],
): readonly PieceTableEdit[] => {
  const sorted = edits.toSorted((left, right) => left.from - right.from || left.to - right.to)

  let previousEnd = -1
  for (const edit of sorted) {
    ensureValidRange(snapshot, edit.from, edit.to)
    if (edit.from < previousEnd) throw new RangeError('batch edits must not overlap')
    previousEnd = edit.to
  }

  const boundaries = {
    starts: countBoundaries(sorted, (edit) => edit.from),
    ends: countBoundaries(sorted, (edit) => edit.to),
  }
  const snapped = mergeSnappedOverlaps(
    sorted.map((edit) => snapEditToCodePoints(snapshot, edit, boundaries)),
  )
  snappedAgainst.set(snapped, snapshot)
  return snapped
}

const countBoundaries = (
  edits: readonly PieceTableEdit[],
  offsetOf: (edit: PieceTableEdit) => number,
): ReadonlyMap<number, number> => {
  const counts = new Map<number, number>()
  for (const edit of edits) {
    // Collapsed edits are left out entirely — see coveredByAnother — which is
    // also why no edit can be counted at its own boundary any more.
    if (edit.from === edit.to) continue

    const offset = offsetOf(edit)
    counts.set(offset, (counts.get(offset) ?? 0) + 1)
  }

  return counts
}

// An edit call in flight. Every primitive edit of one call writes with one
// epoch and the reverse index is written once at the end, because no snapshot
// between the primitives is ever handed out.
type EditState = {
  buffers: PieceTableBuffers
  root: PieceTreeNode | null
  readonly changes: Piece[]
  normalizeOrders: boolean
}

const beginEdit = (snapshot: PieceTableTreeSnapshot): EditState => ({
  buffers: snapshot.buffers,
  root: snapshot.root,
  changes: [],
  normalizeOrders: false,
})

const finishEdit = (snapshot: PieceTableTreeSnapshot, state: EditState): PieceTableTreeSnapshot => {
  if (state.normalizeOrders) {
    return createNormalizedSnapshot(state.buffers, state.root, snapshot.reverseIndex, state.changes)
  }
  const reverseIndex = applyReverseIndexChanges(snapshot.reverseIndex, state.changes)
  return createSnapshot(state.buffers, state.root, reverseIndex)
}

const insertContext = (state: EditState, text: string, snap: boolean): InsertContext => ({
  changes: state.changes,
  normalizeOrders: false,
  snap: null,
  probe: { text, snap, leftTurns: [], lineBreaks: 0, outcome: 'insert' },
  appendedBuffers: null,
})

// One descent. The landing probes for a surrogate pair and for a piece the
// text can extend; a pair straddling two pieces asks for a retry one unit
// left, which is already snapped so it cannot recur.
const insertText = (
  state: EditState,
  from: number,
  text: string,
  snap: boolean,
  epoch: number,
): void => {
  const context = insertContext(state, text, snap)
  const root = insertAtVisibleOffset(state.root, from, state.buffers, context, epoch)
  if (context.probe.outcome === 'retry') return insertText(state, from - 1, text, false, epoch)

  state.root = root
  state.normalizeOrders ||= context.normalizeOrders
  if (context.probe.outcome !== 'coalesce') {
    state.buffers = context.appendedBuffers!
    return
  }
  state.buffers = extendTailChunk(state.buffers, text, context.probe.lineBreaks)
}

const hideRange = (
  state: EditState,
  edit: PieceTableEdit,
  epoch: number,
  snap: HideSnap | null,
): void => {
  const context = edit.text.length > 0 ? insertContext(state, edit.text, false) : null
  const hiding: EditContext = context ?? { changes: state.changes, normalizeOrders: false, snap }
  // An insert context is made without one; the range's own check rides on it.
  hiding.snap = snap
  const root = hideVisibleRange(
    state.root,
    edit.from,
    edit.to,
    state.buffers,
    hiding,
    epoch,
    context,
  )
  if (snap?.retry) return

  state.root = root
  state.normalizeOrders ||= hiding.normalizeOrders
  if (context) state.buffers = context.appendedBuffers!
}

// One descent for both halves of a replacement: the range is hidden and the
// text is placed where it began.
const replaceRange = (state: EditState, edit: PieceTableEdit, epoch: number): void => {
  if (edit.to <= edit.from) {
    if (edit.text.length > 0) insertText(state, edit.from, edit.text, false, epoch)
    return
  }

  hideRange(state, edit, epoch, null)
}

const unitAt = (state: EditState, offset: number): number =>
  codeUnitAt(state.root, state.buffers, offset)

// One range edit that nobody snapped: it has no sibling to consume a half for
// it, so the pass that hides the range checks its two ends; see HideSnap. The
// widened range is the one snapBatchEditRanges reports for the same edit.
const replaceUnsnappedRange = (
  state: EditState,
  edit: PieceTableEdit,
  length: number,
  epoch: number,
): void => {
  const text = edit.text
  const end = edit.to < length
  const snap = { text, start: edit.from > 0, end, retry: false, highAtPieceEnd: false }
  hideRange(state, edit, epoch, snap)
  if (snap.retry) {
    // The range starts on a low half at a piece's start. Nothing has changed
    // yet, so the piece before is read and the edit runs again from there.
    const from = isHighSurrogate(unitAt(state, edit.from - 1)) ? edit.from - 1 : edit.from
    const again = { text, start: false, end, retry: false, highAtPieceEnd: false }
    hideRange(state, { ...edit, from }, epoch, again)
    snap.highAtPieceEnd = again.highAtPieceEnd
  }
  if (!snap.highAtPieceEnd) return

  // The range ended on a high half at a piece's end. The unit that followed
  // it is as far from the document's end as it was before the edit.
  const after = getSubtreeVisibleLength(state.root) - (length - edit.to)
  if (!isLowSurrogate(unitAt(state, after))) return
  hideRange(state, { from: after, to: after + 1, text: '' }, epoch, null)
}

// An edit call with one edit. Its range is checked but never sorted, and an
// insert snaps at its landing as insertIntoPieceTable's does.
const applyOneEdit = (
  snapshot: PieceTableTreeSnapshot,
  state: EditState,
  edit: PieceTableEdit,
  epoch: number,
): void => {
  const length = snapshot.length
  const snaps = snapshot.buffers.containsSurrogates
  if (edit.to > edit.from && snaps) return replaceUnsnappedRange(state, edit, length, epoch)
  if (edit.to > edit.from) return hideRange(state, edit, epoch, null)

  const snap = snaps && edit.from > 0 && edit.from < length
  insertText(state, edit.from, edit.text, snap, epoch)
}

export const insertIntoPieceTable = (
  snapshot: PieceTableTreeSnapshot,
  offset: number,
  text: string,
): PieceTableTreeSnapshot => {
  if (text.length === 0) return snapshot
  if (offset < 0 || offset > snapshot.length) {
    throw new RangeError('invalid offset')
  }

  // The offset is snapped at the insert's landing; see InsertProbe. The
  // document's ends are never inside a pair, so those skip the probe's reads.
  const epoch = editingEpoch(snapshot)
  const state = beginEdit(snapshot)
  const snap = snapshot.buffers.containsSurrogates && offset > 0 && offset < snapshot.length
  insertText(state, offset, text, snap, epoch)
  return finishEdit(snapshot, state)
}

export const deleteFromPieceTable = (
  snapshot: PieceTableTreeSnapshot,
  offset: number,
  length: number,
): PieceTableTreeSnapshot => {
  if (length <= 0) return snapshot

  ensureValidRange(snapshot, offset, offset + length)
  const epoch = editingEpoch(snapshot)
  const state = beginEdit(snapshot)
  applyOneEdit(snapshot, state, { from: offset, to: offset + length, text: '' }, epoch)
  return finishEdit(snapshot, state)
}

// Snapped once, against this snapshot: re-snapping per edit as the tree
// changes underneath would measure offsets against a document that no longer
// matches the one the caller asked about. A caller that already ran
// snapBatchEditRanges on this snapshot is not made to pay for it again.
const snappedEdits = (
  snapshot: PieceTableTreeSnapshot,
  edits: readonly PieceTableEdit[],
): readonly PieceTableEdit[] => {
  if (snappedAgainst.get(edits) === snapshot) return edits
  return snapBatchEditRanges(snapshot, edits)
}

const applyUnsnappedEdit = (
  snapshot: PieceTableTreeSnapshot,
  edit: PieceTableEdit,
): PieceTableTreeSnapshot => {
  ensureValidRange(snapshot, edit.from, edit.to)
  if (edit.to === edit.from && edit.text.length === 0) return snapshot

  const epoch = editingEpoch(snapshot)
  const state = beginEdit(snapshot)
  applyOneEdit(snapshot, state, edit, epoch)
  return finishEdit(snapshot, state)
}

export const applyBatchToPieceTable = (
  snapshot: PieceTableTreeSnapshot,
  edits: readonly PieceTableEdit[],
): PieceTableTreeSnapshot => {
  if (edits.length === 0) return snapshot
  if (edits.length === 1 && snappedAgainst.get(edits) !== snapshot) {
    return applyUnsnappedEdit(snapshot, edits[0]!)
  }

  const applied = snappedEdits(snapshot, edits)
  if (!applied.some((edit) => edit.to > edit.from || edit.text.length > 0)) return snapshot

  const epoch = editingEpoch(snapshot)
  const state = beginEdit(snapshot)
  // Last first keeps earlier offsets valid. The sort is stable, so edits at
  // one offset apply in the order given and the later one lands in front.
  const ordered = applied.length === 1 ? applied : applied.toSorted(compareEditsDescending)
  for (const edit of ordered) replaceRange(state, edit, epoch)
  return finishEdit(snapshot, state)
}
