import type {
  FileTreeDirectoryHandle,
  FileTreeDropTarget,
  FileTreeItemHandle,
} from '@workspace/tree'

export const TOUCH_LONG_PRESS_DELAY = 400
export const TOUCH_LONG_PRESS_MOVE_THRESHOLD = 10
const DRAG_EDGE_SCROLL_THRESHOLD = 40
const DRAG_EDGE_SCROLL_MAX_SPEED = 18

export function getPointElement(clientX: number, clientY: number): HTMLElement | null {
  const element = document.elementFromPoint?.(clientX, clientY) ?? null
  return element instanceof HTMLElement ? element : null
}

export function resolveDropTargetFromElement(
  target: HTMLElement | null,
): FileTreeDropTarget | null {
  const rowButton = target?.closest?.('[data-type="item"]')
  if (!(rowButton instanceof HTMLElement)) {
    return null
  }

  const hoveredPath = rowButton.dataset.itemPath ?? null
  if (hoveredPath == null) {
    return null
  }

  const flattenedSegment = target?.closest?.('[data-item-flattened-subitem]')
  const flattenedSegmentPath =
    flattenedSegment instanceof HTMLElement
      ? (flattenedSegment.getAttribute('data-item-flattened-subitem') ?? null)
      : null
  if (flattenedSegmentPath != null && flattenedSegmentPath.endsWith('/')) {
    return {
      directoryPath: flattenedSegmentPath,
      flattenedSegmentPath,
      hoveredPath,
      kind: 'directory',
    }
  }

  if (rowButton.dataset.itemType === 'folder') {
    return {
      directoryPath: hoveredPath,
      flattenedSegmentPath: null,
      hoveredPath,
      kind: 'directory',
    }
  }

  const parentPath = rowButton.dataset.itemParentPath ?? null
  if (parentPath == null || parentPath.length === 0) {
    return {
      directoryPath: null,
      flattenedSegmentPath: null,
      hoveredPath,
      kind: 'root',
    }
  }

  return {
    directoryPath: parentPath,
    flattenedSegmentPath: null,
    hoveredPath,
    kind: 'directory',
  }
}

export function createDragPreviewElement(sourceElement: HTMLElement): HTMLElement {
  const preview = sourceElement.cloneNode(true) as HTMLElement
  preview.removeAttribute('id')
  preview.dataset.fileTreeDragPreview = 'true'
  preview.setAttribute('aria-hidden', 'true')
  preview.tabIndex = -1
  Object.assign(preview.style, {
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    left: '0px',
    margin: '0',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0px',
    willChange: 'transform',
    zIndex: '10000',
  })
  return preview
}

// Safari mis-renders detached custom drag images, so keep its pointer drags on
// the native preview path that the legacy tree already used successfully.
export function shouldUseCustomPointerDragImage(): boolean {
  return navigator.vendor !== 'Apple Computer, Inc.'
}

export function getDragEdgeScrollDelta(clientY: number, scrollRect: DOMRect): number {
  const topDistance = clientY - scrollRect.top
  if (topDistance < DRAG_EDGE_SCROLL_THRESHOLD) {
    const clampedDistance = Math.max(0, topDistance)
    return -Math.ceil(
      ((DRAG_EDGE_SCROLL_THRESHOLD - clampedDistance) / DRAG_EDGE_SCROLL_THRESHOLD) *
        DRAG_EDGE_SCROLL_MAX_SPEED,
    )
  }

  const bottomDistance = scrollRect.bottom - clientY
  if (bottomDistance < DRAG_EDGE_SCROLL_THRESHOLD) {
    const clampedDistance = Math.max(0, bottomDistance)
    return Math.ceil(
      ((DRAG_EDGE_SCROLL_THRESHOLD - clampedDistance) / DRAG_EDGE_SCROLL_THRESHOLD) *
        DRAG_EDGE_SCROLL_MAX_SPEED,
    )
  }

  return 0
}

export function isTreeDirectoryHandle(
  item: FileTreeItemHandle | null,
): item is FileTreeDirectoryHandle {
  return item != null && 'toggle' in item
}
