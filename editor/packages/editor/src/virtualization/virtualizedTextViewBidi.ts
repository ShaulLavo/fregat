import type { TextContent } from '../textContent'
import type { SelectionAffinity } from '../selections'
import { containsRTL, isSimpleRowText } from '../textCharacters'
import type { MeasuredText } from '../textMeasurements'
import type { VirtualizedBidiRun } from './virtualizedTextViewTypes'

type BidiClassifierMemo = {
  readonly revision: number
  readonly results: Map<TextContent, boolean>
  scans: number
}

type BidiClassifierHost = {
  readonly textRevision: number
}

const classifierMemos = new WeakMap<BidiClassifierHost, BidiClassifierMemo>()
const logicalBidiRunIndexes = new WeakMap<readonly VirtualizedBidiRun[], readonly number[]>()

export function memoizedContainsRTL(
  view: BidiClassifierHost,
  content: string | MeasuredText,
): boolean {
  if (typeof content !== 'string' && content.measurements) return content.measurements.containsRTL
  const text = typeof content === 'string' ? content : content.text
  const memo = classifierMemo(view)
  const cached = memo.results.get(text)
  if (cached !== undefined) return cached

  const result = !isSimpleRowText(text) && containsRTL(text)
  if (memo.results.size >= 128) memo.results.clear()
  memo.results.set(text, result)
  memo.scans += 1
  return result
}

export function rtlClassifierScanCount(view: BidiClassifierHost): number {
  return classifierMemos.get(view)?.scans ?? 0
}

export function bidiVisualRunIndexAt(
  runs: readonly VirtualizedBidiRun[],
  offset: number,
  affinity: SelectionAffinity,
): number | null {
  const logicalIndexes = logicalBidiRunIndexesFor(runs)
  const insertion = logicalRunInsertionIndex(runs, logicalIndexes, offset)
  const nextVisualIndex = logicalIndexes[insertion]
  if (nextVisualIndex !== undefined && runs[nextVisualIndex]!.startOffset === offset) {
    if (affinity === 'after') return nextVisualIndex
    return logicalIndexes[insertion - 1] ?? null
  }

  const previousVisualIndex = logicalIndexes[insertion - 1]
  if (previousVisualIndex === undefined) return null

  const previous = runs[previousVisualIndex]!
  if (offset < previous.endOffset) return previousVisualIndex
  if (affinity === 'before' && offset === previous.endOffset) return previousVisualIndex
  return null
}

function logicalBidiRunIndexesFor(runs: readonly VirtualizedBidiRun[]): readonly number[] {
  const cached = logicalBidiRunIndexes.get(runs)
  if (cached) return cached

  const indexByStart = new Map<number, number>()
  let firstVisualIndex = 0
  for (let visualIndex = 0; visualIndex < runs.length; visualIndex += 1) {
    const run = runs[visualIndex]!
    indexByStart.set(run.startOffset, visualIndex)
    if (run.startOffset < runs[firstVisualIndex]!.startOffset) firstVisualIndex = visualIndex
  }

  const indexes = linkedLogicalRunIndexes(runs, indexByStart, firstVisualIndex)
  logicalBidiRunIndexes.set(runs, indexes)
  return indexes
}

function linkedLogicalRunIndexes(
  runs: readonly VirtualizedBidiRun[],
  indexByStart: ReadonlyMap<number, number>,
  firstVisualIndex: number,
): readonly number[] {
  if (runs.length === 0) return []

  const indexes: number[] = []
  let visualIndex: number | undefined = firstVisualIndex
  while (visualIndex !== undefined && indexes.length < runs.length) {
    indexes.push(visualIndex)
    visualIndex = indexByStart.get(runs[visualIndex]!.endOffset)
  }
  return indexes
}

function logicalRunInsertionIndex(
  runs: readonly VirtualizedBidiRun[],
  logicalIndexes: readonly number[],
  offset: number,
): number {
  let low = 0
  let high = logicalIndexes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const start = runs[logicalIndexes[middle]!]!.startOffset
    if (start < offset) low = middle + 1
    else high = middle
  }
  return low
}

function classifierMemo(view: BidiClassifierHost): BidiClassifierMemo {
  const current = classifierMemos.get(view)
  if (current?.revision === view.textRevision) return current

  const memo = { revision: view.textRevision, results: new Map<TextContent, boolean>(), scans: 0 }
  classifierMemos.set(view, memo)
  return memo
}
