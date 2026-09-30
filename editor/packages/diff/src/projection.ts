import type { DiffFile, DiffHunk, DiffHunkLine, DiffInlineRange, DiffRenderRow } from './types'

export type SplitDiffProjection = {
  readonly leftRows: readonly DiffRenderRow[]
  readonly rightRows: readonly DiffRenderRow[]
  readonly hunkRows: ReadonlyMap<number, number>
}

export type StackedDiffProjection = {
  readonly rows: readonly DiffRenderRow[]
  readonly hunkRows: ReadonlyMap<number, number>
}

type ChangeBlock = {
  readonly deletions: readonly DiffHunkLine[]
  readonly additions: readonly DiffHunkLine[]
}

type SkippedRange = {
  readonly oldStart: number
  readonly newStart: number
  readonly count: number
}

type DiffProjectionOptions = {
  /** Keys of the collapsed regions to render expanded, taken from `DiffRenderRow.expandKey`. */
  readonly expandedRegions?: ReadonlySet<string>
}

export function createSplitProjection(
  file: DiffFile,
  options: DiffProjectionOptions = {},
): SplitDiffProjection {
  const leftRows: DiffRenderRow[] = []
  const rightRows: DiffRenderRow[] = []
  const hunkRows = new Map<number, number>()
  let previousOldEnd = 0
  let previousNewEnd = 0

  for (const [hunkIndex, hunk] of file.hunks.entries()) {
    const range = skippedRangeBeforeHunk(hunk, previousOldEnd, previousNewEnd)
    const separator = separatorRow(file, range, hunkIndex, options)
    if (separator) pushSplitHunkSeparator(leftRows, rightRows, separator)
    hunkRows.set(hunkIndex, separator ? leftRows.length - 1 : leftRows.length)
    if (separator?.expanded) pushSplitExpandedRows(file, leftRows, rightRows, range, hunkIndex)
    pushSplitHunkRows(leftRows, rightRows, hunk.lines, hunkIndex)
    previousOldEnd = hunkEndLine(hunk.oldStart, hunk.oldLines)
    previousNewEnd = hunkEndLine(hunk.newStart, hunk.newLines)
  }

  const trailing = trailingSkippedRange(file, previousOldEnd, previousNewEnd)
  const trailingSeparator = separatorRow(file, trailing, undefined, options)
  if (trailingSeparator) {
    pushSplitHunkSeparator(leftRows, rightRows, trailingSeparator)
    if (trailingSeparator.expanded)
      pushSplitExpandedRows(file, leftRows, rightRows, trailing, undefined)
  }

  if (leftRows.length === 0) pushUnchangedFileSplitRows(file, leftRows, rightRows)
  return { leftRows, rightRows, hunkRows }
}

export function createStackedProjection(
  file: DiffFile,
  options: DiffProjectionOptions = {},
): StackedDiffProjection {
  const rows: DiffRenderRow[] = []
  const hunkRows = new Map<number, number>()
  let previousOldEnd = 0
  let previousNewEnd = 0

  for (const [hunkIndex, hunk] of file.hunks.entries()) {
    const range = skippedRangeBeforeHunk(hunk, previousOldEnd, previousNewEnd)
    const separator = separatorRow(file, range, hunkIndex, options)
    if (separator) rows.push(separator)
    hunkRows.set(hunkIndex, separator ? rows.length - 1 : rows.length)
    if (separator?.expanded) pushStackedExpandedRows(file, rows, range, hunkIndex)
    pushStackedHunkRows(rows, hunk.lines, hunkIndex)
    previousOldEnd = hunkEndLine(hunk.oldStart, hunk.oldLines)
    previousNewEnd = hunkEndLine(hunk.newStart, hunk.newLines)
  }

  const trailing = trailingSkippedRange(file, previousOldEnd, previousNewEnd)
  const trailingSeparator = separatorRow(file, trailing, undefined, options)
  if (trailingSeparator) {
    rows.push(trailingSeparator)
    if (trailingSeparator.expanded) pushStackedExpandedRows(file, rows, trailing, undefined)
  }

  if (rows.length === 0) pushUnchangedFileStackedRows(file, rows)
  return { rows, hunkRows }
}

function pushSplitHunkSeparator(
  leftRows: DiffRenderRow[],
  rightRows: DiffRenderRow[],
  row: DiffRenderRow,
): void {
  leftRows.push(row)
  rightRows.push(row)
}

function pushSplitHunkRows(
  leftRows: DiffRenderRow[],
  rightRows: DiffRenderRow[],
  lines: readonly DiffHunkLine[],
  hunkIndex: number,
): void {
  let index = 0
  while (index < lines.length) {
    const nextIndex = pushNextSplitRows(leftRows, rightRows, lines, index, hunkIndex)
    index = Math.max(index + 1, nextIndex)
  }
}

function pushSplitExpandedRows(
  file: DiffFile,
  leftRows: DiffRenderRow[],
  rightRows: DiffRenderRow[],
  range: SkippedRange,
  hunkIndex: number | undefined,
): void {
  for (let index = 0; index < range.count; index += 1) {
    leftRows.push(expandedSideRow(file.oldLines, range.oldStart + index, 'old', hunkIndex))
    rightRows.push(expandedSideRow(file.newLines, range.newStart + index, 'new', hunkIndex))
  }
}

function pushNextSplitRows(
  leftRows: DiffRenderRow[],
  rightRows: DiffRenderRow[],
  lines: readonly DiffHunkLine[],
  index: number,
  hunkIndex: number,
): number {
  const line = lines[index]
  if (!line) return index + 1
  if (line.type === 'context') {
    pushSplitContextLine(leftRows, rightRows, line, hunkIndex)
    return index + 1
  }

  const blockEnd = firstContextIndex(lines, index)
  pushSplitChangeBlock(leftRows, rightRows, changeBlock(lines, index, blockEnd), hunkIndex)
  return blockEnd
}

function pushSplitContextLine(
  leftRows: DiffRenderRow[],
  rightRows: DiffRenderRow[],
  line: DiffHunkLine,
  hunkIndex: number,
): void {
  leftRows.push(renderRowFromLine(line, 'context', 'old', hunkIndex))
  rightRows.push(renderRowFromLine(line, 'context', 'new', hunkIndex))
}

function pushSplitChangeBlock(
  leftRows: DiffRenderRow[],
  rightRows: DiffRenderRow[],
  block: ChangeBlock,
  hunkIndex: number,
): void {
  const count = Math.max(block.deletions.length, block.additions.length)
  for (let index = 0; index < count; index += 1) {
    leftRows.push(splitDeletionRow(block.deletions[index], hunkIndex))
    rightRows.push(splitAdditionRow(block.additions[index], hunkIndex))
  }
}

function splitDeletionRow(line: DiffHunkLine | undefined, hunkIndex: number): DiffRenderRow {
  if (!line) return placeholderRow(hunkIndex)
  return renderRowFromLine(line, 'deletion', 'old', hunkIndex, line.oldInlineRanges)
}

function splitAdditionRow(line: DiffHunkLine | undefined, hunkIndex: number): DiffRenderRow {
  if (!line) return placeholderRow(hunkIndex)
  return renderRowFromLine(line, 'addition', 'new', hunkIndex, line.newInlineRanges)
}

function pushStackedHunkRows(
  rows: DiffRenderRow[],
  lines: readonly DiffHunkLine[],
  hunkIndex: number,
): void {
  for (const line of lines) rows.push(stackedRowFromLine(line, hunkIndex))
}

function pushStackedExpandedRows(
  file: DiffFile,
  rows: DiffRenderRow[],
  range: SkippedRange,
  hunkIndex: number | undefined,
): void {
  for (let index = 0; index < range.count; index += 1) {
    rows.push(
      expandedBothRow(file.newLines, range.oldStart + index, range.newStart + index, hunkIndex),
    )
  }
}

function stackedRowFromLine(line: DiffHunkLine, hunkIndex: number): DiffRenderRow {
  if (line.type === 'deletion') {
    return renderRowFromLine(line, 'deletion', 'old', hunkIndex, line.oldInlineRanges)
  }
  if (line.type === 'addition') {
    return renderRowFromLine(line, 'addition', 'new', hunkIndex, line.newInlineRanges)
  }

  return renderRowFromLine(line, 'context', 'both', hunkIndex)
}

function renderRowFromLine(
  line: DiffHunkLine,
  type: 'context' | 'addition' | 'deletion',
  side: 'old' | 'new' | 'both',
  hunkIndex: number | undefined,
  inlineRanges: readonly DiffInlineRange[] = [],
): DiffRenderRow {
  return {
    type,
    text: renderLineText(line.text),
    oldLineNumber: side !== 'new' ? line.oldLineNumber : undefined,
    newLineNumber: side !== 'old' ? line.newLineNumber : undefined,
    hunkIndex,
    inlineRanges,
  }
}

function renderLineText(text: string): string {
  if (!isRawHunkHeader(text)) return text
  return ''
}

function isRawHunkHeader(text: string): boolean {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(text.trim())
}

function separatorRow(
  file: DiffFile,
  range: SkippedRange,
  hunkIndex: number | undefined,
  options: DiffProjectionOptions,
): DiffRenderRow | null {
  if (range.count <= 0) return null

  const expandKey = regionKey(range)
  const expanded = options.expandedRegions?.has(expandKey) ?? false
  const expandable = skippedRangeAvailable(file, range)
  const label = hunkSeparatorText(range.count, expandable, expanded)
  return {
    expanded,
    expandable,
    expandKey,
    type: 'hunk',
    text: label,
    hunkIndex,
    skippedLines: range.count,
  }
}

// A collapsed region is identified by where it starts on both sides rather than
// by its ordinal, so expansion state cannot land on an unrelated region when the
// same path is re-diffed into a different set of hunks.
function regionKey(range: SkippedRange): string {
  return `${range.oldStart}:${range.newStart}`
}

function hunkSeparatorText(lines: number, expandable: boolean, expanded: boolean): string {
  const suffix = `${lines} unmodified line${lines === 1 ? '' : 's'}`
  if (!expandable) return suffix
  return `${expanded ? 'Hide' : 'Show'} ${suffix}`
}

function skippedRangeAvailable(file: DiffFile, range: SkippedRange): boolean {
  if (range.count <= 0) return false
  if (range.oldStart < 1 || range.newStart < 1) return false
  if (range.oldStart + range.count - 1 > file.oldLines.length) return false
  return range.newStart + range.count - 1 <= file.newLines.length
}

function skippedRangeBeforeHunk(
  hunk: DiffHunk,
  previousOldEnd: number,
  previousNewEnd: number,
): SkippedRange {
  return {
    count: skippedUnmodifiedLines(hunk, previousOldEnd, previousNewEnd),
    newStart: previousNewEnd + 1,
    oldStart: previousOldEnd + 1,
  }
}

function trailingSkippedRange(
  file: DiffFile,
  previousOldEnd: number,
  previousNewEnd: number,
): SkippedRange {
  // Only a whole-file diff knows how long the tail is; a parsed patch carries
  // just the hunk lines, so its trailing region stays unknown and unrendered.
  if (file.hunks.length === 0 || file.isPartial) return { count: 0, newStart: 1, oldStart: 1 }

  const oldRemaining = contentLineCount(file.oldLines) - previousOldEnd
  const newRemaining = contentLineCount(file.newLines) - previousNewEnd
  return {
    count: Math.max(oldRemaining, newRemaining, 0),
    newStart: previousNewEnd + 1,
    oldStart: previousOldEnd + 1,
  }
}

function contentLineCount(lines: readonly string[]): number {
  if (lines.length === 0) return 0
  if (lines.at(-1) === '') return lines.length - 1
  return lines.length
}

function expandedSideRow(
  lines: readonly string[],
  lineNumber: number,
  side: 'old' | 'new',
  hunkIndex: number | undefined,
): DiffRenderRow {
  const text = lines[lineNumber - 1] ?? ''

  return renderRowFromLine(
    {
      newLineNumber: side === 'new' ? lineNumber : undefined,
      oldLineNumber: side === 'old' ? lineNumber : undefined,
      text,
      type: 'context',
    },
    'context',
    side,
    hunkIndex,
  )
}

function expandedBothRow(
  lines: readonly string[],
  oldLineNumber: number,
  newLineNumber: number,
  hunkIndex: number | undefined,
): DiffRenderRow {
  return renderRowFromLine(
    {
      newLineNumber,
      oldLineNumber,
      text: lines[newLineNumber - 1] ?? '',
      type: 'context',
    },
    'context',
    'both',
    hunkIndex,
  )
}

function skippedUnmodifiedLines(
  hunk: DiffHunk,
  previousOldEnd: number,
  previousNewEnd: number,
): number {
  return Math.max(hunk.oldStart - previousOldEnd - 1, hunk.newStart - previousNewEnd - 1, 0)
}

function hunkEndLine(start: number, count: number): number {
  if (count <= 0) return Math.max(0, start)
  return start + count - 1
}

function placeholderRow(hunkIndex: number): DiffRenderRow {
  return {
    type: 'placeholder',
    text: '',
    hunkIndex,
  }
}

function emptyRow(text: string): DiffRenderRow {
  return {
    type: 'empty',
    text,
  }
}

function pushNoChangesRows(leftRows: DiffRenderRow[], rightRows: DiffRenderRow[]): void {
  leftRows.push(emptyRow('No changes'))
  rightRows.push(emptyRow('No changes'))
}

/**
 * A whole-file diff with nothing changed still has a file in it — a pure rename, a mode change, two
 * sides that happen to match. Showing the text is the only useful thing a viewer can do with that,
 * and it is what every other diff viewer does; the alternative is a pane holding the word "No
 * changes", which tells the reader less than the file would.
 *
 * Rendered as plain context rows rather than as one collapsed region: there is no change for a
 * collapsed region to sit next to, so the reader would be one click away from every diff they
 * opened. A patch-only file (`isPartial`) has no text to fall back to and keeps the message.
 */
function pushUnchangedFileSplitRows(
  file: DiffFile,
  leftRows: DiffRenderRow[],
  rightRows: DiffRenderRow[],
): void {
  const range = unchangedFileRange(file)
  if (range.count <= 0) {
    pushNoChangesRows(leftRows, rightRows)
    return
  }

  pushSplitExpandedRows(file, leftRows, rightRows, range, undefined)
}

function pushUnchangedFileStackedRows(file: DiffFile, rows: DiffRenderRow[]): void {
  const range = unchangedFileRange(file)
  if (range.count <= 0) {
    rows.push(emptyRow('No changes'))
    return
  }

  pushStackedExpandedRows(file, rows, range, undefined)
}

function unchangedFileRange(file: DiffFile): SkippedRange {
  if (file.isPartial) return { count: 0, newStart: 1, oldStart: 1 }

  const count = Math.max(contentLineCount(file.oldLines), contentLineCount(file.newLines))
  return { count, newStart: 1, oldStart: 1 }
}

function firstContextIndex(lines: readonly DiffHunkLine[], start: number): number {
  let index = start
  while (index < lines.length && lines[index]?.type !== 'context') index += 1
  return index
}

function changeBlock(lines: readonly DiffHunkLine[], start: number, end: number): ChangeBlock {
  return {
    deletions: lines.slice(start, end).filter((line) => line.type === 'deletion'),
    additions: lines.slice(start, end).filter((line) => line.type === 'addition'),
  }
}
