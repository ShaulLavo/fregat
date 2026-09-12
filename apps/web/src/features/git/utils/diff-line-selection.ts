import {
  createSplitProjection,
  createStackedProjection,
  type DiffFile,
  type DiffRenderRow,
} from '@singapor/diff'

/** Which pane a row was read from — the split view's two, or the stacked one. */
export type DiffPaneSide = 'new' | 'old' | 'stacked'

type DiffLineRange = { readonly start: number; readonly end: number }

/**
 * Which lines a comment is about, in the only terms the two sides of a diff both
 * agree on: a range on the pre-image and a range on the post-image.
 *
 * Either may be null — a pure deletion names no new line, a pure addition names
 * no old one — and "line 42" with neither side attached is exactly the ambiguity
 * this type exists to make unrepresentable.
 */
export type DiffLineAddress = {
  readonly newRange: DiffLineRange | null
  readonly oldRange: DiffLineRange | null
}

/**
 * The rows a pane renders, projected the same way the diff plugin projects them,
 * so a row index read off `data-editor-virtual-row` addresses the same row here.
 * The side comes from the pane element rather than from the view mode, so there
 * is no second copy of "which pane am I in" to fall out of step.
 *
 * `expandedRegions` comes from the plugin's own region store rather than a
 * mirror of it. Region keys are `"{oldStart}:{newStart}"`, which is why the
 * mirror this replaced could never work: it keyed off `hunkIndex`, and a
 * trailing-tail region carries none.
 *
 * The stacked projection is still built here even when the panes on screen are
 * split — an address is resolved against both sides of the change, and in split
 * mode no plugin instance is holding a stacked projection to ask.
 */
export function diffPaneRows(
  file: DiffFile,
  side: DiffPaneSide,
  expandedRegions: ReadonlySet<string>,
): readonly DiffRenderRow[] {
  if (side === 'stacked') return createStackedProjection(file, { expandedRegions }).rows

  const projection = createSplitProjection(file, { expandedRegions })
  return side === 'old' ? projection.leftRows : projection.rightRows
}

/**
 * The rows a drag from `anchorRow` to `headRow` covers, in row order and without
 * the separators and padding rows that stand for no line on either side.
 */
export function selectedDiffRows(
  rows: readonly DiffRenderRow[],
  anchorRow: number,
  headRow: number,
): readonly DiffRenderRow[] {
  const start = Math.min(anchorRow, headRow)
  const end = Math.max(anchorRow, headRow)

  return rows.slice(start, end + 1).filter(isCodeRow)
}

export function diffLineAddress(rows: readonly DiffRenderRow[]): DiffLineAddress | null {
  const newRange = lineRange(rows, 'newLineNumber')
  const oldRange = lineRange(rows, 'oldLineNumber')
  if (!newRange && !oldRange) return null

  return { newRange, oldRange }
}

/**
 * Inverse of `diffLineAddress`: the contiguous block of rows an address names in
 * whatever projection is on screen now.
 *
 * Row indices die on a mode switch or a hunk expansion and line numbers do not,
 * which is why an address is what a selection is kept as — and why resolving it
 * against the stacked projection yields both sides of the change even when the
 * user dragged through a single split pane.
 *
 * Contiguous rather than "every matching row" so that what comes back is a diff
 * a reader can trust: the counts in a `@@` header only mean anything if nothing
 * was skipped between the first line and the last. Re-addressing the result is
 * therefore a fixed point — resolving it again cannot widen it further.
 */
export function diffRowsForAddress(
  rows: readonly DiffRenderRow[],
  address: DiffLineAddress,
): readonly DiffRenderRow[] {
  let first = -1
  let last = -1

  for (const [index, row] of rows.entries()) {
    if (!isCodeRow(row)) continue
    if (!addressCoversRow(address, row)) continue

    if (first < 0) first = index
    last = index
  }

  if (first < 0) return []

  return rows.slice(first, last + 1).filter(isCodeRow)
}

export function diffLineAddressLabel(address: DiffLineAddress): string {
  const sides: string[] = []
  if (address.newRange) sides.push(rangeLabel('new', address.newRange))
  if (address.oldRange) sides.push(rangeLabel('old', address.oldRange))

  return sides.join(', ')
}

/** What the agent receives: the file, the address, and the lines themselves. */
export function diffLineSelectionText(
  path: string,
  address: DiffLineAddress,
  rows: readonly DiffRenderRow[],
): string {
  const body = rows.map(markedLine)
  const fence = fenceFor(body)

  return [
    `About \`${path}\`, ${diffLineAddressLabel(address)}:`,
    '',
    `${fence}diff`,
    hunkHeader(address, rows),
    ...body,
    fence,
  ].join('\n')
}

function isCodeRow(row: DiffRenderRow): boolean {
  return row.type === 'addition' || row.type === 'context' || row.type === 'deletion'
}

function lineRange(
  rows: readonly DiffRenderRow[],
  key: 'newLineNumber' | 'oldLineNumber',
): DiffLineRange | null {
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY

  for (const row of rows) {
    const line = row[key]
    if (line === undefined) continue

    start = Math.min(start, line)
    end = Math.max(end, line)
  }

  if (end < start) return null

  return { end, start }
}

function addressCoversRow(address: DiffLineAddress, row: DiffRenderRow): boolean {
  if (coversLine(address.oldRange, row.oldLineNumber)) return true

  return coversLine(address.newRange, row.newLineNumber)
}

function coversLine(range: DiffLineRange | null, line: number | undefined): boolean {
  if (!range || line === undefined) return false

  return line >= range.start && line <= range.end
}

function rangeLabel(side: 'new' | 'old', range: DiffLineRange): string {
  if (range.start === range.end) return `${side} line ${range.start}`

  return `${side} lines ${range.start}-${range.end}`
}

function countLines(rows: readonly DiffRenderRow[], key: 'newLineNumber' | 'oldLineNumber') {
  return rows.reduce((count, row) => (row[key] === undefined ? count : count + 1), 0)
}

function hunkHeader(address: DiffLineAddress, rows: readonly DiffRenderRow[]): string {
  const oldPart = `-${address.oldRange?.start ?? 0},${countLines(rows, 'oldLineNumber')}`
  const newPart = `+${address.newRange?.start ?? 0},${countLines(rows, 'newLineNumber')}`

  return `@@ ${oldPart} ${newPart} @@`
}

function markedLine(row: DiffRenderRow): string {
  if (row.type === 'addition') return `+${row.text}`
  if (row.type === 'deletion') return `-${row.text}`

  return ` ${row.text}`
}

/** A selected line may itself contain a fence; the block has to outrun it. */
function fenceFor(lines: readonly string[]): string {
  const runs = lines.flatMap((line) => [...line.matchAll(/`+/g)].map((match) => match[0].length))

  return '`'.repeat(Math.max(3, Math.max(0, ...runs) + 1))
}
