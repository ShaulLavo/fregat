import type { BusySession, LiveCheckVerdict } from '@workspace/contracts'

import { expect, test } from '../../../../test/fixtures'
import { liveCheckToastId } from '@/features/server-update/utils/live-check-toast'
import {
  busySessionTitle,
  busyStateLabel,
  restartDescription,
  waitingNote,
} from '@/features/server-update/utils/restart-prompt'

function busy(state: BusySession['state'], title = 'Fix the parser'): BusySession {
  return {
    sessionId: `session-${title}` as BusySession['sessionId'],
    title,
    projectTitle: null,
    state,
  }
}

test('the confirmation counts the sessions it interrupts and says where queued messages go', () => {
  expect(restartDescription([busy('running')])).toBe(
    'Restarting interrupts 1 session. Queued messages start on the new server.',
  )
  expect(restartDescription([busy('running'), busy('starting', 'Other')])).toBe(
    'Restarting interrupts 2 sessions. Queued messages start on the new server.',
  )
})

test('the waiting note appears only for a session holding an approval or question', () => {
  expect(waitingNote([busy('running'), busy('background', 'Other')])).toBeNull()
  expect(waitingNote([busy('waiting')])).toBe(
    'A session waiting for your answer loses its open approval or question.',
  )
  expect(waitingNote([busy('waiting'), busy('waiting', 'Other')])).toBe(
    'Sessions waiting for your answer lose their open approval or question.',
  )
})

test('each busy state has a label and a row title adds the project', () => {
  expect(busyStateLabel('terminal')).toBe('Running in a terminal')
  expect(busySessionTitle(busy('running'))).toBe('Fix the parser')
  expect(busySessionTitle({ ...busy('running'), projectTitle: 'platform' })).toBe(
    'Fix the parser · platform',
  )
})

test('a failed live check toasts only when the verdict is newer than the page', () => {
  const pageStartedAt = Date.parse('2026-09-25T12:00:00.000Z')
  const failed: LiveCheckVerdict = {
    release: 'r2',
    status: 'failed',
    at: '2026-09-25T12:05:00.000Z',
    error: { code: 'update.LIVE_CHECK_FAILED', message: 'r2 failed its live check' },
  }

  expect(liveCheckToastId(failed, pageStartedAt)).toBe('live-check:r2:2026-09-25T12:05:00.000Z')
  expect(liveCheckToastId({ ...failed, at: '2026-09-25T11:59:00.000Z' }, pageStartedAt)).toBeNull()
  expect(liveCheckToastId({ ...failed, status: 'passed', error: null }, pageStartedAt)).toBeNull()
  expect(liveCheckToastId(null, pageStartedAt)).toBeNull()
})
