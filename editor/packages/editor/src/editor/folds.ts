import type { TextSnapshot } from '../documentTextSnapshot'
import type { FoldRange } from '../syntax/session'
import type { TextEdit } from '../tokens'
import { firstBatchChangeEndingAtOrAfter, type TextEditBatch } from '../textEditBatch'
import type { VirtualizedFoldMarker } from '../virtualization/virtualizedTextView'
import { MANUAL_FOLD_TYPE } from './foldOperations'

export type FoldRangeRejection = {
  readonly kind: 'invalid-range' | 'overlap'
  readonly fold: FoldRange
  readonly message: string
  readonly previous?: FoldRange
}

export type FoldRangeIngestionResult = {
  readonly folds: readonly FoldRange[]
  readonly rejected: readonly FoldRangeRejection[]
}

export const EMPTY_FOLD_MARKERS: readonly VirtualizedFoldMarker[] = []

export function foldMarkerFromRange(fold: FoldRange, collapsed: boolean): VirtualizedFoldMarker {
  return {
    key: foldRangeKey(fold),
    startOffset: fold.startIndex,
    endOffset: fold.endIndex,
    startRow: fold.startLine,
    endRow: fold.endLine,
    collapsed,
  }
}

/**
 * Distinguishes one fold from its siblings within a single set of ranges. Every reparse renumbers
 * the offsets, so this is a per-generation label and never a durable identity for a region.
 */
export function foldRangeKey(fold: FoldRange): string {
  return `${fold.languageId ?? 'plain'}:${fold.type}:${fold.startIndex}:${fold.endIndex}`
}

export function foldRangesEqual(left: readonly FoldRange[], right: readonly FoldRange[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (!foldRangeEqual(left[index]!, right[index]!)) return false
  }

  return true
}

export function rejectCrossingFoldRanges(folds: readonly FoldRange[]): FoldRangeIngestionResult {
  const accepted: FoldRange[] = []
  const rejected: FoldRangeRejection[] = []
  const openAncestors: FoldRange[] = []

  for (const fold of sortedFoldRangesForIngestion(folds)) {
    const invalidMessage = invalidFoldRangeMessage(fold)
    if (invalidMessage) {
      rejected.push({ kind: 'invalid-range', fold, message: invalidMessage })
      continue
    }

    const parent = innermostOpenAncestor(openAncestors, fold)
    if (parent && fold.endIndex > parent.endIndex) {
      rejected.push({
        kind: 'overlap',
        fold,
        previous: parent,
        message: 'Fold ranges must not cross',
      })
      continue
    }

    accepted.push(fold)
    openAncestors.push(fold)
  }

  return { folds: accepted, rejected }
}

/**
 * Carries the last parsed fold geometry across an edit so gutter markers and the hidden-row map stay
 * on the rows they describe until the next parse lands. An edit that shifts no boundary — including
 * one that only moves characters within a row — yields null so callers can skip the resync.
 */
export function projectSyntaxFoldsThroughEdit(
  folds: readonly FoldRange[],
  edit: TextEdit,
  previousText: string | TextSnapshot,
): readonly FoldRange[] | null {
  if (folds.length === 0) return null

  const offsetDelta = edit.text.length - (edit.to - edit.from)
  const lineDelta = editLineDelta(edit, previousText)
  const projected: FoldRange[] = []
  for (const fold of folds) {
    const next = projectFoldRangeThroughEdit(fold, edit, offsetDelta, lineDelta)
    if (next) projected.push(next)
  }

  if (foldRangesEqual(folds, projected)) return null
  return projected
}

export function projectSyntaxFoldsThroughEdits(
  folds: readonly FoldRange[],
  batch: TextEditBatch,
): readonly FoldRange[] | null {
  if (folds.length === 0 || batch.changes.length === 0) return null
  const projected: FoldRange[] = []
  for (const fold of folds) {
    const next = projectFoldRangeThroughBatch(fold, batch)
    if (next) projected.push(next)
  }
  return foldRangesEqual(folds, projected) ? null : projected
}

function projectFoldRangeThroughBatch(fold: FoldRange, batch: TextEditBatch): FoldRange | null {
  const first = firstBatchChangeEndingAtOrAfter(batch, fold.startIndex)
  const firstChange = batch.changes[first]
  let startDelta = firstChange
    ? firstChange.afterFrom - firstChange.from
    : batch.after.length - batch.before.length
  let startLineDelta = firstChange
    ? firstChange.afterStartRow - firstChange.startRow
    : batch.after.lineCount - batch.before.lineCount
  let endDelta = startDelta
  let endLineDelta = startLineDelta
  for (let index = first; index < batch.changes.length; index += 1) {
    const change = batch.changes[index]!
    if (change.from >= fold.endIndex) break
    if (change.to <= fold.startIndex) {
      startDelta += change.offsetDelta
      startLineDelta += change.lineDelta
      endDelta += change.offsetDelta
      endLineDelta += change.lineDelta
      continue
    }
    if (change.from > fold.startIndex && change.to < fold.endIndex) {
      endDelta += change.offsetDelta
      endLineDelta += change.lineDelta
      continue
    }
    if (fold.type === MANUAL_FOLD_TYPE) return null
  }
  return {
    ...fold,
    startIndex: Math.max(0, fold.startIndex + startDelta),
    endIndex: Math.max(fold.startIndex + startDelta + 1, fold.endIndex + endDelta),
    startLine: Math.max(0, fold.startLine + startLineDelta),
    endLine: Math.max(fold.startLine + startLineDelta + 1, fold.endLine + endLineDelta),
  }
}

function sortedFoldRangesForIngestion(folds: readonly FoldRange[]): readonly FoldRange[] {
  return [...folds].toSorted(compareFoldRangesForIngestion)
}

function compareFoldRangesForIngestion(left: FoldRange, right: FoldRange): number {
  return (
    left.startIndex - right.startIndex ||
    right.endIndex - left.endIndex ||
    left.startLine - right.startLine ||
    right.endLine - left.endLine ||
    left.type.localeCompare(right.type) ||
    foldLanguageId(left).localeCompare(foldLanguageId(right))
  )
}

function foldLanguageId(fold: FoldRange): string {
  return fold.languageId ?? ''
}

function invalidFoldRangeMessage(fold: FoldRange): string | null {
  const integerMessage =
    invalidNonNegativeIntegerMessage(fold.startIndex, 'Fold range startIndex') ??
    invalidNonNegativeIntegerMessage(fold.endIndex, 'Fold range endIndex') ??
    invalidNonNegativeIntegerMessage(fold.startLine, 'Fold range startLine') ??
    invalidNonNegativeIntegerMessage(fold.endLine, 'Fold range endLine')
  if (integerMessage) return integerMessage
  if (fold.endIndex <= fold.startIndex) {
    return 'Fold range endIndex must be greater than startIndex'
  }
  if (fold.endLine <= fold.startLine) return 'Fold range endLine must be greater than startLine'
  return null
}

function invalidNonNegativeIntegerMessage(value: number, name: string): string | null {
  if (!Number.isInteger(value)) return `${name} must be an integer`
  if (value < 0) return `${name} must be non-negative`
  return null
}

function innermostOpenAncestor(openAncestors: FoldRange[], fold: FoldRange): FoldRange | null {
  while (openAncestors.length > 0) {
    const ancestor = openAncestors.at(-1)!
    if (ancestor.endIndex > fold.startIndex) return ancestor
    openAncestors.pop()
  }

  return null
}

function foldRangeEqual(left: FoldRange, right: FoldRange): boolean {
  return (
    left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.type === right.type &&
    left.languageId === right.languageId
  )
}

/**
 * Null for a region the edit leaves nothing to carry: what remains of a range whose boundary the edit
 * crossed is a guess, and a parse is what corrects a guess. A hand-drawn region never gets that
 * correction, so it goes with the text it was drawn over rather than staying on rows it no longer
 * describes, heading a chevron that hides live lines when the reader clicks it.
 */
function projectFoldRangeThroughEdit(
  fold: FoldRange,
  edit: TextEdit,
  offsetDelta: number,
  lineDelta: number,
): FoldRange | null {
  if (edit.to <= fold.startIndex) return shiftFoldRange(fold, offsetDelta, lineDelta)
  if (edit.from >= fold.endIndex) return fold
  if (edit.from > fold.startIndex && edit.to < fold.endIndex) {
    return resizeFoldRangeEnd(fold, offsetDelta, lineDelta)
  }

  return fold.type === MANUAL_FOLD_TYPE ? null : fold
}

function shiftFoldRange(fold: FoldRange, offsetDelta: number, lineDelta: number): FoldRange {
  return {
    ...fold,
    startIndex: Math.max(0, fold.startIndex + offsetDelta),
    endIndex: Math.max(0, fold.endIndex + offsetDelta),
    startLine: Math.max(0, fold.startLine + lineDelta),
    endLine: Math.max(0, fold.endLine + lineDelta),
  }
}

function resizeFoldRangeEnd(fold: FoldRange, offsetDelta: number, lineDelta: number): FoldRange {
  return {
    ...fold,
    endIndex: Math.max(fold.startIndex + 1, fold.endIndex + offsetDelta),
    endLine: Math.max(fold.startLine + 1, fold.endLine + lineDelta),
  }
}

function editLineDelta(edit: TextEdit, previousText: string | TextSnapshot): number {
  const deletedText = textInRange(previousText, edit.from, edit.to)
  return countLineBreaks(edit.text) - countLineBreaks(deletedText)
}

function textInRange(text: string | TextSnapshot, start: number, end: number): string {
  if (typeof text === 'string') return text.slice(start, end)
  return text.readRange(start, end)
}

function countLineBreaks(text: string): number {
  let count = 0

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') count += 1
  }

  return count
}
