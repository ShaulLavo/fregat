import type { TextContent } from '../textContent'
import {
  type DisplayRow,
  type InlineRow,
  type TransformBias,
  inlineColumnToSourceColumn,
  isDocumentTextDisplayRow,
  sourceColumnToInlineColumn,
} from '../displayTransforms'

/**
 * What a mounted row needs to convert between buffer offsets and indices into its own rendered text.
 * Rows without inline replacements carry no mapping, and both conversions below then collapse to the
 * plain `offset - row.startOffset` arithmetic they replaced.
 */
export type RowInlineMapping = {
  /** The whole buffer line in display space; its segments are line-absolute. */
  readonly line: InlineRow
  /** Buffer offset of source column 0 on this line. */
  readonly lineStartOffset: number
  /** Line-absolute display column where this row's text begins; non-zero only when wrapped. */
  readonly displayStartColumn: number
}

export type InlineMappedRow = {
  readonly startOffset: number
  readonly text: TextContent
  readonly inlineMapping?: RowInlineMapping | null
}

export function rowInlineMappingForDisplayRow(
  displayRow: DisplayRow | undefined,
): RowInlineMapping | null {
  if (!isDocumentTextDisplayRow(displayRow)) return null
  if (!displayRow.inlineRow) return null

  return {
    line: displayRow.inlineRow,
    lineStartOffset: displayRow.startOffset - displayRow.sourceStartColumn,
    displayStartColumn: displayRow.displayStartColumn,
  }
}

/** Buffer offset to an index into the row's rendered text. */
export function rowLocalIndexForOffset(
  row: InlineMappedRow,
  offset: number,
  bias: TransformBias = 'nearest',
): number {
  return localIndexForOffset(row.inlineMapping ?? null, row.startOffset, offset, bias)
}

/** An index into the row's rendered text back to a buffer offset. */
export function rowOffsetForLocalIndex(
  row: InlineMappedRow,
  local: number,
  bias: TransformBias = 'nearest',
): number {
  return offsetForLocalIndex(row.inlineMapping ?? null, row.startOffset, local, bias)
}

/**
 * Mapping-first forms, for the chunk builders that run before the mapping lands on the row and so
 * cannot read it back off `row`.
 */
export function localIndexForOffset(
  mapping: RowInlineMapping | null,
  rowStartOffset: number,
  offset: number,
  bias: TransformBias = 'nearest',
): number {
  if (!mapping) return offset - rowStartOffset

  const sourceColumn = offset - mapping.lineStartOffset
  const displayColumn = sourceColumnToInlineColumn(mapping.line, sourceColumn, bias)
  return displayColumn - mapping.displayStartColumn
}

export function offsetForLocalIndex(
  mapping: RowInlineMapping | null,
  rowStartOffset: number,
  local: number,
  bias: TransformBias = 'nearest',
): number {
  if (!mapping) return rowStartOffset + local

  const displayColumn = mapping.displayStartColumn + local
  const sourceColumn = inlineColumnToSourceColumn(mapping.line, displayColumn, bias)
  return mapping.lineStartOffset + sourceColumn
}
