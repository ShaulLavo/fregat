import { checkpointDiffRetry } from '@/lib/checkpoint-diff-query'
import { expect, test } from '../../../test/fixtures'

test('a typed permanent range failure is not retried', () => {
  // The retry policy reads the catalog code, not the message: a reworded
  // message must never turn a permanent failure back into a retry loop.
  const error = Object.assign(new Error('whatever the message says'), {
    code: 'checkpoint.RANGE_INVALID',
  })

  expect(checkpointDiffRetry(0, error)).toBe(false)
})

test('a transient failure without a permanent code is retried', () => {
  expect(checkpointDiffRetry(0, new Error('socket hangup'))).toBe(true)
  expect(checkpointDiffRetry(0, null)).toBe(true)
})

test('a still-capturing checkpoint is retried', () => {
  const error = Object.assign(new Error('Checkpoint ref is unavailable for turn 3'), {
    code: 'checkpoint.REF_UNAVAILABLE',
  })

  expect(checkpointDiffRetry(0, error)).toBe(true)
})

test('nothing is retried past the second failure', () => {
  expect(checkpointDiffRetry(2, new Error('socket hangup'))).toBe(false)
})
