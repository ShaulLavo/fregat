import type { EditorScrollPosition } from '@singapore-editor/core'

export function scrollPositionsEqual(
  current: EditorScrollPosition | undefined,
  next: EditorScrollPosition,
) {
  return current !== undefined && current.left === next.left && current.top === next.top
}
