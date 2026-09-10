import type { EditorScrollPosition, EditorViewSnapshot } from '@singapor/core'

export function scrollPositionFromSnapshot(
  snapshot: EditorViewSnapshot | null,
): EditorScrollPosition | null {
  if (!snapshot) return null

  return {
    left: snapshot.viewport.scrollLeft,
    top: snapshot.viewport.scrollTop,
  }
}

// Keep the last row at the viewport bottom when restoring, even if the user scrolled past it.
export function capOverscrollTop(top: number, snapshot: EditorViewSnapshot | null): number {
  if (!snapshot) return top

  const { totalHeight, viewport } = snapshot
  if (totalHeight <= 0 || viewport.clientHeight <= 0) return top

  return Math.min(top, Math.max(0, totalHeight - viewport.clientHeight))
}
