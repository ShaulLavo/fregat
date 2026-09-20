import type { CollisionDetection } from '@dnd-kit/core'
import type { Bounds, Point } from '@/features/workbench/utils/editor-drag'

type DragTarget = {
  readonly id: string
  readonly data: Record<string, unknown>
  readonly bounds: Bounds
}

export function editorDragCollisionArgs(
  targets: readonly DragTarget[],
  pointerCoordinates: Point | null,
  bounds: Bounds = { left: 0, top: 0, width: 80, height: 30 },
): Parameters<CollisionDetection>[0] {
  const collisionRect = dragRect(bounds)
  return {
    active: {
      id: 'source-tab',
      data: { current: { kind: 'tab', groupId: 'source-group', tabId: 'source-tab' } },
      rect: { current: { initial: collisionRect, translated: collisionRect } },
    },
    collisionRect,
    droppableRects: new Map(targets.map((target) => [target.id, dragRect(target.bounds)])),
    droppableContainers: targets.map((target) => ({
      id: target.id,
      key: target.id,
      data: { current: target.data },
      disabled: false,
      node: { current: null },
      rect: { current: dragRect(target.bounds) },
    })),
    pointerCoordinates,
  }
}

function dragRect(bounds: Bounds) {
  return {
    ...bounds,
    right: bounds.left + bounds.width,
    bottom: bounds.top + bounds.height,
  }
}
