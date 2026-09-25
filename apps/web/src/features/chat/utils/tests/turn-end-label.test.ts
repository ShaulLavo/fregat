import { stoppedTurnLabel, turnStoppedShort } from '@/features/chat/utils/turn-end-label'
import { expect, test } from '../../../../../test/fixtures'

test('each end reason has its own status line', () => {
  const line = (
    endReason: Parameters<typeof stoppedTurnLabel>[0]['endReason'],
    state = 'interrupted' as const,
  ) => stoppedTurnLabel({ endReason, state }, '42s')

  expect(line('user-stop')).toBe('You stopped it after 42s')
  expect(line('server-restart')).toBe('Interrupted by a server restart after 42s')
  expect(line('runtime-stopped')).toBe('The session was stopped after 42s')
  expect(stoppedTurnLabel({ endReason: 'output-limit', state: 'completed' }, '42s')).toBe(
    'Hit the output limit after 42s',
  )
  expect(stoppedTurnLabel({ endReason: 'turn-limit', state: 'error' }, '42s')).toBe(
    'Hit the turn limit after 42s',
  )
  expect(stoppedTurnLabel({ endReason: 'refusal', state: 'completed' }, '42s')).toBe(
    'The model declined to continue',
  )
  expect(stoppedTurnLabel({ endReason: 'provider-error', state: 'error' }, '42s')).toBe(
    'Failed after 42s',
  )
  expect(stoppedTurnLabel({ endReason: null, state: 'error' }, null)).toBe('Response failed')
})

test('a finished turn has no stopped line', () => {
  expect(stoppedTurnLabel({ endReason: null, state: 'completed' }, '42s')).toBeNull()
  expect(turnStoppedShort({ endReason: null, state: 'running' })).toBe(false)
})
