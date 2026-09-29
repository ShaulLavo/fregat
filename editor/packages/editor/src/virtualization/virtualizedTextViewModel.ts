import type { InjectedTextRow } from '../displayTransforms'
import type { TextSnapshot } from '../documentTextSnapshot'
import type { FoldMap } from '../foldMap'
import type { InlineMap } from '../inlineMap'
import { DisplayProjection } from './displayProjection'

export type VirtualizedTextProjectionInput = {
  readonly textSnapshot: TextSnapshot
  readonly foldMap: FoldMap | null
  readonly inlineMap: InlineMap | null
  readonly injectedTextRows: readonly InjectedTextRow[]
  readonly wrapColumn: number | null
  readonly tabSize: number
}

export type VirtualizedTextViewModelState = {
  textSnapshot: TextSnapshot
  textLength: number
  lineCount: number
  visibleLineCount: number
  foldMap: FoldMap | null
  inlineMap: InlineMap | null
  wrapColumn: number | null
  injectedTextRows: readonly InjectedTextRow[]
  tabSize: number
  projection: DisplayProjection
}

export function createVirtualizedTextViewModel(
  input: VirtualizedTextProjectionInput,
): VirtualizedTextViewModelState {
  const textLength = input.textSnapshot.length
  const foldMap = input.foldMap?.snapshot.length === textLength ? input.foldMap : null
  const inlineMap = input.inlineMap?.snapshot.length === textLength ? input.inlineMap : null
  const projection = new DisplayProjection({ ...input, foldMap, inlineMap })
  return {
    ...input,
    textLength,
    lineCount: input.textSnapshot.lineCount,
    visibleLineCount: projection.rowCount,
    foldMap,
    inlineMap,
    projection,
  }
}
