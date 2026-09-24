import { checkpointAvailability, checkpointAvailabilityLabel } from '@/lib/checkpoint-availability'
import { turnDiffSummary } from '../../../test/factories/chat'
import { expect, test } from '../../../test/fixtures'

test('no summary yet is pending, never empty', () => {
  expect(checkpointAvailability(null)).toEqual({ kind: 'pending' })
})

test('a missing or failed capture wins over its empty file list', () => {
  expect(checkpointAvailability(turnDiffSummary({ files: [], status: 'missing' })).kind).toBe(
    'missing',
  )
  expect(checkpointAvailability(turnDiffSummary({ files: [], status: 'error' })).kind).toBe('error')
})

test('a ready turn that changed nothing is empty', () => {
  expect(checkpointAvailability(turnDiffSummary({ files: [] })).kind).toBe('empty')
})

test('a ready turn with files is available and carries its summary', () => {
  const summary = turnDiffSummary()
  expect(checkpointAvailability(summary)).toEqual({ kind: 'available', summary, turnCount: 1 })
})

test('a placeholder still listing files is not openable yet', () => {
  expect(checkpointAvailability(turnDiffSummary({ status: 'missing' })).kind).toBe('missing')
})

test('every state has its own sentence', () => {
  const labels = [
    checkpointAvailability(null),
    checkpointAvailability(turnDiffSummary({ files: [], status: 'missing' })),
    checkpointAvailability(turnDiffSummary({ files: [], status: 'error' })),
    checkpointAvailability(turnDiffSummary({ files: [] })),
  ].map(checkpointAvailabilityLabel)

  expect(labels).toEqual([
    'Loading checkpoint',
    'Checkpoint missing for turn 1',
    'Checkpoint error for turn 1',
    'No changed files in turn 1',
  ])
})
