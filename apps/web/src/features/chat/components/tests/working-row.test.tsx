import { screen } from '@testing-library/react'
import { turnIdSchema, type OrchestrationLatestTurn } from '@workspace/contracts'
import * as v from 'valibot'

import { WorkingRow } from '@/features/chat/components/working-row'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const LATEST_TURN: OrchestrationLatestTurn = {
  providerStartState: 'adopted' as const,
  providerStartGeneration: 1,
  providerStartSequence: 1,
  runtimeEpoch: 'test-epoch',
  assistantMessageId: null,
  completedAt: null,
  requestedAt: '2026-05-28T00:00:00.000Z',
  startedAt: '2026-05-28T00:00:00.000Z',
  state: 'running',
  turnId: v.parse(turnIdSchema, 'turn-1'),
}

test('the working row stays a bare progress line without a plan', () => {
  renderWithProviders(<WorkingRow latestTurn={LATEST_TURN} startedAt={LATEST_TURN.requestedAt} />)

  expect(screen.getByText(/Working for/)).toBeInTheDocument()
  expect(screen.queryByText('2/3')).not.toBeInTheDocument()
})
