import { sessionIdSchema, turnIdSchema, type SessionRuntimeStatus } from '@workspace/contracts'
import * as v from 'valibot'

import type { ProjectionSession } from '@workspace/client-core/chat/types'
import { hasRunningTurn } from '@/features/chat-mode/utils/running-turn'
import { projectionSession } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
const activeTurnId = v.parse(turnIdSchema, 'turn-1')

test('a session actively producing a turn is running', () => {
  expect(hasRunningTurn(session('running'))).toBe(true)
})

test.each(['starting', 'waiting', 'ready', 'stopped', 'error', 'interrupted'] as const)(
  '%s does not block archive even with an active turn ID',
  (status) => expect(hasRunningTurn(session(status))).toBe(false),
)
test('running without an active turn does not block archive', () => {
  const value = session('running')
  expect(
    hasRunningTurn({
      ...value,
      runtime: value.runtime && { ...value.runtime, activeTurnId: null },
    }),
  ).toBe(false)
})

test('a settled session does not become running because the predicate loosened', () => {
  expect(hasRunningTurn(session('ready'))).toBe(false)
})

function session(status: SessionRuntimeStatus): ProjectionSession {
  return projectionSession({
    // Null, so the assertion rests on the session status rather than on a turn
    // that already reports itself as running.
    latestTurn: null,
    runtime: {
      activeTurnId,
      lastError: null,
      providerName: 'mock',
      providerBindingHandle: null,
      providerConversationMarker: null,
      providerResumeCursor: null,
      runtimeEpoch: 'test',
      runtimeMode: 'approval-required',
      status,
      sessionId,
      updatedAt: '2026-05-28T00:00:00.000Z',
    },
  })
}

test('a stale running latest turn does not override a ready runtime', () => {
  const latestTurn = projectionSession().latestTurn
  expect(latestTurn).not.toBeNull()
  expect(
    hasRunningTurn({
      ...session('ready'),
      latestTurn: latestTurn && { ...latestTurn, state: 'running' },
    }),
  ).toBe(false)
})
