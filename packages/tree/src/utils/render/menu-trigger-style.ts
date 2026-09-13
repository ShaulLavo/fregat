import type { FileTreeContextMenuOpenContext } from '../model/publicTypes'

export function menuTriggerAnchorStyle(
  pointerRect: FileTreeContextMenuOpenContext['anchorRect'] | null,
) {
  if (pointerRect !== null) {
    return {
      left: `${pointerRect.left}px`,
      position: 'fixed' as const,
      right: 'auto',
      top: `${pointerRect.top}px`,
    }
  }
  return undefined
}
