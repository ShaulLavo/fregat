import { clampWidth } from '@workspace/ui/patterns/width-handle'

/** A column never narrows past its icon and a few characters, nor grows past most of the dialog. */
export const COLUMN_MIN_WIDTH_PX = 120
export const COLUMN_MAX_WIDTH_PX = 640

/** Widths the user gave columns this session, by depth; a depth absent here is the default. */
export type ColumnWidths = ReadonlyMap<number, number>

export const NO_COLUMN_WIDTHS: ColumnWidths = new Map()

export function withColumnWidth(widths: ColumnWidths, depth: number, width: number): ColumnWidths {
  const next = new Map(widths)
  next.set(depth, clampWidth(width, COLUMN_MIN_WIDTH_PX, COLUMN_MAX_WIDTH_PX))
  return next
}

/** The width that shows the widest name whole: its text plus the row's own chrome. */
export function fittedColumnWidth(nameWidths: readonly number[], chrome: number) {
  const widest = nameWidths.reduce((max, width) => Math.max(max, width), 0)
  return clampWidth(Math.ceil(widest + chrome), COLUMN_MIN_WIDTH_PX, COLUMN_MAX_WIDTH_PX)
}
