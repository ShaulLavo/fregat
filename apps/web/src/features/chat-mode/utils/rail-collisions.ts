import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'

export const railCollisions: CollisionDetection = (args) => {
  const active = args.active.data.current
  const candidates = {
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const target = container.data.current
      if (active?.kind === 'project') return target?.kind === 'project'
      return (
        target?.kind === 'shelf' ||
        (target?.kind === 'session' && target.groupKey === active?.groupKey)
      )
    }),
  }
  if (args.pointerCoordinates) {
    const hits = pointerWithin(candidates)
    if (hits.length) return hits
  }
  return closestCenter(candidates)
}
