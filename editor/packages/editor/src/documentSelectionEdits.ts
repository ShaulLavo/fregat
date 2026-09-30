import { normalizeTabSize, visualColumnLength } from './displayTransforms'
import { previousDeleteBoundary } from './graphemes'
import {
  applyBatchToPieceTable,
  lineRange,
  offsetToPoint,
  type PieceTableAnchor,
  type PieceTableEdit,
  type PieceTableSnapshot,
  pointToOffset,
  readPieceTableTextRange,
} from '@singapore-editor/textbuffer'

import {
  createAnchorSelection,
  createSelectionSet,
  normalizeSelectionSet,
  resolveSelection,
  type AnchorSelection,
  type CreateAnchorSelectionOptions,
  type ResolvedSelection,
  type SelectionAffinity,
  type SelectionGoal,
  type SelectionSet,
} from './selections'

export type SelectionEditResult = {
  readonly snapshot: PieceTableSnapshot
  readonly selections: SelectionSet<PieceTableAnchor>
  readonly edits: readonly PieceTableEdit[]
}

type OffsetRange = {
  readonly start: number
  readonly end: number
}

type SelectionEditTarget = {
  readonly range: OffsetRange
  readonly id: string
  readonly goal: SelectionGoal
  readonly affinity: SelectionAffinity
}

const rangeLength = (range: OffsetRange): number => range.end - range.start

const rangeToEdit = (range: OffsetRange, text: string): PieceTableEdit => ({
  from: range.start,
  to: range.end,
  text,
})

const selectionToEditTarget = (selection: ResolvedSelection): SelectionEditTarget => ({
  range: {
    start: selection.startOffset,
    end: selection.endOffset,
  },
  id: selection.id,
  goal: selection.goal,
  affinity: selection.affinity,
})

const resolvedSelectionsToRanges = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
): ResolvedSelection[] => {
  const normalized = normalizeSelectionSet(snapshot, set)
  return normalized.selections.map((selection) => resolveSelection(snapshot, selection))
}

const collapseSelectionsAfterEdits = (
  snapshot: PieceTableSnapshot,
  targets: readonly SelectionEditTarget[],
  text: string,
): SelectionSet<PieceTableAnchor> => {
  let delta = 0
  const selections: AnchorSelection[] = []

  for (const target of targets) {
    const range = target.range
    const caretOffset = range.start + delta + text.length
    selections.push(
      createAnchorSelection(snapshot, caretOffset, caretOffset, {
        cursorBias: 'left',
        goal: target.goal,
        id: target.id,
        affinity: target.affinity,
      }),
    )
    delta += text.length - rangeLength(range)
  }

  return createSelectionSet(selections, true, snapshot)
}

export const applyTextToSelections = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
  text: string,
): SelectionEditResult => {
  const targets = resolvedSelectionsToRanges(snapshot, set).map(selectionToEditTarget)
  const edits = targets.map((target) => rangeToEdit(target.range, text))
  const nextSnapshot = applyBatchToPieceTable(snapshot, edits)

  return {
    snapshot: nextSnapshot,
    selections: collapseSelectionsAfterEdits(nextSnapshot, targets, text),
    edits,
  }
}

export const indentSelections = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
  text: string,
): SelectionEditResult => {
  if (text.length === 0) return emptySelectionEdit(snapshot, set)

  const selections = resolvedSelectionsToRanges(snapshot, set)
  const rows = touchedRowsForSelections(snapshot, selections)
  const edits = rows.map((row) => {
    const start = lineStart(snapshot, row)
    return rangeToEdit({ start, end: start }, text)
  })
  const nextSnapshot = applyBatchToPieceTable(snapshot, edits)

  return {
    snapshot: nextSnapshot,
    selections: createSelectionSet(
      selections.map((selection) => indentSelectionAfterEdits(nextSnapshot, selection, edits)),
      true,
      nextSnapshot,
    ),
    edits,
  }
}

export const outdentSelections = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
  tabSize: number,
): SelectionEditResult => {
  const normalizedTabSize = normalizeTabSize(tabSize)
  const selections = resolvedSelectionsToRanges(snapshot, set)
  const rows = touchedRowsForSelections(snapshot, selections)
  const edits = rows
    .map((row) => outdentEditForRow(snapshot, row, normalizedTabSize))
    .filter((edit): edit is PieceTableEdit => edit !== null)
  if (edits.length === 0) return emptySelectionEdit(snapshot, set)

  const nextSnapshot = applyBatchToPieceTable(snapshot, edits)
  return {
    snapshot: nextSnapshot,
    selections: createSelectionSet(
      selections.map((selection) => outdentSelectionAfterEdits(nextSnapshot, selection, edits)),
      true,
      nextSnapshot,
    ),
    edits,
  }
}

export const deleteSelections = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
): SelectionEditResult => {
  const normalized = normalizeSelectionSet(snapshot, set)
  const targets = normalized.selections
    .map((selection) => resolveSelection(snapshot, selection))
    .filter((selection) => !selection.collapsed)
    .map(selectionToEditTarget)
  const edits = targets.map((target) => rangeToEdit(target.range, ''))
  const nextSnapshot = applyBatchToPieceTable(snapshot, edits)

  if (edits.length === 0) {
    return {
      snapshot: nextSnapshot,
      selections: normalized,
      edits,
    }
  }

  return {
    snapshot: nextSnapshot,
    selections: collapseSelectionsAfterEdits(nextSnapshot, targets, ''),
    edits,
  }
}

export const backspaceSelections = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
  tabSize?: number,
): SelectionEditResult => {
  const normalized = normalizeSelectionSet(snapshot, set)
  const targets = normalized.selections
    .map((selection) => resolveSelection(snapshot, selection))
    .map((selection) => backspaceTargetForSelection(snapshot, selection, tabSize))
  const lastAddedTarget = targets[normalized.lastAddedIndex ?? 0]
  const orderedTargets = targets.toSorted(compareSelectionEditTargets)
  const edits = mergeOrderedTargetRanges(orderedTargets).map((range) => rangeToEdit(range, ''))
  const nextSnapshot = applyBatchToPieceTable(snapshot, edits)

  if (edits.length === 0) {
    return {
      snapshot: nextSnapshot,
      selections: normalized,
      edits,
    }
  }

  return {
    snapshot: nextSnapshot,
    selections: backspaceSelectionsAfterEdits(nextSnapshot, orderedTargets, edits, lastAddedTarget),
    edits,
  }
}

const backspaceSelectionsAfterEdits = (
  snapshot: PieceTableSnapshot,
  targets: readonly SelectionEditTarget[],
  edits: readonly PieceTableEdit[],
  lastAddedTarget: SelectionEditTarget | undefined,
): SelectionSet<PieceTableAnchor> => {
  const projectOffset = createBackspaceOffsetProjector(edits)
  const selections = targets.map((target) => {
    const offset = projectOffset(target.range.start)
    return createAnchorSelection(snapshot, offset, offset, {
      affinity: target.affinity,
      cursorBias: 'left',
      goal: target.goal,
      id: target.id,
    })
  })
  const lastAddedIndex = lastAddedTarget ? Math.max(0, targets.indexOf(lastAddedTarget)) : 0

  return normalizeSelectionSet(snapshot, {
    selections,
    lastAddedIndex,
    normalized: false,
  })
}

const createBackspaceOffsetProjector = (
  edits: readonly PieceTableEdit[],
): ((offset: number) => number) => {
  let delta = 0
  let editIndex = 0

  function projectOffset(offset: number): number {
    let edit = edits[editIndex]
    while (edit && offset > edit.to) {
      delta -= edit.to - edit.from
      editIndex += 1
      edit = edits[editIndex]
    }

    if (!edit || offset < edit.from) return offset + delta
    return edit.from + delta
  }

  return projectOffset
}

const emptySelectionEdit = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
): SelectionEditResult => ({
  snapshot,
  selections: normalizeSelectionSet(snapshot, set),
  edits: [],
})

const touchedRowsForSelections = (
  snapshot: PieceTableSnapshot,
  selections: readonly ResolvedSelection[],
): number[] => {
  const rows = new Set<number>()
  for (const selection of selections) {
    for (
      let row = firstTouchedRow(snapshot, selection);
      row <= lastTouchedRow(snapshot, selection);
      row += 1
    ) {
      rows.add(row)
    }
  }

  return Array.from(rows).sort((left, right) => left - right)
}

const firstTouchedRow = (snapshot: PieceTableSnapshot, selection: ResolvedSelection): number =>
  offsetToPoint(snapshot, selection.startOffset).row

const lastTouchedRow = (snapshot: PieceTableSnapshot, selection: ResolvedSelection): number => {
  const end = offsetToPoint(snapshot, selection.endOffset)
  if (selection.collapsed) return end.row
  if (end.column !== 0) return end.row
  return Math.max(firstTouchedRow(snapshot, selection), end.row - 1)
}

const lineStart = (snapshot: PieceTableSnapshot, row: number): number =>
  pointToOffset(snapshot, { row, column: 0 })

const outdentEditForRow = (
  snapshot: PieceTableSnapshot,
  row: number,
  tabSize: number,
): PieceTableEdit | null => {
  const { start, end } = lineRange(snapshot, row)
  if (start >= end) return null

  const prefix = readPieceTableTextRange(snapshot, start, Math.min(end, start + tabSize))
  const length = outdentLength(prefix, tabSize)
  if (length === 0) return null
  return rangeToEdit({ start, end: start + length }, '')
}

const outdentLength = (text: string, tabSize: number): number => {
  if (text[0] === '\t') return 1

  let spaces = 0
  while (spaces < text.length && spaces < tabSize && text[spaces] === ' ') spaces += 1
  return spaces
}

const indentSelectionAfterEdits = (
  snapshot: PieceTableSnapshot,
  selection: ResolvedSelection,
  edits: readonly PieceTableEdit[],
): AnchorSelection =>
  createAnchorSelection(
    snapshot,
    indentOffsetAfterEdits(selection.anchorOffset, edits),
    indentOffsetAfterEdits(selection.headOffset, edits),
    selectionOptions(selection),
  )

const indentOffsetAfterEdits = (offset: number, edits: readonly PieceTableEdit[]): number => {
  let delta = 0
  for (const edit of edits) {
    if (edit.from >= offset) continue
    delta += edit.text.length
  }

  return offset + delta
}

const outdentSelectionAfterEdits = (
  snapshot: PieceTableSnapshot,
  selection: ResolvedSelection,
  edits: readonly PieceTableEdit[],
): AnchorSelection =>
  createAnchorSelection(
    snapshot,
    outdentOffsetAfterEdits(selection.anchorOffset, edits),
    outdentOffsetAfterEdits(selection.headOffset, edits),
    selectionOptions(selection),
  )

const outdentOffsetAfterEdits = (offset: number, edits: readonly PieceTableEdit[]): number => {
  let delta = 0
  for (const edit of edits) {
    if (offset <= edit.from) break
    if (offset < edit.to) return edit.from + delta
    delta -= edit.to - edit.from
  }

  return offset + delta
}

const selectionOptions = (selection: ResolvedSelection): CreateAnchorSelectionOptions => ({
  id: selection.id,
  goal: selection.goal,
  reversed: selection.reversed,
  affinity: selection.affinity,
})

/**
 * How much text one backwards delete reads to decide what it is deleting. The choice is only ever
 * between the components at the tail of one cluster, and a joined emoji sequence runs to a few
 * dozen code units at the outside, so this much always holds every candidate.
 */
const DELETE_READ_WINDOW = 64

const characterDeleteStart = (snapshot: PieceTableSnapshot, offset: number): number => {
  const windowStart = Math.max(0, offset - DELETE_READ_WINDOW)
  const text = readPieceTableTextRange(snapshot, windowStart, offset)
  return windowStart + previousDeleteBoundary(text, text.length)
}

/**
 * Backspace inside a line's indentation takes back a whole level rather than one space.
 *
 * Spaces standing in for a tab were put there as a unit, so removing them one at a time makes
 * unindenting cost as many presses as the indent is wide. Landing on the previous tab stop rather
 * than counting a fixed number of spaces is what keeps a partial indent from stepping past it.
 * Everything before the caret has to be whitespace, or this would eat alignment padding sitting
 * between words.
 */
const indentDeleteStart = (
  snapshot: PieceTableSnapshot,
  offset: number,
  tabSize: number | undefined,
): number | null => {
  if (tabSize === undefined) return null

  const column = offsetToPoint(snapshot, offset).column
  if (column === 0) return null

  const indent = readPieceTableTextRange(snapshot, offset - column, offset)
  if (indent.at(-1) !== ' ') return null
  if (/[^\t ]/u.test(indent)) return null

  const normalizedTabSize = normalizeTabSize(tabSize)
  const width = visualColumnLength(indent, normalizedTabSize)
  // Measuring from one column back is what sends a caret already standing on a stop to the one
  // before it, rather than to the stop it is on.
  const previousStop = width - 1 - ((width - 1) % normalizedTabSize)
  return width - previousStop > 1 ? offset - (width - previousStop) : null
}

const backspaceRangeForSelection = (
  snapshot: PieceTableSnapshot,
  selection: ResolvedSelection,
  tabSize: number | undefined,
): OffsetRange => {
  if (!selection.collapsed) return { start: selection.startOffset, end: selection.endOffset }
  if (selection.startOffset === 0) return { start: 0, end: 0 }

  const end = selection.startOffset
  return {
    start: indentDeleteStart(snapshot, end, tabSize) ?? characterDeleteStart(snapshot, end),
    end,
  }
}

const backspaceTargetForSelection = (
  snapshot: PieceTableSnapshot,
  selection: ResolvedSelection,
  tabSize: number | undefined,
): SelectionEditTarget => {
  const range = backspaceRangeForSelection(snapshot, selection, tabSize)
  return {
    range,
    id: selection.id,
    goal: selection.goal,
    affinity: selection.affinity,
  }
}

const lastItem = <T>(items: readonly T[]): T | null => {
  if (items.length === 0) return null
  return items[items.length - 1] ?? null
}

const compareSelectionEditTargets = (
  left: SelectionEditTarget,
  right: SelectionEditTarget,
): number => left.range.start - right.range.start || left.range.end - right.range.end

const mergeOrderedTargetRanges = (targets: readonly SelectionEditTarget[]): OffsetRange[] => {
  const merged: OffsetRange[] = []

  for (const target of targets) {
    const range = target.range
    if (range.start === range.end) continue

    const previous = lastItem(merged)
    if (!previous || range.start > previous.end) {
      merged.push(range)
      continue
    }

    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, range.end),
    }
  }

  return merged
}
