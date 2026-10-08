import { expect, test } from 'vitest'
import { historyWork } from './undo-work-fixtures'
import type { Workload } from './undo-work-fixtures'

const workloads: Workload[] = ['undo', 'redo', 'acknowledge', 'reject-group', 'non-top-replay']

test.each(workloads)('%s settlement work grows linearly from n to 4n', (kind) => {
  const small = historyWork(256, kind)
  const large = historyWork(1024, kind)
  expect(small.total).toBeGreaterThan(0)
  expect(large.total, JSON.stringify({ small, large })).toBeLessThanOrEqual(small.total * 5)
  expect(large.total).toBeLessThan(1024 * 96)
  const expected = {
    undo: { undo: 0, redo: 1024 },
    redo: { undo: 1024, redo: 0 },
    acknowledge: { undo: 1024, redo: 0 },
    'reject-group': { undo: 0, redo: 0 },
    'non-top-replay': { undo: 1, redo: 1023 },
  }
  expect({ undo: large.undo, redo: large.redo }).toEqual(expected[kind])
})
