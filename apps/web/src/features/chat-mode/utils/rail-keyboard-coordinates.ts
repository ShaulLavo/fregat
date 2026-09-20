import type { KeyboardCoordinateGetter } from '@dnd-kit/core'

export const railKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return
  const { active, collisionRect, droppableContainers, droppableRects } = context
  if (!active || !collisionRect) return
  event.preventDefault()
  const from = collisionRect.top + collisionRect.height / 2
  const direction = event.code === 'ArrowDown' ? 1 : -1
  const source = active.data.current
  const candidates = droppableContainers.getEnabled().flatMap((container) => {
    if (container.id === active.id) return []
    const target = container.data.current
    const sameKind =
      source?.kind === 'project'
        ? target?.kind === 'project'
        : target?.kind === 'shelf' ||
          (target?.kind === 'session' && source?.groupKey === target.groupKey)
    const rect = droppableRects.get(container.id)
    if (!sameKind || !rect) return []
    const distance = rect.top + rect.height / 2 - from
    if (distance * direction <= 1) return []
    return [{ distance }]
  })
  candidates.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))
  const target = candidates[0]
  if (!target) return
  return { x: currentCoordinates.x, y: currentCoordinates.y + target.distance }
}
