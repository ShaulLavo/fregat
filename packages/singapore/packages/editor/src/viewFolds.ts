import {
  anchorAfter,
  anchorBefore,
  offsetToPoint,
  resolveAnchor,
  type PieceTableAnchor,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import type { FoldRange } from './syntax/session'

export type EditorCollapsedRegion = {
  readonly start: PieceTableAnchor
  readonly end: PieceTableAnchor
  readonly rowSpan: number
}

export type EditorManualFold = {
  readonly start: PieceTableAnchor
  readonly end: PieceTableAnchor
  readonly type: string
  readonly languageId?: string
}

export type EditorViewFoldState = {
  readonly collapsedRegions: readonly EditorCollapsedRegion[]
  readonly manualFolds: readonly EditorManualFold[]
}

export function anchorManualFolds(
  snapshot: PieceTableSnapshot,
  folds: readonly FoldRange[],
): readonly EditorManualFold[] {
  return folds.map((fold) => ({
    start: anchorAfter(snapshot, fold.startIndex),
    end: anchorBefore(snapshot, fold.endIndex),
    type: fold.type,
    languageId: fold.languageId,
  }))
}

export function resolveManualFolds(
  snapshot: PieceTableSnapshot,
  folds: readonly EditorManualFold[],
): readonly FoldRange[] {
  const resolved: FoldRange[] = []
  for (const fold of folds) {
    const start = resolveAnchor(snapshot, fold.start)
    const end = resolveAnchor(snapshot, fold.end)
    if (start.liveness !== 'live' || end.liveness !== 'live') continue
    const startLine = offsetToPoint(snapshot, start.offset).row
    const endLine = offsetToPoint(snapshot, end.offset).row
    if (endLine <= startLine) continue
    resolved.push({
      startIndex: start.offset,
      endIndex: end.offset,
      startLine,
      endLine,
      type: fold.type,
      languageId: fold.languageId,
    })
  }
  return resolved
}
