/** A tile's width in px; it matches `--picker-tile-width` so the column count is exact. */
export const TILE_WIDTH_PX = 112
/** One row of tiles: the thumbnail, the name and the padding around them. */
export const TILE_ROW_PX = 124
const TILE_GAP_PX = 4
const GRID_PADDING_PX = 16

/** How many tiles fit across; at least one, and one while the width is still unknown. */
export function tileColumns(width: number | null) {
  if (width === null) return 1
  return Math.max(
    1,
    Math.floor((width - GRID_PADDING_PX + TILE_GAP_PX) / (TILE_WIDTH_PX + TILE_GAP_PX)),
  )
}

export function tileRows<T>(entries: readonly T[], columns: number): readonly (readonly T[])[] {
  const rows: T[][] = []
  for (let index = 0; index < entries.length; index += columns)
    rows.push(entries.slice(index, index + columns))
  return rows
}
