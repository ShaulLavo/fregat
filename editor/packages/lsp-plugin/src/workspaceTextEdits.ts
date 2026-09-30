import {
  applyBatchToPieceTable,
  createDocumentTextSnapshot,
  diffPieceTableSnapshots,
  offsetToPoint,
  pieceTableSnapshotsHaveSameText,
  pointToOffset,
  prepareDocumentTransactionSequence,
  readPieceTableTextRange,
} from '@singapore-editor/core/document'
import type {
  DocumentLogicalRevisionScope,
  DocumentTextSnapshot,
  EditorTextBuffer,
  PieceTableSnapshot,
  PreparedDocumentTransactionSequence,
  TextEdit,
  TextSnapshot,
} from '@singapore-editor/core/document'

import type { LspTextSnapshot } from '@singapore-editor/lsp'

import type {
  ParsedWorkspacePosition,
  ParsedWorkspaceTextEdit,
  WorkspaceEditFailure,
  WorkspaceEditFailureCode,
  WorkspaceEditOperation,
} from './workspaceEdit'

export type WorkspaceTextDocumentProvenance = {
  readonly textSnapshot: LspTextSnapshot
  readonly uri: string
  readonly version: number
}

export type WorkspaceTextReplaySegmentInput = {
  readonly operations: readonly {
    readonly operation: Extract<WorkspaceEditOperation, { kind: 'text-document' }>
    readonly operationIndex: number
  }[]
  readonly segmentIndex: number
  readonly uri: string
}

export type WorkspaceTextReplayTarget = {
  readonly buffer: EditorTextBuffer
  readonly expectedRevision: number
  readonly initialSnapshot: DocumentTextSnapshot
}

export type WorkspaceTextReplayInput = {
  readonly logicalRevisionScope: DocumentLogicalRevisionScope
  readonly provenance: readonly WorkspaceTextDocumentProvenance[]
  readonly segments: readonly WorkspaceTextReplaySegmentInput[]
  readonly target: WorkspaceTextReplayTarget
}

export type PreparedWorkspaceTextEdit = TextEdit & {
  readonly annotationId?: string
}

export type PreparedWorkspaceTextStep = {
  readonly edits: readonly PreparedWorkspaceTextEdit[]
  readonly operationIndex: number
  readonly snapshotAfter: PieceTableSnapshot
  readonly snapshotBefore: PieceTableSnapshot
  readonly uri: string
}

export type PreparedWorkspaceTextSegment = {
  readonly logicalRevisionCount: number
  readonly segmentIndex: number
  readonly sequenceSegmentIndex: number | null
  readonly simulatedVersionAfter: number | null
  readonly simulatedVersionBefore: number | null
  readonly snapshotAfter: PieceTableSnapshot
  readonly snapshotBefore: PieceTableSnapshot
  readonly steps: readonly PreparedWorkspaceTextStep[]
  readonly uri: string
}

export type PrepareWorkspaceTextReplayResult =
  | {
      readonly ok: true
      readonly segments: readonly PreparedWorkspaceTextSegment[]
      readonly sequence: PreparedDocumentTransactionSequence | null
    }
  | { readonly error: WorkspaceEditFailure; readonly ok: false }

type ReplayState = {
  snapshot: PieceTableSnapshot
  textSnapshot: TextSnapshot
  uri: string | null
  version: number | null
  versionUri: string | null
}

type SimulatedWorkspaceTextSegment = Omit<PreparedWorkspaceTextSegment, 'sequenceSegmentIndex'>

type SimulateSegmentResult =
  | { readonly ok: true; readonly segment: SimulatedWorkspaceTextSegment }
  | { readonly error: WorkspaceEditFailure; readonly ok: false }

type SimulateStepResult =
  | {
      readonly effective: boolean
      readonly ok: true
      readonly step: PreparedWorkspaceTextStep
    }
  | { readonly error: WorkspaceEditFailure; readonly ok: false }

type ConvertedWorkspaceTextBatch = {
  readonly applicationEdits: readonly TextEdit[]
  readonly preparedEdits: readonly PreparedWorkspaceTextEdit[]
}

type ConvertWorkspaceTextBatchResult =
  | { readonly ok: true; readonly value: ConvertedWorkspaceTextBatch }
  | { readonly error: WorkspaceEditFailure; readonly ok: false }

type SnapPreparedTextEditsResult =
  | { readonly ok: true; readonly value: readonly PreparedWorkspaceTextEdit[] }
  | { readonly error: WorkspaceEditFailure; readonly ok: false }

type IndexedPreparedWorkspaceTextEdit = {
  readonly edit: PreparedWorkspaceTextEdit
  readonly editIndex: number
}

type BoundaryCounts = {
  readonly ends: ReadonlyMap<number, number>
  readonly starts: ReadonlyMap<number, number>
}

export function prepareWorkspaceTextReplay(
  input: WorkspaceTextReplayInput,
): PrepareWorkspaceTextReplayResult {
  const targetFailure = targetGuardFailure(input.target)
  if (targetFailure) return { error: targetFailure, ok: false }

  const state = initialReplayState(input)
  const simulated: SimulatedWorkspaceTextSegment[] = []
  for (const segment of input.segments) {
    const result = simulateSegment(input, state, segment)
    if (!result.ok) return result
    simulated.push(result.segment)
  }

  const effective = simulated.filter((segment) => segment.logicalRevisionCount > 0)
  if (effective.length === 0) {
    return {
      ok: true,
      segments: bindNoOpSegments(simulated, input.target.initialSnapshot.snapshot),
      sequence: null,
    }
  }

  const sequence = prepareDocumentTransactionSequence(
    input.target.buffer,
    effective.map((segment) => sequenceInput(input.logicalRevisionScope, segment)),
  )
  if (!sequenceMatchesTarget(sequence, input.target)) {
    return replayFailed('snapshot-drift', 'Target buffer changed before replay was bound')
  }

  return {
    ok: true,
    segments: bindPreparedSegments(simulated, sequence),
    sequence,
  }
}

function targetGuardFailure(target: WorkspaceTextReplayTarget): WorkspaceEditFailure | null {
  if (target.buffer.getRevision() !== target.expectedRevision) {
    return failure('snapshot-drift', 'Target buffer revision does not match the replay guard')
  }
  if (target.buffer.getSnapshot() !== target.initialSnapshot.snapshot) {
    return failure('snapshot-drift', 'Target buffer snapshot does not match the replay guard')
  }
  return null
}

function initialReplayState(input: WorkspaceTextReplayInput): ReplayState {
  const uri = input.segments[0]?.uri ?? null
  const provenance = uri
    ? exactProvenance(input.provenance, uri, input.target.initialSnapshot)
    : null
  const version = validProvenanceVersion(provenance) ? provenance.version : null
  return {
    snapshot: input.target.initialSnapshot.snapshot,
    textSnapshot: input.target.initialSnapshot,
    uri,
    version,
    versionUri: version === null ? null : uri,
  }
}

function simulateSegment(
  input: WorkspaceTextReplayInput,
  state: ReplayState,
  segment: WorkspaceTextReplaySegmentInput,
): SimulateSegmentResult {
  enterSegmentUri(input.provenance, state, segment.uri)
  const snapshotBefore = state.snapshot
  const textSnapshotBefore = state.textSnapshot
  const simulatedVersionBefore = state.version
  const steps: PreparedWorkspaceTextStep[] = []
  let logicalRevisionCount = 0

  for (const entry of segment.operations) {
    const result = simulateStep(input.provenance, state, segment, entry)
    if (!result.ok) return result
    if (result.effective) logicalRevisionCount += 1
    steps.push(result.step)
  }

  canonicalizeSegmentSnapshot(state, steps, snapshotBefore, textSnapshotBefore)
  return {
    ok: true,
    segment: Object.freeze({
      logicalRevisionCount,
      segmentIndex: segment.segmentIndex,
      simulatedVersionAfter: state.version,
      simulatedVersionBefore,
      snapshotAfter: state.snapshot,
      snapshotBefore,
      steps: Object.freeze(steps),
      uri: segment.uri,
    }),
  }
}

function enterSegmentUri(
  provenance: readonly WorkspaceTextDocumentProvenance[],
  state: ReplayState,
  uri: string,
): void {
  if (state.uri === uri) return
  state.uri = uri
  state.versionUri = null

  const mapped = exactProvenance(provenance, uri, state.textSnapshot)
  if (!validProvenanceVersion(mapped)) return
  if (state.version !== null && state.version !== mapped.version) return
  state.version = mapped.version
  state.versionUri = uri
}

function simulateStep(
  provenance: readonly WorkspaceTextDocumentProvenance[],
  state: ReplayState,
  segment: WorkspaceTextReplaySegmentInput,
  entry: WorkspaceTextReplaySegmentInput['operations'][number],
): SimulateStepResult {
  if (entry.operation.uri !== segment.uri) {
    return replayFailed(
      'invalid-workspace-edit',
      'Text operation URI does not match its replay segment',
      entry.operationIndex,
    )
  }

  const versionFailure = validateOperationVersion(provenance, state, entry)
  if (versionFailure) return { error: versionFailure, ok: false }
  const converted = convertWorkspaceTextBatch(
    state.snapshot,
    entry.operation.edits,
    entry.operationIndex,
  )
  if (!converted.ok) return converted

  const snapshotBefore = state.snapshot
  const candidate = applyBatchToPieceTable(snapshotBefore, converted.value.applicationEdits)
  const effective = !pieceTableSnapshotsHaveSameText(snapshotBefore, candidate)
  state.snapshot = effective ? candidate : snapshotBefore
  if (effective) state.textSnapshot = createDocumentTextSnapshot(state.snapshot)

  const versionAdvanceFailure = advanceSimulatedVersion(state, effective, entry.operationIndex)
  if (versionAdvanceFailure) return { error: versionAdvanceFailure, ok: false }
  return {
    effective,
    ok: true,
    step: Object.freeze({
      edits: converted.value.preparedEdits,
      operationIndex: entry.operationIndex,
      snapshotAfter: state.snapshot,
      snapshotBefore,
      uri: segment.uri,
    }),
  }
}

function validateOperationVersion(
  provenance: readonly WorkspaceTextDocumentProvenance[],
  state: ReplayState,
  entry: WorkspaceTextReplaySegmentInput['operations'][number],
): WorkspaceEditFailure | null {
  const declared = entry.operation.version
  if (declared === null) return null
  if (!Number.isSafeInteger(declared)) {
    return failure('version-mismatch', 'Text document version must be a safe integer', {
      operationIndex: entry.operationIndex,
    })
  }

  const lineageFailure = establishVersionLineage(provenance, state, entry)
  if (lineageFailure) return lineageFailure
  if (state.version === declared) return null
  return failure('version-mismatch', 'Text document version does not match replay provenance', {
    operationIndex: entry.operationIndex,
  })
}

function establishVersionLineage(
  provenance: readonly WorkspaceTextDocumentProvenance[],
  state: ReplayState,
  entry: WorkspaceTextReplaySegmentInput['operations'][number],
): WorkspaceEditFailure | null {
  if (state.versionUri === entry.operation.uri && state.version !== null) return null

  const mapped = exactProvenance(provenance, entry.operation.uri, state.textSnapshot)
  if (!validProvenanceVersion(mapped)) {
    return failure('version-mismatch', 'No exact lane provenance exists for this text snapshot', {
      operationIndex: entry.operationIndex,
    })
  }
  if (state.version !== null && state.version !== mapped.version) {
    return failure('version-mismatch', 'URI provenance does not continue the simulated version', {
      operationIndex: entry.operationIndex,
    })
  }

  state.version = mapped.version
  state.versionUri = entry.operation.uri
  return null
}

function advanceSimulatedVersion(
  state: ReplayState,
  effective: boolean,
  operationIndex: number,
): WorkspaceEditFailure | null {
  if (!effective || state.version === null) return null
  if (!Number.isSafeInteger(state.version + 1)) {
    return failure('version-mismatch', 'Simulated text document version overflowed', {
      operationIndex,
    })
  }
  state.version += 1
  return null
}

function convertWorkspaceTextBatch(
  snapshot: PieceTableSnapshot,
  edits: readonly ParsedWorkspaceTextEdit[],
  operationIndex: number,
): ConvertWorkspaceTextBatchResult {
  const converted: IndexedPreparedWorkspaceTextEdit[] = []
  for (let editIndex = 0; editIndex < edits.length; editIndex += 1) {
    const result = convertWorkspaceTextEdit(snapshot, edits[editIndex]!, operationIndex, editIndex)
    if (!result.ok) return result
    converted.push({ edit: result.value, editIndex })
  }

  const sorted = converted.toSorted(compareIndexedEdits)
  const conflict = textBatchConflict(sorted, operationIndex)
  if (conflict) return { error: conflict, ok: false }

  const effective = sorted.filter(({ edit }) => edit.from !== edit.to || edit.text.length > 0)
  const snapped = snapPreparedTextEdits(snapshot, effective, operationIndex)
  if (!snapped.ok) return snapped

  return {
    ok: true,
    value: Object.freeze({
      applicationEdits: Object.freeze(snapped.value.map(textEditWithoutAnnotation)),
      preparedEdits: snapped.value,
    }),
  }
}

function convertWorkspaceTextEdit(
  snapshot: PieceTableSnapshot,
  edit: ParsedWorkspaceTextEdit,
  operationIndex: number,
  editIndex: number,
):
  | { readonly ok: true; readonly value: PreparedWorkspaceTextEdit }
  | { readonly error: WorkspaceEditFailure; readonly ok: false } {
  const from = strictPositionOffset(snapshot, edit.range.start)
  if (from === null) return invalidPosition(operationIndex, editIndex, 'Invalid range start')
  const to = strictPositionOffset(snapshot, edit.range.end)
  if (to === null) return invalidPosition(operationIndex, editIndex, 'Invalid range end')
  if (from > to) {
    return replayFailed('reversed-range', 'Text edit range is reversed', operationIndex, editIndex)
  }

  return {
    ok: true,
    value: Object.freeze({
      ...(edit.annotationId === undefined ? {} : { annotationId: edit.annotationId }),
      from,
      text: normalizeInsertedText(edit.newText),
      to,
    }),
  }
}

function strictPositionOffset(
  snapshot: PieceTableSnapshot,
  position: ParsedWorkspacePosition,
): number | null {
  if (!Number.isInteger(position.line) || position.line < 0) return null
  if (!Number.isInteger(position.character) || position.character < 0) return null

  const offset = pointToOffset(snapshot, { column: position.character, row: position.line })
  const roundTrip = offsetToPoint(snapshot, offset)
  if (roundTrip.row !== position.line || roundTrip.column !== position.character) return null
  return offset
}

function textBatchConflict(
  edits: readonly IndexedPreparedWorkspaceTextEdit[],
  operationIndex: number,
): WorkspaceEditFailure | null {
  let previous: IndexedPreparedWorkspaceTextEdit | null = null
  for (const current of edits) {
    const conflict = conflictWithPrevious(previous, current, operationIndex)
    if (conflict) return conflict
    if (!previous || current.edit.to > previous.edit.to) previous = current
  }
  return null
}

function conflictWithPrevious(
  previous: IndexedPreparedWorkspaceTextEdit | null,
  current: IndexedPreparedWorkspaceTextEdit,
  operationIndex: number,
): WorkspaceEditFailure | null {
  if (!previous) return null
  const previousIsInsert = previous.edit.from === previous.edit.to
  const currentIsInsert = current.edit.from === current.edit.to
  if (previousIsInsert && currentIsInsert && previous.edit.from === current.edit.from) {
    return failure('ambiguous-inserts', 'Coincident inserts have no defined protocol order', {
      editIndex: current.editIndex,
      operationIndex,
    })
  }
  if (current.edit.from >= previous.edit.to) return null
  return failure('overlapping-edits', 'Text edit ranges overlap', {
    editIndex: current.editIndex,
    operationIndex,
  })
}

function snapPreparedTextEdits(
  snapshot: PieceTableSnapshot,
  edits: readonly IndexedPreparedWorkspaceTextEdit[],
  operationIndex: number,
): SnapPreparedTextEditsResult {
  const boundaries = batchBoundaryCounts(edits)
  const snapped = edits.map(({ edit, editIndex }) => ({
    edit: snapPreparedTextEdit(snapshot, edit, boundaries),
    editIndex,
  }))
  return mergeSnappedPreparedTextEdits(snapped, operationIndex)
}

function mergeSnappedPreparedTextEdits(
  edits: readonly IndexedPreparedWorkspaceTextEdit[],
  operationIndex: number,
): SnapPreparedTextEditsResult {
  const merged: PreparedWorkspaceTextEdit[] = []
  for (const current of edits) {
    const previous = merged.at(-1)
    if (!previous || current.edit.from >= previous.to) {
      merged.push(current.edit)
      continue
    }
    if (previous.annotationId !== current.edit.annotationId) {
      return replayFailed(
        'overlapping-edits',
        'Surrogate snapping cannot merge edits with different annotation ids',
        operationIndex,
        current.editIndex,
      )
    }

    merged[merged.length - 1] = Object.freeze({
      ...(previous.annotationId === undefined ? {} : { annotationId: previous.annotationId }),
      from: previous.from,
      text: previous.text + current.edit.text,
      to: Math.max(previous.to, current.edit.to),
    })
  }
  return { ok: true, value: Object.freeze(merged) }
}

function snapPreparedTextEdit(
  snapshot: PieceTableSnapshot,
  edit: PreparedWorkspaceTextEdit,
  boundaries: BoundaryCounts,
): PreparedWorkspaceTextEdit {
  const snapStart = orphansSurrogateAtStart(snapshot, edit, boundaries)
  const snapEnd = orphansSurrogateAtEnd(snapshot, edit, boundaries)
  if (!snapStart && !snapEnd) return edit

  const collapsed = edit.from === edit.to
  let from = edit.from
  let to = edit.to
  if (collapsed || snapStart) from -= 1
  if (collapsed) to -= 1
  if (!collapsed && snapEnd) to += 1
  return Object.freeze({ ...edit, from, to })
}

function orphansSurrogateAtStart(
  snapshot: PieceTableSnapshot,
  edit: PreparedWorkspaceTextEdit,
  boundaries: BoundaryCounts,
): boolean {
  if (!splitsSurrogatePair(snapshot, edit.from)) return false
  if ((boundaries.ends.get(edit.from) ?? 0) > 0) return false
  return !isLowSurrogate(edit.text.charCodeAt(0))
}

function orphansSurrogateAtEnd(
  snapshot: PieceTableSnapshot,
  edit: PreparedWorkspaceTextEdit,
  boundaries: BoundaryCounts,
): boolean {
  if (!splitsSurrogatePair(snapshot, edit.to)) return false
  if ((boundaries.starts.get(edit.to) ?? 0) > 0) return false
  return !isHighSurrogate(edit.text.charCodeAt(edit.text.length - 1))
}

function splitsSurrogatePair(snapshot: PieceTableSnapshot, offset: number): boolean {
  if (offset <= 0 || offset >= snapshot.length) return false
  const pair = readPieceTableTextRange(snapshot, offset - 1, offset + 1)
  return isHighSurrogate(pair.charCodeAt(0)) && isLowSurrogate(pair.charCodeAt(1))
}

function batchBoundaryCounts(edits: readonly IndexedPreparedWorkspaceTextEdit[]): BoundaryCounts {
  const starts = new Map<number, number>()
  const ends = new Map<number, number>()
  for (const { edit } of edits) {
    if (edit.from === edit.to) continue
    starts.set(edit.from, (starts.get(edit.from) ?? 0) + 1)
    ends.set(edit.to, (ends.get(edit.to) ?? 0) + 1)
  }
  return { ends, starts }
}

function canonicalizeSegmentSnapshot(
  state: ReplayState,
  steps: PreparedWorkspaceTextStep[],
  snapshotBefore: PieceTableSnapshot,
  textSnapshotBefore: TextSnapshot,
): void {
  if (!pieceTableSnapshotsHaveSameText(snapshotBefore, state.snapshot)) return
  state.snapshot = snapshotBefore
  state.textSnapshot = textSnapshotBefore

  const last = steps.at(-1)
  if (!last) return
  steps[steps.length - 1] = Object.freeze({ ...last, snapshotAfter: snapshotBefore })
}

function sequenceInput(
  logicalRevisionScope: DocumentLogicalRevisionScope,
  segment: SimulatedWorkspaceTextSegment,
) {
  const edit = diffPieceTableSnapshots(segment.snapshotBefore, segment.snapshotAfter)
  return {
    edits: edit ? [edit] : [],
    logicalRevisionCount: segment.logicalRevisionCount,
    logicalRevisionScope,
  }
}

function sequenceMatchesTarget(
  sequence: PreparedDocumentTransactionSequence,
  target: WorkspaceTextReplayTarget,
): boolean {
  return (
    sequence.expectedRevision === target.expectedRevision &&
    sequence.snapshotBefore === target.initialSnapshot.snapshot
  )
}

function bindNoOpSegments(
  simulated: readonly SimulatedWorkspaceTextSegment[],
  snapshot: PieceTableSnapshot,
): readonly PreparedWorkspaceTextSegment[] {
  return Object.freeze(simulated.map((segment) => bindSegment(segment, null, snapshot, snapshot)))
}

function bindPreparedSegments(
  simulated: readonly SimulatedWorkspaceTextSegment[],
  sequence: PreparedDocumentTransactionSequence,
): readonly PreparedWorkspaceTextSegment[] {
  const bound: PreparedWorkspaceTextSegment[] = []
  let sequenceSegmentIndex = 0
  let snapshot = sequence.snapshotBefore
  for (const segment of simulated) {
    if (segment.logicalRevisionCount === 0) {
      bound.push(bindSegment(segment, null, snapshot, snapshot))
      continue
    }

    const prepared = sequence.segments[sequenceSegmentIndex]!
    bound.push(
      bindSegment(segment, sequenceSegmentIndex, prepared.snapshotBefore, prepared.snapshotAfter),
    )
    snapshot = prepared.snapshotAfter
    sequenceSegmentIndex += 1
  }
  return Object.freeze(bound)
}

function bindSegment(
  segment: SimulatedWorkspaceTextSegment,
  sequenceSegmentIndex: number | null,
  snapshotBefore: PieceTableSnapshot,
  snapshotAfter: PieceTableSnapshot,
): PreparedWorkspaceTextSegment {
  return Object.freeze({
    ...segment,
    sequenceSegmentIndex,
    snapshotAfter,
    snapshotBefore,
    steps: bindStepBoundaries(segment.steps, snapshotBefore, snapshotAfter),
  })
}

function bindStepBoundaries(
  steps: readonly PreparedWorkspaceTextStep[],
  snapshotBefore: PieceTableSnapshot,
  snapshotAfter: PieceTableSnapshot,
): readonly PreparedWorkspaceTextStep[] {
  if (steps.length === 0) return steps
  const lastIndex = steps.length - 1
  return Object.freeze(
    steps.map((step, index) =>
      Object.freeze({
        ...step,
        snapshotAfter: index === lastIndex ? snapshotAfter : step.snapshotAfter,
        snapshotBefore: index === 0 ? snapshotBefore : step.snapshotBefore,
      }),
    ),
  )
}

function exactProvenance(
  provenance: readonly WorkspaceTextDocumentProvenance[],
  uri: string,
  textSnapshot: TextSnapshot,
): WorkspaceTextDocumentProvenance | null {
  return (
    provenance.find((entry) => entry.uri === uri && entry.textSnapshot === textSnapshot) ?? null
  )
}

function validProvenanceVersion(
  provenance: WorkspaceTextDocumentProvenance | null,
): provenance is WorkspaceTextDocumentProvenance {
  return provenance !== null && Number.isSafeInteger(provenance.version)
}

function textEditWithoutAnnotation(edit: PreparedWorkspaceTextEdit): TextEdit {
  return Object.freeze({ from: edit.from, text: edit.text, to: edit.to })
}

function compareIndexedEdits(
  left: IndexedPreparedWorkspaceTextEdit,
  right: IndexedPreparedWorkspaceTextEdit,
): number {
  return left.edit.from - right.edit.from || left.edit.to - right.edit.to
}

function normalizeInsertedText(text: string): string {
  return /[\r\u2028\u2029]/.test(text) ? text.replace(/\r\n|[\r\u2028\u2029]/g, '\n') : text
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function invalidPosition(
  operationIndex: number,
  editIndex: number,
  reason: string,
): { readonly error: WorkspaceEditFailure; readonly ok: false } {
  return replayFailed('invalid-position', reason, operationIndex, editIndex)
}

function replayFailed(
  code: WorkspaceEditFailureCode,
  reason: string,
  operationIndex?: number,
  editIndex?: number,
): { readonly error: WorkspaceEditFailure; readonly ok: false } {
  return {
    error: failure(code, reason, { editIndex, operationIndex }),
    ok: false,
  }
}

function failure(
  code: WorkspaceEditFailureCode,
  reason: string,
  indices: { readonly editIndex?: number; readonly operationIndex?: number } = {},
): WorkspaceEditFailure {
  return Object.freeze({
    code,
    reason,
    ...(indices.operationIndex === undefined ? {} : { operationIndex: indices.operationIndex }),
    ...(indices.editIndex === undefined ? {} : { editIndex: indices.editIndex }),
  })
}
