import { railCollisions } from '@/features/chat-mode/utils/rail-collisions'
import { expect, test } from '../../../../../test/fixtures'

test('a pointer targets the shelf under it even when the shorter drag overlay is centered on another shelf', () => {
  const pinned = new DOMRect(0, 0, 100, 20)
  const active = new DOMRect(0, 25, 100, 20)
  const overlay = new DOMRect(0, 24, 100, 20)
  const targets = [
    { id: 'pinned', rect: pinned },
    { id: 'active', rect: active },
  ]
  const args: Parameters<typeof railCollisions>[0] = {
    active: {
      id: 'row',
      data: { current: { kind: 'session', groupKey: 'group' } },
      rect: { current: { initial: overlay, translated: overlay } },
    },
    collisionRect: overlay,
    pointerCoordinates: { x: 50, y: 10 },
    droppableRects: new Map(targets.map((target) => [target.id, target.rect])),
    droppableContainers: targets.map((target) => ({
      id: target.id,
      key: target.id,
      disabled: false,
      node: { current: null },
      rect: { current: target.rect },
      data: { current: { kind: 'shelf', shelf: target.id } },
    })),
  }
  expect(railCollisions(args)[0]?.id).toBe('pinned')
  expect(railCollisions({ ...args, pointerCoordinates: null })[0]?.id).toBe('active')
})
