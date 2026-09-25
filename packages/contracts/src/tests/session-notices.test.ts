import * as v from 'valibot'
import { expect, test } from 'vitest'
import { environmentIdSchema, sessionIdSchema, turnIdSchema } from '../chat-ids'
import {
  createSessionNotificationTracker,
  sessionNotice,
  sessionNotificationTransition,
  type NotificationSession,
} from '../session-notices'

const environmentId = v.parse(environmentIdSchema, '10000000-0000-4000-8000-000000000001')
const remoteId = v.parse(environmentIdSchema, '20000000-0000-4000-8000-000000000001')
const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
const turnId = v.parse(turnIdSchema, 'turn-1')
const session: NotificationSession = {
  id: sessionId,
  title: 'Fixture',
  archivedAt: null,
  latestTurn: null,
  runtime: null,
  pendingApprovalCount: 0,
  pendingUserInputCount: 0,
  backgroundLiveness: null,
}

test('tracker forgets removed owners and disconnect history, and attention is owner scoped', () => {
  const tracker = createSessionNotificationTracker()
  expect(tracker.update(environmentId, true, [session])).toEqual([])
  expect(tracker.update(remoteId, true, [session])).toEqual([])
  const input = { ...session, pendingUserInputCount: 1 }
  expect(tracker.update(environmentId, true, [input])).toHaveLength(1)
  expect(tracker.update(environmentId, true, [input])).toEqual([])
  expect(tracker.update(remoteId, true, [input])).toHaveLength(1)
  tracker.update(environmentId, false, [session])
  expect(tracker.update(environmentId, true, [input])).toEqual([])
  tracker.retain(new Set())
  expect(tracker.update(remoteId, true, [input])).toEqual([])
})

test('a completion announces once, an archived session stays silent, and a failure asks for input', () => {
  const completed = {
    ...session,
    latestTurn: { turnId, state: 'completed' as const, completedAt: '2026-09-25T10:00:00.000Z' },
  }
  const first = sessionNotificationTransition(session)
  const done = sessionNotificationTransition(completed, first.cursor)
  expect(sessionNotice(environmentId, completed, done)).toEqual({
    ref: { environmentId, sessionId },
    kind: 'completion',
    title: 'Session completed',
    body: 'Fixture',
    failed: false,
  })
  expect(sessionNotificationTransition(completed, done.cursor).kind).toBeNull()

  const archived = { ...completed, archivedAt: '2026-09-25T10:01:00.000Z' }
  expect(sessionNotificationTransition(archived, first.cursor).kind).toBeNull()

  const failed = { ...session, latestTurn: { turnId, state: 'error' as const, completedAt: null } }
  const failure = sessionNotificationTransition(failed, first.cursor)
  expect(sessionNotice(environmentId, failed, failure)).toMatchObject({
    kind: 'input',
    title: 'Session failed',
    failed: true,
  })
})
