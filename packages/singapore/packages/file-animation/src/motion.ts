import type {
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { drawsAsPlainText } from './morph-frame'

export type TextOffsetRange = ReturnType<
  EditorViewContributionContext['getInlineReplacementRanges']
>[number]

export function reducedMotion(context: EditorViewContributionContext): boolean {
  const view = context.scrollElement.ownerDocument.defaultView
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function supportsLinearEasing(context: EditorViewContributionContext): boolean {
  const css = context.scrollElement.ownerDocument.defaultView?.CSS
  return css?.supports?.('animation-timing-function', 'linear(0, 1)') ?? false
}

/** Rows painted as their own source text, which the overlay can redraw. */
export function drawableRows(
  snapshot: Pick<EditorViewSnapshot, 'visibleRows'>,
  replaced: readonly TextOffsetRange[],
): Set<number> {
  const rows = new Set<number>()
  for (const row of snapshot.visibleRows) {
    if (row.kind !== 'text' || !drawsAsPlainText(row)) continue
    if (replaced.some((range) => range.start < row.endOffset && range.end > row.startOffset))
      continue
    rows.add(row.index)
  }
  return rows
}
