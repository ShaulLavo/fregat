import { render, screen } from '@testing-library/react'

import { CheckpointState } from '@/features/chat-mode/components/checkpoint-state'
import { checkpointAvailability } from '@/lib/checkpoint-availability'
import { turnDiffSummary } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

function renderState(status: 'missing' | 'error' | 'ready') {
  const availability = checkpointAvailability(turnDiffSummary({ files: [], status }))
  if (availability.kind === 'pending' || availability.kind === 'available')
    return expect.unreachable('expected an unlisted checkpoint')
  render(<CheckpointState availability={availability} />)
}

test('the Turn panel names a missing checkpoint as missing', () => {
  renderState('missing')
  expect(screen.getByText('Checkpoint missing for turn 1')).toBeInTheDocument()
})

test('the Turn panel names a failed checkpoint as an error', () => {
  renderState('error')
  expect(screen.getByText('Checkpoint error for turn 1')).toBeInTheDocument()
})

test('the Turn panel says a turn changed nothing', () => {
  renderState('ready')
  expect(screen.getByText('No changed files in turn 1')).toBeInTheDocument()
})
