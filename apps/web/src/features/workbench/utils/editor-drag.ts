import type { CollisionDetection, DragMoveEvent, KeyboardCoordinateGetter } from '@dnd-kit/core'
import { closestCenter } from '@dnd-kit/core'
import {
  groupId,
  type GroupEdge,
  type GroupId,
  type TabPlacement,
} from '@/lib/documents/utils/group-types'
import { tabId } from '@/lib/documents/utils/identity'
import type { TabId } from '@/lib/documents/utils/types'

export type Point = { readonly x: number; readonly y: number }
export type Bounds = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}
export type EditorDropData =
  | { readonly kind: 'tab'; readonly groupId: GroupId; readonly tabId: TabId }
  | { readonly kind: 'group' | 'strip'; readonly groupId: GroupId }
export type EditorDropPreview = {
  readonly target: TabPlacement['target']
  readonly mode: TabPlacement['mode']
}

export function editorDropData(value: unknown): EditorDropData | null {
  if (!value || typeof value !== 'object') return null
  if (!('groupId' in value) || typeof value.groupId !== 'string' || !value.groupId) return null
  if (!('kind' in value)) return null
  const id = groupId(value.groupId)
  if (value.kind === 'group' || value.kind === 'strip') return { kind: value.kind, groupId: id }
  if (value.kind !== 'tab' || !('tabId' in value)) return null
  if (typeof value.tabId !== 'string' || !value.tabId) return null
  return { kind: 'tab', groupId: id, tabId: tabId(value.tabId) }
}

export function containsPoint(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y <= bounds.top + bounds.height
  )
}

export function splitEdgeAt(bounds: Bounds, point: Point): GroupEdge | null {
  if (!containsPoint(bounds, point)) return null
  const distances: readonly { readonly edge: GroupEdge; readonly distance: number }[] = [
    { edge: 'left', distance: point.x - bounds.left },
    { edge: 'right', distance: bounds.left + bounds.width - point.x },
    { edge: 'top', distance: point.y - bounds.top },
    { edge: 'bottom', distance: bounds.top + bounds.height - point.y },
  ]
  const nearest = distances.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  )
  return nearest.distance <= Math.min(bounds.width, bounds.height) * 0.2 ? nearest.edge : null
}

export function dragPoint(collisions: DragMoveEvent['collisions']): Point | null {
  const point: unknown = collisions?.[0]?.data?.pointerCoordinates
  if (!point || typeof point !== 'object') return null
  if (!('x' in point) || !('y' in point)) return null
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return null
  return { x: point.x, y: point.y }
}

export function dragMode(event: Event, platform: string): TabPlacement['mode'] {
  const copy =
    platform === 'mac'
      ? 'altKey' in event && event.altKey === true
      : 'ctrlKey' in event && event.ctrlKey === true
  return copy ? 'copy' : 'move'
}

export const editorDragCollisions: CollisionDetection = (args) => {
  const source = editorDropData(args.active.data.current)
  const point = args.pointerCoordinates
  const candidates = args.droppableContainers.filter((container) => {
    const data = editorDropData(container.data.current)
    if (!data) return false
    if (!point) return data.kind === 'tab' && data.groupId === source?.groupId
    const rect = args.droppableRects.get(container.id)
    return rect !== undefined && containsPoint(rect, point)
  })
  if (!point) return closestCenter({ ...args, droppableContainers: candidates })
  const strip = candidates.find(
    (container) => editorDropData(container.data.current)?.kind === 'strip',
  )
  const stripGroup = editorDropData(strip?.data.current)?.groupId
  const tab =
    strip &&
    candidates.find((container) => {
      const data = editorDropData(container.data.current)
      return data?.kind === 'tab' && data.groupId === stripGroup
    })
  const group = candidates.find(
    (container) => editorDropData(container.data.current)?.kind === 'group',
  )
  const target = tab ?? strip ?? group
  return target ? [{ id: target.id, data: { pointerCoordinates: point } }] : []
}

export const editorKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return
  event.preventDefault()
  const source = editorDropData(context.active?.data.current)
  const rect = context.collisionRect
  if (!source || !rect) return
  const tabs = context.droppableContainers.getEnabled().filter((container) => {
    const data = editorDropData(container.data.current)
    return data?.kind === 'tab' && data.groupId === source.groupId
  })
  tabs.sort(
    (a, b) =>
      (context.droppableRects.get(a.id)?.left ?? 0) - (context.droppableRects.get(b.id)?.left ?? 0),
  )
  const index = tabs.findIndex((tab) => tab.id === (context.over?.id ?? context.active?.id))
  const target = tabs[index + (event.code === 'ArrowRight' ? 1 : -1)]
  const targetRect = target ? context.droppableRects.get(target.id) : null
  if (!targetRect) return
  return { x: currentCoordinates.x + targetRect.left - rect.left, y: currentCoordinates.y }
}

export function dropLabel(preview: EditorDropPreview): string {
  if (preview.target.kind === 'edge') return `Split ${preview.target.edge}`
  return preview.mode === 'copy' ? 'Copy here' : 'Move here'
}
