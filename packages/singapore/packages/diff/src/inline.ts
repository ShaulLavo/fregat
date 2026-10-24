import { diffWordsWithSpace } from 'diff'
import type { DiffHunkLine, DiffInlineRange } from './types'

type MutableDiffHunkLine = DiffHunkLine & {
  oldInlineRanges?: readonly DiffInlineRange[]
  newInlineRanges?: readonly DiffInlineRange[]
}

type WordPart = {
  readonly value: string
  readonly added?: boolean
  readonly removed?: boolean
}

export function annotateInlineChanges(lines: readonly DiffHunkLine[]): readonly DiffHunkLine[] {
  const result = lines.map((line) => ({ ...line }))
  let index = 0

  while (index < result.length) {
    const nextIndex = annotateChangeBlock(result, index)
    index = Math.max(index + 1, nextIndex)
  }

  return result
}

function annotateChangeBlock(lines: MutableDiffHunkLine[], start: number): number {
  const line = lines[start]
  if (!line || line.type === 'context') return start + 1

  const end = firstContextIndex(lines, start)
  annotateReplacementLines(lines, start, end)
  return end
}

function firstContextIndex(lines: readonly DiffHunkLine[], start: number): number {
  let index = start
  while (index < lines.length && lines[index]?.type !== 'context') index += 1
  return index
}

function annotateReplacementLines(lines: MutableDiffHunkLine[], start: number, end: number): void {
  const deletions = lineIndexesByType(lines, start, end, 'deletion')
  const additions = lineIndexesByType(lines, start, end, 'addition')
  const pairCount = Math.min(deletions.length, additions.length)

  // An unpaired line gets no ranges: its row background already says it is all new or all gone,
  // and a whole-line tint on top turns a multi-line addition into one opaque slab.
  for (let index = 0; index < pairCount; index += 1) {
    annotateLinePair(lines[deletions[index]!]!, lines[additions[index]!]!)
  }
}

function lineIndexesByType(
  lines: readonly DiffHunkLine[],
  start: number,
  end: number,
  type: 'addition' | 'deletion',
): number[] {
  const indexes: number[] = []
  for (let index = start; index < end; index += 1) {
    if (lines[index]?.type !== type) continue
    indexes.push(index)
  }

  return indexes
}

function annotateLinePair(oldLine: MutableDiffHunkLine, newLine: MutableDiffHunkLine): void {
  const ranges = inlineRangesForPair(oldLine.text, newLine.text)
  oldLine.oldInlineRanges = ranges.oldRanges
  newLine.newInlineRanges = ranges.newRanges
}

function inlineRangesForPair(
  oldText: string,
  newText: string,
): {
  readonly oldRanges: readonly DiffInlineRange[]
  readonly newRanges: readonly DiffInlineRange[]
} {
  const parts = diffWordsWithSpace(oldText, newText) as readonly WordPart[]
  const oldRanges: DiffInlineRange[] = []
  const newRanges: DiffInlineRange[] = []
  let oldOffset = 0
  let newOffset = 0

  for (const part of parts) {
    appendPartRanges(part, oldRanges, newRanges, oldOffset, newOffset)
    if (!part.added) oldOffset += part.value.length
    if (!part.removed) newOffset += part.value.length
  }

  return { oldRanges, newRanges }
}

function appendPartRanges(
  part: WordPart,
  oldRanges: DiffInlineRange[],
  newRanges: DiffInlineRange[],
  oldOffset: number,
  newOffset: number,
): void {
  if (part.removed) oldRanges.push({ start: oldOffset, end: oldOffset + part.value.length })
  if (part.added) newRanges.push({ start: newOffset, end: newOffset + part.value.length })
}
