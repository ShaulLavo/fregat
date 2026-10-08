import {
  authoredPathChanges,
  resolveIdentitySelections,
  type CharacterGap,
  type AuthoredHistoryEdge,
  type DocumentAuthoredHistory,
} from './authoredHistory'
import {
  applyBatchToPieceTable,
  diffPieceTableSnapshots,
  locateCharId,
  type PieceTableAnchor,
  type PieceTableSnapshot,
  readPieceTableTextRange,
} from '@singapore-editor/textbuffer'

import type { DocumentTransaction, DocumentTransactionMetadata } from './documentSession'
import {
  editorHistoryNodes,
  restoreEditorHistory,
  type EditorHistory,
  type EditorHistoryNode,
  type HistoryNodeId,
  type RestoredEditorHistoryNode,
} from './history'
import {
  createAnchorSelection,
  createSelectionSet,
  normalizeSelectionSet,
  resolveSelection,
  type SelectionAffinity,
  type SelectionSet,
} from './selections'
import type { TextEdit } from './tokens'

export const SERIALIZED_EDITOR_HISTORY_VERSION = 1

export type SerializedEditorHistorySelection = {
  readonly anchor: number
  readonly head: number
  readonly affinity: SelectionAffinity
}

// Text is never stored, only the edits between neighbouring states: the current
// state's text is whatever the restoring buffer already holds.
export type SerializedEditorHistoryNode = {
  readonly authored?: AuthoredHistoryEdge
  readonly id: HistoryNodeId
  readonly parentId: HistoryNodeId | null
  readonly preferredChildId: HistoryNodeId | null
  readonly sequence: number
  readonly visitedAt: number
  readonly committedAt: number
  readonly sealed: boolean
  readonly selections: readonly SerializedEditorHistorySelection[]
  readonly selectionsBefore: readonly SerializedEditorHistorySelection[]
  readonly edits: readonly TextEdit[]
  readonly inverseEdits: readonly TextEdit[]
  readonly source: DocumentTransactionMetadata['source']
  readonly intent: DocumentTransactionMetadata['intent']
}

export type SerializedEditorHistory = {
  /** Identity checkpoint supplied by an ID-space author; offset histories omit it. */
  readonly authoredIdentity?: string
  readonly version: typeof SERIALIZED_EDITOR_HISTORY_VERSION
  readonly rootId: HistoryNodeId
  readonly currentId: HistoryNodeId
  readonly nextId: HistoryNodeId
  readonly clock: number
  // Length of the current state's text: a cheap guard against restoring over other text.
  readonly currentLength: number
  readonly nodes: readonly SerializedEditorHistoryNode[]
}

type Selections = SelectionSet<PieceTableAnchor>
type DocumentHistory = EditorHistory<PieceTableSnapshot, Selections, DocumentTransaction>
type DocumentHistoryNode = EditorHistoryNode<PieceTableSnapshot, Selections, DocumentTransaction>

export const serializeDocumentHistory = (
  history: DocumentHistory,
  authoredIdentity?: string,
): SerializedEditorHistory => ({
  ...(authoredIdentity ? { authoredIdentity } : {}),
  version: SERIALIZED_EDITOR_HISTORY_VERSION,
  rootId: history.rootId,
  currentId: history.currentId,
  nextId: history.nextId,
  clock: history.clock,
  currentLength: history.current.length,
  nodes: editorHistoryNodes(history).map((node) =>
    serializeNode(history, node, Boolean(authoredIdentity)),
  ),
})

const serializeNode = (
  history: DocumentHistory,
  node: DocumentHistoryNode,
  authored: boolean,
): SerializedEditorHistoryNode => {
  const parent = node.parentId === null ? undefined : history.nodes.get(node.parentId)
  const step = parent && !authored ? serializeStep(parent.snapshot, node) : EMPTY_STEP
  return {
    ...(node.transaction?.authored ? { authored: node.transaction.authored } : {}),
    id: node.id,
    parentId: node.parentId,
    preferredChildId: node.preferredChildId,
    sequence: node.sequence,
    visitedAt: node.visitedAt,
    committedAt: node.committedAt,
    sealed: node.sealed,
    selections: serializeSelections(node.snapshot, node.selections),
    selectionsBefore: serializeSelections(parent?.snapshot ?? node.snapshot, node.selectionsBefore),
    edits: step.edits,
    inverseEdits: step.inverseEdits,
    source: node.transaction?.metadata.source ?? 'programmatic',
    intent: node.transaction?.metadata.intent ?? 'programmatic-edit',
  }
}

type SerializedStep = {
  readonly edits: readonly TextEdit[]
  readonly inverseEdits: readonly TextEdit[]
}

const EMPTY_STEP: SerializedStep = { edits: [], inverseEdits: [] }

// A state replaced outside the graph no longer matches its recorded transaction, so
// the transaction is trusted only when it spans exactly parent to node.
const serializeStep = (
  parentSnapshot: PieceTableSnapshot,
  node: DocumentHistoryNode,
): SerializedStep => {
  const transaction = node.transaction
  if (
    transaction &&
    transaction.snapshotBefore === parentSnapshot &&
    transaction.snapshotAfter === node.snapshot
  ) {
    return { edits: transaction.edits, inverseEdits: transaction.inverseEdits }
  }

  return diffStep(parentSnapshot, node.snapshot)
}

const diffStep = (
  parentSnapshot: PieceTableSnapshot,
  snapshot: PieceTableSnapshot,
): SerializedStep => {
  const edit = diffPieceTableSnapshots(parentSnapshot, snapshot)
  if (!edit) return EMPTY_STEP
  const inverse: TextEdit = {
    from: edit.from,
    to: edit.from + edit.text.length,
    text: readPieceTableTextRange(parentSnapshot, edit.from, edit.to),
  }
  return { edits: [edit], inverseEdits: [inverse] }
}

const serializeSelections = (
  snapshot: PieceTableSnapshot,
  selections: Selections,
): readonly SerializedEditorHistorySelection[] =>
  selections.selections.map((selection) => {
    const resolved = resolveSelection(snapshot, selection)
    return {
      anchor: resolved.anchorOffset,
      head: resolved.headOffset,
      affinity: resolved.affinity,
    }
  })

export type RestoreDocumentHistoryOptions = {
  readonly authored?: DocumentAuthoredHistory
  readonly retainedStates?: number
}

// Returns null when the data cannot describe a history ending in `current`; the
// caller keeps the history it has.
export const restoreDocumentHistory = (
  data: SerializedEditorHistory,
  current: PieceTableSnapshot,
  options: RestoreDocumentHistoryOptions = {},
): DocumentHistory | null => {
  if (data.authoredIdentity) {
    if (!options.authored?.matchesIdentity(data.authoredIdentity)) return null
  } else if (options.authored) return null
  if (data.version !== SERIALIZED_EDITOR_HISTORY_VERSION) return null
  if (!data.authoredIdentity && data.currentLength !== current.length) return null

  const byId = new Map(data.nodes.map((node) => [node.id, node]))
  const snapshots = data.authoredIdentity
    ? restoreAuthoredSnapshots(data, byId, current, options.authored!)
    : restoreSnapshots(data, byId, current)
  if (!snapshots) return null

  const restored: RestoredEditorHistoryNode<PieceTableSnapshot, Selections, DocumentTransaction>[] =
    []
  for (const node of data.nodes) {
    const snapshot = snapshots.get(node.id)!
    const parentSnapshot = node.parentId === null ? null : snapshots.get(node.parentId)!
    restored.push(restoreNode(node, snapshot, parentSnapshot, byId))
  }

  return restoreEditorHistory(restored, {
    rootId: data.rootId,
    currentId: data.currentId,
    nextId: data.nextId,
    clock: data.clock,
    retainedStates: options.retainedStates,
  })
}

const restoreAuthoredSnapshots = (
  data: SerializedEditorHistory,
  byId: ReadonlyMap<HistoryNodeId, SerializedEditorHistoryNode>,
  current: PieceTableSnapshot,
  author: DocumentAuthoredHistory,
): Map<HistoryNodeId, PieceTableSnapshot> | null => {
  if (!current.charIds || !validGraph(data, byId)) return null
  if (data.nodes.some((node) => node.parentId !== null && !node.authored)) return null
  try {
    const operations = new Set<string>()
    for (const node of data.nodes) {
      if (!node.authored) continue
      if (!validAuthoredEdge(node.authored, current, operations)) return null
    }
    return new Map(
      data.nodes.map((node) => [
        node.id,
        author.preview(authoredPathChanges(byId, data.currentId, node.id)),
      ]),
    )
  } catch {
    return null
  }
}

const validCharacterGap = (snapshot: PieceTableSnapshot, gap: CharacterGap): boolean =>
  (gap.bias === 'left' || gap.bias === 'right') &&
  (gap.left === 'start' || locateCharId(snapshot, gap.left) !== null) &&
  (gap.right === 'end' || locateCharId(snapshot, gap.right) !== null)

const validAuthoredEdge = (
  edge: AuthoredHistoryEdge,
  snapshot: PieceTableSnapshot,
  operations: Set<string>,
): boolean => {
  if (edge.edits.length === 0) return false
  if (edge.id.actor !== edge.edits[0]!.actor || edge.id.seq !== edge.edits[0]!.seq) return false
  for (const operation of edge.edits) {
    const key = JSON.stringify([operation.actor, operation.seq])
    if (operation.actor !== edge.id.actor || operations.has(key)) return false
    operations.add(key)
  }
  return [edge.before, edge.after].every(
    (set) =>
      set.selections.length > 0 &&
      set.selections.every(
        (selection) =>
          validCharacterGap(snapshot, selection.anchor) &&
          validCharacterGap(snapshot, selection.head),
      ),
  )
}

// Inverse edits climb from the current state to the root; forward edits then fill in
// every other branch. A parent always has the smaller id, so id order resolves it first.
const restoreSnapshots = (
  data: SerializedEditorHistory,
  byId: ReadonlyMap<HistoryNodeId, SerializedEditorHistoryNode>,
  current: PieceTableSnapshot,
): Map<HistoryNodeId, PieceTableSnapshot> | null => {
  if (!validGraph(data, byId)) return null

  const snapshots = new Map<HistoryNodeId, PieceTableSnapshot>([[data.currentId, current]])
  let node = byId.get(data.currentId)!
  while (node.parentId !== null) {
    const parentSnapshot = applyStep(snapshots.get(node.id)!, node.inverseEdits)
    if (!parentSnapshot) return null
    snapshots.set(node.parentId, parentSnapshot)
    node = byId.get(node.parentId)!
  }

  for (const candidate of data.nodes.toSorted((left, right) => left.id - right.id)) {
    if (snapshots.has(candidate.id)) continue
    const snapshot = applyStep(snapshots.get(candidate.parentId!)!, candidate.edits)
    if (!snapshot) return null
    snapshots.set(candidate.id, snapshot)
  }
  return snapshots
}

const validGraph = (
  data: SerializedEditorHistory,
  byId: ReadonlyMap<HistoryNodeId, SerializedEditorHistoryNode>,
): boolean => {
  if (byId.size !== data.nodes.length) return false
  if (!byId.has(data.currentId)) return false
  if (byId.get(data.rootId)?.parentId !== null) return false

  for (const node of data.nodes) {
    if (node.id >= data.nextId) return false
    if (node.id === data.rootId) continue
    if (node.parentId === null || node.parentId >= node.id) return false
    if (!byId.has(node.parentId)) return false
  }
  return true
}

const applyStep = (
  snapshot: PieceTableSnapshot,
  edits: readonly TextEdit[],
): PieceTableSnapshot | null => {
  // Stored data is untrusted: the batch rejects an out-of-range or overlapping edit.
  try {
    return applyBatchToPieceTable(snapshot, edits)
  } catch {
    return null
  }
}

const restoreNode = (
  node: SerializedEditorHistoryNode,
  snapshot: PieceTableSnapshot,
  parentSnapshot: PieceTableSnapshot | null,
  byId: ReadonlyMap<HistoryNodeId, SerializedEditorHistoryNode>,
): RestoredEditorHistoryNode<PieceTableSnapshot, Selections, DocumentTransaction> => {
  const selections = node.authored
    ? resolveIdentitySelections(snapshot, node.authored.after)
    : restoreSelections(snapshot, node.selections)
  const selectionsBefore = node.authored
    ? resolveIdentitySelections(snapshot, node.authored.before)
    : parentSnapshot
      ? restoreSelections(parentSnapshot, node.selectionsBefore)
      : selections
  const preferred = node.preferredChildId
  // Authored execution uses effects; inspection edits come from today's parent/child previews.
  const step = node.authored && parentSnapshot ? diffStep(parentSnapshot, snapshot) : node
  return {
    id: node.id,
    parentId: node.parentId,
    preferredChildId:
      preferred !== null && byId.get(preferred)?.parentId === node.id ? preferred : null,
    sequence: node.sequence,
    visitedAt: node.visitedAt,
    committedAt: node.committedAt,
    // A typing run does not survive a reload, so no restored state is amendable.
    sealed: true,
    snapshot,
    selections,
    selectionsBefore,
    transaction: parentSnapshot
      ? {
          ...(node.authored ? { authored: node.authored } : {}),
          edits: step.edits,
          inverseEdits: step.inverseEdits,
          snapshotBefore: parentSnapshot,
          snapshotAfter: snapshot,
          selectionBefore: selectionsBefore,
          selectionAfter: selections,
          metadata: {
            source: node.source,
            intent: node.intent,
            logicalRevisionCount: 1,
            logicalRevisionScope: null,
          },
        }
      : undefined,
  }
}

const restoreSelections = (
  snapshot: PieceTableSnapshot,
  selections: readonly SerializedEditorHistorySelection[],
): Selections => {
  const clamp = (offset: number) => Math.max(0, Math.min(snapshot.length, offset))
  const restored = selections.map((selection) =>
    createAnchorSelection(snapshot, clamp(selection.anchor), clamp(selection.head), {
      affinity: selection.affinity,
    }),
  )
  if (restored.length === 0) restored.push(createAnchorSelection(snapshot, snapshot.length))
  return normalizeSelectionSet(snapshot, createSelectionSet(restored))
}
