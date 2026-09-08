import { railReorderIntent } from '@workspace/client-core/chat/rail/reorder'
import { expect, test } from '../../../../../test/fixtures'

const arranged = [
  { id: 'row-a', orderKey: 'b' },
  { id: 'row-b', orderKey: 'd' },
  { id: 'row-c', orderKey: 'f' },
] as const

test('a drop writes one key, strictly between the neighbours it landed between', () => {
  const intent = railReorderIntent({ activeId: 'row-c', overId: 'row-b', rows: arranged })

  expect(intent?.id).toBe('row-c')
  expect(intent?.orderKey).toBeDefined()
  expect(intent?.orderKey.localeCompare('b')).toBe(1)
  expect(intent?.orderKey.localeCompare('d')).toBe(-1)
})

test('a drop at the top asks only for a key below nothing', () => {
  const intent = railReorderIntent({ activeId: 'row-c', overId: 'row-a', rows: arranged })

  expect(intent?.orderKey.localeCompare('b')).toBe(-1)
})

test('a row released on itself, or outside the list, writes nothing', () => {
  expect(railReorderIntent({ activeId: 'row-a', overId: 'row-a', rows: arranged })).toBeNull()
  expect(railReorderIntent({ activeId: 'row-a', overId: null, rows: arranged })).toBeNull()
  expect(railReorderIntent({ activeId: 'row-z', overId: 'row-a', rows: arranged })).toBeNull()
})

/**
 * The single-key model can only place a row among rows that already have keys,
 * so a drop into the never-dragged tail lands at the end of the arranged run —
 * the closest position it can express, and never a key that reads as "top".
 */
test('a drop into the tail lands at the end of the arranged run', () => {
  const intent = railReorderIntent({
    activeId: 'row-a',
    overId: 'row-tail',
    rows: [
      { id: 'row-a', orderKey: 'b' },
      { id: 'row-b', orderKey: 'd' },
      { id: 'row-tail', orderKey: null },
    ],
  })

  expect(intent?.orderKey.localeCompare('d')).toBe(1)
})

test('a first drag in a list nobody has arranged still writes a key', () => {
  const intent = railReorderIntent({
    activeId: 'row-b',
    overId: 'row-a',
    rows: [
      { id: 'row-a', orderKey: null },
      { id: 'row-b', orderKey: null },
    ],
  })

  expect(intent).toEqual({ id: 'row-b', orderKey: 'n' })
})
