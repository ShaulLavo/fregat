import {
  captureIdentitySelections,
  resolveCharacterGap,
  resolveIdentitySelections,
} from './authoredHistory'
import {
  applyBatchToPieceTable,
  retainPieceTableSnapshot,
  pieceTableSnapshotsHaveSameText,
  type PieceTableAnchor,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import { createError } from './logging/errors'
import {
  createAnchorSelection,
  createSelectionSet,
  normalizeSelectionSet,
  resolveSelection,
  type SelectionSet,
} from './selections'
import type { TextEdit } from './tokens'

export function reconciledEdits(
  before: PieceTableSnapshot,
  after: PieceTableSnapshot,
  supplied: readonly TextEdit[] | undefined,
): readonly TextEdit[] {
  if (!supplied) {
    throw createError({
      code: 'EDITOR_RECONCILE_EDITS_REQUIRED',
      message: 'Reconciliation requires effective edits',
      why: 'The published edits describe the transition from the current snapshot to the final snapshot.',
      fix: 'Supply the current-to-final edits in the reconciliation options.',
      internal: { previousLength: before.length, nextLength: after.length },
    })
  }
  if (pieceTableSnapshotsHaveSameText(projectReconciliationEdits(before, supplied), after))
    return supplied
  throw createError({
    code: 'EDITOR_RECONCILE_EDITS_MISMATCH',
    message: 'Reconciliation edits do not produce the reconciled text',
    why: 'The published edits must describe the transition from the current snapshot to the final snapshot.',
    fix: 'Supply edits against the current snapshot that produce the final snapshot.',
    internal: {
      editCount: supplied.length,
      previousLength: before.length,
      nextLength: after.length,
    },
  })
}

export function projectReconciliationEdits(
  before: PieceTableSnapshot,
  edits: readonly TextEdit[],
): PieceTableSnapshot {
  // Offset projection checks visible text; the final snapshot owns authored identities.
  // Retaining the shared tree makes this constant-size scratch fork persistent.
  const projection = before.charIds
    ? { ...retainPieceTableSnapshot(before), charIds: null }
    : before
  return applyBatchToPieceTable(projection, edits)
}

export function reconcileSelections(
  before: PieceTableSnapshot,
  after: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
  edits: readonly TextEdit[],
): SelectionSet<PieceTableAnchor> {
  if (before.charIds && after.charIds) {
    const identity = captureIdentitySelections(before, set)
    if (
      identity.selections.every(
        (selection) =>
          resolveCharacterGap(after, selection.anchor) !== null &&
          resolveCharacterGap(after, selection.head) !== null,
      )
    ) {
      return resolveIdentitySelections(after, identity)
    }
  }
  const descending = edits.toSorted((left, right) => right.from - left.from)
  const selections = set.selections.map((selection) => {
    const resolved = resolveSelection(before, selection)
    const start = mapOffset(resolved.startOffset, anchorBias(selection.start), descending)
    const end = mapOffset(resolved.endOffset, anchorBias(selection.end), descending)
    return createAnchorSelection(
      after,
      resolved.reversed ? end : start,
      resolved.reversed ? start : end,
      {
        id: selection.id,
        goal: selection.goal,
        affinity: selection.affinity,
        cursorBias: anchorBias(selection.start),
      },
    )
  })
  return normalizeSelectionSet(after, {
    ...createSelectionSet(selections),
    lastAddedIndex: set.lastAddedIndex,
  })
}

function mapOffset(offset: number, bias: 'left' | 'right', edits: readonly TextEdit[]): number {
  let mapped = offset
  for (const edit of edits) {
    if (mapped < edit.from) continue
    if (mapped > edit.to) {
      mapped += edit.text.length - (edit.to - edit.from)
      continue
    }
    mapped = edit.from + (bias === 'right' ? edit.text.length : 0)
  }
  return mapped
}

function anchorBias(anchor: PieceTableAnchor): 'left' | 'right' {
  if (anchor.kind === 'anchor') return anchor.bias
  return anchor.kind === 'min' ? 'left' : 'right'
}
