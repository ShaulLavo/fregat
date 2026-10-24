import type {
  VirtualizedTextHighlightRange,
  VirtualizedTextRowDecoration,
} from '@singapore-editor/core/rendering'
import type { DiffRenderRow } from './types'

export function diffRowDecorations(
  rows: readonly DiffRenderRow[],
): ReadonlyMap<number, VirtualizedTextRowDecoration> {
  const decorations = new Map<number, VirtualizedTextRowDecoration>()
  for (const [index, row] of rows.entries()) {
    const decoration = decorationForRow(row)
    if (decoration) decorations.set(index, decoration)
  }
  return decorations
}

export function diffInlineHighlightRanges(
  rows: readonly DiffRenderRow[],
): readonly VirtualizedTextHighlightRange[] {
  const ranges: VirtualizedTextHighlightRange[] = []
  let offset = 0

  for (const row of rows) {
    appendInlineRanges(ranges, row, offset)
    offset += row.text.length + 1
  }

  return ranges
}

function appendInlineRanges(
  ranges: VirtualizedTextHighlightRange[],
  row: DiffRenderRow,
  rowOffset: number,
): void {
  for (const range of row.inlineRanges ?? []) {
    if (range.end <= range.start) continue
    ranges.push({ start: rowOffset + range.start, end: rowOffset + range.end })
  }
}

function decorationForRow(row: DiffRenderRow): VirtualizedTextRowDecoration | null {
  if (row.type === 'context') return null

  const expandable = row.expandable ? ' editor-diff-row-expandable' : ''
  return {
    snapshotStyle: 'colors',
    className: `editor-diff-row editor-diff-row-${row.type}${expandable}`,
    // The whole gutter row, so the tint also covers the gutter's leading inset.
    gutterClassName: `editor-diff-gutter-row editor-diff-gutter-band-${row.type}`,
  }
}
