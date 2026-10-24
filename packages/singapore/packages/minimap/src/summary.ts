import type { TextEdit, TextReadSnapshot } from '@singapore-editor/core/document'
import type { MinimapDocumentSummaryPayload, MinimapDocumentSummaryPatch } from './types'

type SummaryLineStarts = {
  readonly length: number
  at(index: number): number | undefined
  indexForOffset(offset: number): number
}

export type SummarySource = {
  readonly textLength: number
  readonly lineStarts: SummaryLineStarts
}

export function summarySource(read: TextReadSnapshot): SummarySource {
  return { textLength: read.length, lineStarts: sourceLineStarts(read) }
}

function sourceLineStarts(read: TextReadSnapshot): SummaryLineStarts {
  return {
    length: read.lineCount,
    at: (index) => (index >= 0 && index < read.lineCount ? read.lineStart(index) : undefined),
    indexForOffset: (offset) => read.lineAt(offset),
  }
}

export function documentSummaryPayload(
  text: TextReadSnapshot,
  maxColumn: number,
): MinimapDocumentSummaryPayload {
  const textLength = text.length
  const lineStarts = Array.from({ length: text.lineCount }, (_, line) => text.lineStart(line))
  return {
    textLength,
    lineStarts,
    lines: lineStarts.map((startOffset, index) =>
      lineSummaryFromSnapshot(text, startOffset, text.lineRange(index).end, maxColumn),
    ),
  }
}

export type SummaryShape = { readonly textLength: number; readonly lineCount: number }

export function sequentialMinimapEdits(canonical: readonly TextEdit[]): readonly TextEdit[] {
  let delta = 0
  return canonical
    .toSorted((left, right) => left.from - right.from || left.to - right.to)
    .map((edit) => {
      const from = edit.from + delta
      const to = edit.to + delta
      delta += edit.text.length - (edit.to - edit.from)
      return { from, to, text: edit.text }
    })
}

export function documentSummaryPatchPayload(
  text: TextReadSnapshot,
  previous: SummarySource,
  edits: readonly TextEdit[],
  maxColumn: number,
  workerDocument: SummaryShape | null,
): MinimapDocumentSummaryPatch {
  const textLength = text.length
  const lineStarts = sourceLineStarts(text)
  const range = documentSummaryPatchRange(previous, lineStarts, textLength, edits, workerDocument)
  const lines = []
  for (let lineIndex = range.startLine; lineIndex < range.insertEndLine; lineIndex += 1) {
    lines.push(
      lineSummaryFromSnapshot(
        text,
        lineStarts.at(lineIndex) ?? textLength,
        text.lineRange(lineIndex).end,
        maxColumn,
      ),
    )
  }

  return {
    textLength,
    startLine: range.startLine,
    deleteCount: range.deleteCount,
    lines,
  }
}

function lineSummaryFromSnapshot(
  text: TextReadSnapshot,
  startOffset: number,
  endOffset: number,
  maxColumn: number,
): MinimapDocumentSummaryPayload['lines'][number] {
  const length = Math.max(0, endOffset - startOffset)
  const clippedEnd = startOffset + Math.min(length, maxColumn)
  return {
    text: text.readRange(startOffset, clippedEnd),
    length,
  }
}

function lineEndOffset(lineStarts: SummaryLineStarts, index: number, textLength: number): number {
  const startOffset = lineStarts.at(index) ?? textLength
  const nextStart = lineStarts.at(index + 1)
  if (nextStart === undefined) return textLength
  return Math.max(startOffset, nextStart - 1)
}

type SummaryLineChangeRange = {
  readonly startLine: number
  readonly previousEndLine: number
  readonly nextEndLine: number
}

type DocumentSummaryPatchRange = {
  readonly startLine: number
  readonly deleteCount: number
  readonly insertEndLine: number
}

function documentSummaryPatchRange(
  previous: SummarySource,
  nextLineStarts: SummaryLineStarts,
  nextTextLength: number,
  edits: readonly TextEdit[],
  workerDocument: SummaryShape | null,
): DocumentSummaryPatchRange {
  const edited = editSummaryPatchRange(previous.lineStarts, nextLineStarts, edits)
  // Line-break-free edits explain every boundary change when document lengths match.
  // Newline edits and projection changes still require structural verification.
  if (
    edited &&
    workerDocument &&
    editsExplainTransition(workerDocument, nextLineStarts, nextTextLength, edits)
  ) {
    return normalizeSummaryPatchRange(edited, previous.lineStarts.length, nextLineStarts.length)
  }

  const structural = lineStartSummaryPatchRange(
    previous.lineStarts,
    previous.textLength,
    nextLineStarts,
    nextTextLength,
  )
  const changed = mergeSummaryPatchRanges(structural, edited)
  if (!changed) return { startLine: 0, deleteCount: 0, insertEndLine: 0 }

  return normalizeSummaryPatchRange(changed, previous.lineStarts.length, nextLineStarts.length)
}

function editsExplainTransition(
  workerDocument: SummaryShape,
  nextLineStarts: SummaryLineStarts,
  nextTextLength: number,
  edits: readonly TextEdit[],
): boolean {
  if (nextLineStarts.length !== workerDocument.lineCount) return false

  let textDelta = 0
  for (const edit of edits) {
    // With no inserted breaks and an unchanged line count, no breaks were
    // removed either; the math below is exact, not heuristic.
    if (edit.text.includes('\n')) return false
    textDelta += edit.text.length - (Math.max(edit.from, edit.to) - Math.min(edit.from, edit.to))
  }

  return workerDocument.textLength + textDelta === nextTextLength
}

function lineStartSummaryPatchRange(
  previousLineStarts: SummaryLineStarts,
  previousTextLength: number,
  nextLineStarts: SummaryLineStarts,
  nextTextLength: number,
): SummaryLineChangeRange | null {
  const prefix = commonLineSummaryPrefix(
    previousLineStarts,
    previousTextLength,
    nextLineStarts,
    nextTextLength,
  )
  const suffix = commonLineSummarySuffix(
    previousLineStarts,
    previousTextLength,
    nextLineStarts,
    nextTextLength,
    prefix,
  )
  if (prefix + suffix >= previousLineStarts.length && prefix + suffix >= nextLineStarts.length) {
    return null
  }

  return {
    startLine: prefix,
    previousEndLine: previousLineStarts.length - suffix,
    nextEndLine: nextLineStarts.length - suffix,
  }
}

function commonLineSummaryPrefix(
  previousLineStarts: SummaryLineStarts,
  previousTextLength: number,
  nextLineStarts: SummaryLineStarts,
  nextTextLength: number,
): number {
  let count = 0
  const limit = Math.min(previousLineStarts.length, nextLineStarts.length)
  while (
    count < limit &&
    lineSummaryBoundariesMatch(
      previousLineStarts,
      previousTextLength,
      count,
      nextLineStarts,
      nextTextLength,
      count,
      0,
    )
  ) {
    count += 1
  }

  return count
}

function commonLineSummarySuffix(
  previousLineStarts: SummaryLineStarts,
  previousTextLength: number,
  nextLineStarts: SummaryLineStarts,
  nextTextLength: number,
  prefix: number,
): number {
  let count = 0
  const delta = nextTextLength - previousTextLength
  const previousLimit = previousLineStarts.length - prefix
  const nextLimit = nextLineStarts.length - prefix

  while (count < previousLimit && count < nextLimit) {
    const previousIndex = previousLineStarts.length - count - 1
    const nextIndex = nextLineStarts.length - count - 1
    if (
      !lineSummaryBoundariesMatch(
        previousLineStarts,
        previousTextLength,
        previousIndex,
        nextLineStarts,
        nextTextLength,
        nextIndex,
        delta,
      )
    ) {
      return count
    }
    count += 1
  }

  return count
}

function lineSummaryBoundariesMatch(
  previousLineStarts: SummaryLineStarts,
  previousTextLength: number,
  previousIndex: number,
  nextLineStarts: SummaryLineStarts,
  nextTextLength: number,
  nextIndex: number,
  offsetDelta: number,
): boolean {
  const previousStart = previousLineStarts.at(previousIndex) ?? previousTextLength
  const nextStart = nextLineStarts.at(nextIndex) ?? nextTextLength
  if (previousStart + offsetDelta !== nextStart) return false

  return (
    lineEndOffset(previousLineStarts, previousIndex, previousTextLength) + offsetDelta ===
    lineEndOffset(nextLineStarts, nextIndex, nextTextLength)
  )
}

function editSummaryPatchRange(
  previousLineStarts: SummaryLineStarts,
  nextLineStarts: SummaryLineStarts,
  edits: readonly TextEdit[],
): SummaryLineChangeRange | null {
  let startOffset = Number.POSITIVE_INFINITY
  let previousEndOffset = 0
  let nextEndOffset = 0
  let offsetDelta = 0

  for (const edit of edits) {
    if (editIsEmpty(edit)) continue
    const from = Math.min(edit.from, edit.to)
    const to = Math.max(edit.from, edit.to)
    const editDelta = edit.text.length - (to - from)
    startOffset = Math.min(startOffset, from)
    // The unchanged suffix maps back by the accumulated delta; the changed end moves with each edit.
    previousEndOffset = Math.max(previousEndOffset, to - offsetDelta)
    nextEndOffset = Math.max(nextEndOffset, to) + editDelta
    offsetDelta += editDelta
  }

  if (startOffset === Number.POSITIVE_INFINITY) return null
  const previousRange = lineRangeForEdit(previousLineStarts, startOffset, previousEndOffset)
  const nextRange = lineRangeForEdit(nextLineStarts, startOffset, nextEndOffset)
  return {
    startLine: Math.min(previousRange.startLine, nextRange.startLine),
    previousEndLine: previousRange.endLine,
    nextEndLine: nextRange.endLine,
  }
}

function editIsEmpty(edit: TextEdit): boolean {
  return edit.from === edit.to && edit.text.length === 0
}

function lineRangeForEdit(
  lineStarts: SummaryLineStarts,
  from: number,
  to: number,
): { readonly startLine: number; readonly endLine: number } {
  const startOffset = Math.min(from, to)
  const endOffset = Math.max(from, to)
  const startLine = lineStarts.indexForOffset(startOffset)
  const endLine = lineStarts.indexForOffset(endOffset) + 1
  return { startLine, endLine }
}

function mergeSummaryPatchRanges(
  left: SummaryLineChangeRange | null,
  right: SummaryLineChangeRange | null,
): SummaryLineChangeRange | null {
  if (!left) return right
  if (!right) return left

  return {
    startLine: Math.min(left.startLine, right.startLine),
    previousEndLine: Math.max(left.previousEndLine, right.previousEndLine),
    nextEndLine: Math.max(left.nextEndLine, right.nextEndLine),
  }
}

function normalizeSummaryPatchRange(
  range: SummaryLineChangeRange,
  previousLineCount: number,
  nextLineCount: number,
): DocumentSummaryPatchRange {
  const startLine = Math.min(
    Math.max(0, range.startLine),
    Math.max(previousLineCount, nextLineCount),
  )
  const previousEndLine = Math.min(Math.max(startLine, range.previousEndLine), previousLineCount)
  const nextEndLine = Math.min(Math.max(startLine, range.nextEndLine), nextLineCount)
  // Both range ends must preserve the same suffix of complete lines.
  const suffixCount = Math.min(previousLineCount - previousEndLine, nextLineCount - nextEndLine)
  return {
    startLine,
    deleteCount: previousLineCount - suffixCount - startLine,
    insertEndLine: nextLineCount - suffixCount,
  }
}
