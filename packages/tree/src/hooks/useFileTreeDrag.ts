import {
  type DragEvent as ReactDragEvent,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
  useLayoutEffect,
  useRef,
} from 'react'

import type { FileTreeRowDom } from './useFileTreeRowDom'
import type { FileTreeController } from '../utils/model/FileTreeController'
import type { FileTreeDropTarget, FileTreeVisibleRow } from '../utils/model/publicTypes'
import {
  createDragPreviewElement,
  getDragEdgeScrollDelta,
  getPointElement,
  isFileTreeDirectoryHandle,
  resolveDropTargetFromElement,
  shouldUseCustomPointerDragImage,
  TOUCH_LONG_PRESS_DELAY,
  TOUCH_LONG_PRESS_MOVE_THRESHOLD,
} from '../utils/render/dragPointer'

export interface UseFileTreeDragOptions {
  readonly controller: FileTreeController
  readonly dom: FileTreeRowDom
  readonly dragAndDropEnabled: boolean
  readonly itemHeight: number
  // Drag auto-scroll must refresh the virtual window synchronously, exactly as
  // it did through the component-local ref before this extraction.
  readonly updateViewport: RefObject<() => void>
}

export interface FileTreeDragHandlers {
  readonly handleRowDragStart: (
    event: ReactDragEvent<HTMLElement>,
    row: FileTreeVisibleRow,
    targetPath: string,
  ) => void
  readonly handleRowDragEnd: () => void
  readonly handleRowTouchStart: (
    event: ReactTouchEvent<HTMLElement>,
    row: FileTreeVisibleRow,
    targetPath: string,
  ) => void
  readonly handleTreeDragOver: (event: ReactDragEvent<HTMLElement>) => void
  readonly handleTreeDragLeave: (event: ReactDragEvent<HTMLElement>) => void
  readonly handleTreeDrop: (event: ReactDragEvent<HTMLElement>) => void
  readonly isTouchInteractionActive: () => boolean
  readonly getDraggedRowSnapshot: () => FileTreeVisibleRow | null
}

export function useFileTreeDrag(options: UseFileTreeDragOptions): FileTreeDragHandlers {
  const { controller, dom, dragAndDropEnabled, updateViewport: updateViewportRef } = options
  const { getRoot, getScroll } = dom
  const dragAutoScrollFrameRef = useRef<number | null>(null)
  const dragHoverOpenKeyRef = useRef<string | null>(null)
  const dragHoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragPointRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const dragRowSnapshotRef = useRef<FileTreeVisibleRow | null>(null)
  const touchCleanupRef = useRef<(() => void) | null>(null)
  const touchDragActiveRef = useRef(false)
  const touchPreviewOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const touchSourceElementRef = useRef<HTMLElement | null>(null)
  const touchStartPointRef = useRef<{
    clientX: number
    clientY: number
  } | null>(null)
  const touchLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const requestDragAnimationFrame = (callback: () => void): number => {
    return typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => {
          callback()
        })
      : window.setTimeout(callback, 16)
  }

  const cancelDragAnimationFrame = (handle: number | null): void => {
    if (handle == null) {
      return
    }

    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(handle)
      return
    }

    window.clearTimeout(handle)
  }

  const clearDragHoverOpen = (): void => {
    if (dragHoverOpenTimerRef.current != null) {
      clearTimeout(dragHoverOpenTimerRef.current)
      dragHoverOpenTimerRef.current = null
    }
    dragHoverOpenKeyRef.current = null
  }

  const clearDragPreview = (): void => {
    dragPreviewRef.current?.remove()
    dragPreviewRef.current = null
  }

  const stopDragAutoScroll = (): void => {
    cancelDragAnimationFrame(dragAutoScrollFrameRef.current)
    dragAutoScrollFrameRef.current = null
    dragPointRef.current = null
  }

  const mountDragPreview = (preview: HTMLElement): void => {
    const rootNode = getRoot()?.getRootNode()
    if (rootNode instanceof ShadowRoot) {
      rootNode.append(preview)
      return
    }

    document.body.append(preview)
  }

  const clearTouchDragResources = (): void => {
    touchCleanupRef.current?.()
    touchCleanupRef.current = null
    if (touchLongPressTimerRef.current != null) {
      clearTimeout(touchLongPressTimerRef.current)
      touchLongPressTimerRef.current = null
    }
    touchDragActiveRef.current = false
    touchPreviewOffsetRef.current = null
    touchStartPointRef.current = null
    if (touchSourceElementRef.current != null) {
      touchSourceElementRef.current.setAttribute('draggable', 'true')
      touchSourceElementRef.current.style.removeProperty('touch-action')
      touchSourceElementRef.current = null
    }
    clearDragPreview()
    clearDragHoverOpen()
    stopDragAutoScroll()
    dragRowSnapshotRef.current = null
  }

  const syncDropTargetFromPoint = (clientX: number, clientY: number): FileTreeDropTarget | null => {
    const rootNode = getRoot()?.getRootNode()
    const pointRoot = rootNode instanceof ShadowRoot ? rootNode : document
    const pointElement = getPointElement(pointRoot, clientX, clientY)
    const nextTarget = resolveDropTargetFromElement(pointElement)
    controller.setDragTarget(nextTarget)
    return controller.getDragSession()?.target ?? null
  }

  const scheduleDragHoverOpen = (nextTarget: FileTreeDropTarget | null): void => {
    const openDelay = controller.getDragAndDropConfig()?.openOnDropDelay ?? 800
    if (
      nextTarget == null ||
      nextTarget.kind !== 'directory' ||
      nextTarget.directoryPath == null ||
      openDelay <= 0
    ) {
      clearDragHoverOpen()
      return
    }

    const targetItem = controller.getItem(nextTarget.directoryPath)
    const directoryItem = isFileTreeDirectoryHandle(targetItem) ? targetItem : null
    if (directoryItem == null || directoryItem.isExpanded()) {
      clearDragHoverOpen()
      return
    }

    const nextKey = `${nextTarget.directoryPath}::${nextTarget.flattenedSegmentPath ?? ''}`
    if (dragHoverOpenKeyRef.current === nextKey) {
      return
    }

    clearDragHoverOpen()
    dragHoverOpenKeyRef.current = nextKey
    dragHoverOpenTimerRef.current = setTimeout(() => {
      const currentTarget = controller.getDragSession()?.target
      if (
        currentTarget?.kind !== 'directory' ||
        currentTarget.directoryPath !== nextTarget.directoryPath ||
        currentTarget.flattenedSegmentPath !== nextTarget.flattenedSegmentPath
      ) {
        return
      }

      directoryItem.expand()
    }, openDelay)
  }

  const runDragAutoScroll = (): void => {
    dragAutoScrollFrameRef.current = null
    const dragPoint = dragPointRef.current
    const scrollElement = getScroll()
    if (dragPoint == null || scrollElement == null || controller.getDragSession() == null) {
      return
    }

    const scrollRect = scrollElement.getBoundingClientRect()
    const scrollDelta = getDragEdgeScrollDelta(dragPoint.clientY, scrollRect)
    if (scrollDelta === 0) {
      return
    }

    const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
    const boundedScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scrollElement.scrollTop + scrollDelta),
    )
    if (boundedScrollTop !== scrollElement.scrollTop) {
      scrollElement.scrollTop = boundedScrollTop
      updateViewportRef.current()
    }

    const nextTarget = syncDropTargetFromPoint(dragPoint.clientX, dragPoint.clientY)
    scheduleDragHoverOpen(nextTarget)
    dragAutoScrollFrameRef.current = requestDragAnimationFrame(runDragAutoScroll)
  }

  const updateDragPoint = (clientX: number, clientY: number): void => {
    dragPointRef.current = { clientX, clientY }
    if (dragAutoScrollFrameRef.current == null)
      dragAutoScrollFrameRef.current = requestDragAnimationFrame(runDragAutoScroll)
  }

  const handleRowDragStart = (
    event: ReactDragEvent<HTMLElement>,
    row: FileTreeVisibleRow,
    targetPath: string,
  ): void => {
    const dragSource = event.currentTarget

    clearTouchDragResources()
    clearDragPreview()
    clearDragHoverOpen()
    stopDragAutoScroll()
    if (controller.startDrag(targetPath) === false) {
      event.preventDefault()
      return
    }

    dragRowSnapshotRef.current = row
    if (event.dataTransfer != null) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.dropEffect = 'move'
      event.dataTransfer.setData('text/plain', targetPath)

      if (shouldUseCustomPointerDragImage()) {
        const preview = createDragPreviewElement(dragSource)
        const rect = dragSource.getBoundingClientRect()
        Object.assign(preview.style, {
          height: `${rect.height}px`,
          opacity: '0.85',
          transform: 'translate3d(-9999px, 0px, 0)',
          width: `${rect.width}px`,
        })
        mountDragPreview(preview)
        dragPreviewRef.current = preview
        event.dataTransfer.setDragImage(
          preview,
          Math.max(0, event.clientX - rect.left),
          Math.max(0, event.clientY - rect.top),
        )
      }
    }
  }

  const handleRowDragEnd = (): void => {
    clearDragPreview()
    clearDragHoverOpen()
    stopDragAutoScroll()
    dragRowSnapshotRef.current = null
    controller.cancelDrag()
  }

  const handleRowTouchStart = (
    event: ReactTouchEvent<HTMLElement>,
    row: FileTreeVisibleRow,
    targetPath: string,
  ): void => {
    if (touchLongPressTimerRef.current != null || touchDragActiveRef.current) {
      return
    }

    const touch = event.touches[0]
    const dragSource = event.currentTarget
    if (touch == null || dragSource == null) {
      return
    }

    touchStartPointRef.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
    }
    touchSourceElementRef.current = dragSource
    dragSource.setAttribute('draggable', 'false')

    const clearPendingTouchStart = (options: { restoreNativeDraggable?: boolean } = {}): void => {
      const restoreNativeDraggable = options.restoreNativeDraggable ?? !touchDragActiveRef.current
      if (touchLongPressTimerRef.current != null) {
        clearTimeout(touchLongPressTimerRef.current)
        touchLongPressTimerRef.current = null
      }
      document.removeEventListener('touchmove', handlePendingTouchMove)
      document.removeEventListener('touchend', handlePendingTouchEnd)
      document.removeEventListener('touchcancel', handlePendingTouchEnd)
      if (touchCleanupRef.current === clearPendingTouchStart) {
        touchCleanupRef.current = null
      }
      if (restoreNativeDraggable) {
        dragSource.setAttribute('draggable', 'true')
        if (touchSourceElementRef.current === dragSource) {
          touchSourceElementRef.current = null
        }
        touchStartPointRef.current = null
      }
    }

    const handlePendingTouchMove = (moveEvent: globalThis.TouchEvent): void => {
      const moveTouch = moveEvent.touches[0]
      const startPoint = touchStartPointRef.current
      if (moveTouch == null || startPoint == null) {
        return
      }

      const deltaX = moveTouch.clientX - startPoint.clientX
      const deltaY = moveTouch.clientY - startPoint.clientY
      if (
        deltaX * deltaX + deltaY * deltaY <=
        TOUCH_LONG_PRESS_MOVE_THRESHOLD * TOUCH_LONG_PRESS_MOVE_THRESHOLD
      ) {
        return
      }

      clearPendingTouchStart()
    }

    const handlePendingTouchEnd = (): void => {
      clearPendingTouchStart()
    }

    document.addEventListener('touchmove', handlePendingTouchMove, {
      passive: true,
    })
    document.addEventListener('touchend', handlePendingTouchEnd)
    document.addEventListener('touchcancel', handlePendingTouchEnd)
    touchCleanupRef.current = clearPendingTouchStart
    touchLongPressTimerRef.current = setTimeout(() => {
      // Keep native draggable disabled while the custom touch drag activates.
      // iOS Safari can otherwise promote the same long press into its native
      // HTML drag flow before the touch-specific listeners take over.
      clearPendingTouchStart({ restoreNativeDraggable: false })
      if (controller.startDrag(targetPath) === false) {
        dragSource.setAttribute('draggable', 'true')
        if (touchSourceElementRef.current === dragSource) {
          touchSourceElementRef.current = null
        }
        touchStartPointRef.current = null
        return
      }

      touchDragActiveRef.current = true
      touchSourceElementRef.current = dragSource
      dragSource.setAttribute('draggable', 'false')
      dragSource.style.setProperty('touch-action', 'none')
      dragRowSnapshotRef.current = row
      const rect = dragSource.getBoundingClientRect()
      const preview = createDragPreviewElement(dragSource)
      Object.assign(preview.style, {
        height: `${rect.height}px`,
        opacity: '0.85',
        transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
        width: `${rect.width}px`,
      })
      mountDragPreview(preview)
      dragPreviewRef.current = preview
      touchPreviewOffsetRef.current = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      }

      const handleActiveTouchMove = (moveEvent: globalThis.TouchEvent): void => {
        const moveTouch = moveEvent.touches[0]
        if (moveTouch == null) {
          return
        }

        moveEvent.preventDefault()
        const previewOffset = touchPreviewOffsetRef.current
        if (previewOffset != null && dragPreviewRef.current != null) {
          dragPreviewRef.current.style.transform = `translate3d(${moveTouch.clientX - previewOffset.x}px, ${moveTouch.clientY - previewOffset.y}px, 0)`
        }

        const nextTarget = syncDropTargetFromPoint(moveTouch.clientX, moveTouch.clientY)
        scheduleDragHoverOpen(nextTarget)
        updateDragPoint(moveTouch.clientX, moveTouch.clientY)
      }

      const handleActiveTouchEnd = (endEvent: globalThis.TouchEvent): void => {
        const endTouch = endEvent.changedTouches[0]
        if (endTouch != null) {
          syncDropTargetFromPoint(endTouch.clientX, endTouch.clientY)
        }

        controller.completeDrag()
        clearTouchDragResources()
      }

      const handleActiveTouchCancel = (): void => {
        controller.cancelDrag()
        clearTouchDragResources()
      }

      touchCleanupRef.current = () => {
        document.removeEventListener('touchmove', handleActiveTouchMove)
        document.removeEventListener('touchend', handleActiveTouchEnd)
        document.removeEventListener('touchcancel', handleActiveTouchCancel)
      }
      document.addEventListener('touchmove', handleActiveTouchMove, {
        passive: false,
      })
      document.addEventListener('touchend', handleActiveTouchEnd)
      document.addEventListener('touchcancel', handleActiveTouchCancel)
    }, TOUCH_LONG_PRESS_DELAY)
  }

  useLayoutEffect(() => {
    if (!dragAndDropEnabled) {
      return
    }

    const handleWindowDragEnd = (): void => {
      clearTouchDragResources()
      controller.cancelDrag()
    }

    window.addEventListener('dragend', handleWindowDragEnd)
    return () => {
      window.removeEventListener('dragend', handleWindowDragEnd)
      clearTouchDragResources()
      controller.cancelDrag()
    }
  }, [controller, dragAndDropEnabled])

  const handleTreeDragOver = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dragAndDropEnabled || controller.getDragSession() == null || touchDragActiveRef.current) {
      return
    }

    const nextTarget = resolveDropTargetFromElement(
      event.target instanceof HTMLElement ? event.target : null,
    )
    controller.setDragTarget(nextTarget)
    const resolvedTarget = controller.getDragSession()?.target ?? null
    scheduleDragHoverOpen(resolvedTarget)
    updateDragPoint(event.clientX, event.clientY)
    if (event.dataTransfer != null) {
      event.dataTransfer.dropEffect = 'move'
    }
    event.preventDefault()
  }

  const handleTreeDragLeave = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dragAndDropEnabled || controller.getDragSession() == null || touchDragActiveRef.current) {
      return
    }

    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && getRoot()?.contains(nextTarget) === true) {
      return
    }

    clearDragHoverOpen()
    stopDragAutoScroll()
    controller.setDragTarget(null)
  }

  const handleTreeDrop = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dragAndDropEnabled || controller.getDragSession() == null || touchDragActiveRef.current) {
      return
    }
    event.preventDefault()
    syncDropTargetFromPoint(event.clientX, event.clientY)
    controller.completeDrag()
    clearDragPreview()
    clearDragHoverOpen()
    stopDragAutoScroll()
    dragRowSnapshotRef.current = null
  }

  return {
    getDraggedRowSnapshot: () => dragRowSnapshotRef.current,
    handleRowDragEnd,
    handleRowDragStart,
    handleRowTouchStart,
    handleTreeDragLeave,
    handleTreeDragOver,
    handleTreeDrop,
    isTouchInteractionActive: () =>
      touchLongPressTimerRef.current != null || touchDragActiveRef.current,
  }
}
