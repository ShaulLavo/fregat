import type { VirtualizedFoldMarker } from './virtualizedTextViewTypes'

/** Only primary document rows in the current update pass are requested. */
export type FoldMarkerSource = {
  readonly size: number
  readRows(rows: readonly number[]): ReadonlyMap<number, VirtualizedFoldMarker>
  all(): readonly VirtualizedFoldMarker[]
}
