import {
  advanceSessionVisit,
  isSessionUnread,
  sessionVisitAt,
  unreadSessionVisit,
  sessionWokeAt,
  unseenSessionWake,
} from '@workspace/client-core/chat/rail/unread'
import { sessionShell } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const completion = '2026-09-20T12:00:00.000Z'
const before = '2026-09-20T11:00:00.000Z'
const deadline = '2026-09-20T13:00:00.000Z'

test('never visited completed history is read, invalid visits expose completion', () => {
  expect(isSessionUnread(completion, undefined)).toBe(false)
  expect(isSessionUnread(completion, 'invalid')).toBe(true)
  expect(isSessionUnread('invalid', before)).toBe(false)
})
test('visiting a first running turn records a server stamp before its completion', () => {
  const session = sessionShell()
  const visit = sessionVisitAt(session)
  expect(visit).toBe(session.latestTurn?.requestedAt)
  expect(isSessionUnread(completion, visit)).toBe(true)
  expect(sessionVisitAt(sessionShell({ latestTurn: null }))).toBe(session.createdAt)
})
test('normal visits are monotonic and explicit unread is exactly before completion', () => {
  expect(advanceSessionVisit(completion, before)).toBe(completion)
  expect(advanceSessionVisit(completion, 'invalid')).toBe(completion)
  expect(advanceSessionVisit('invalid', completion)).toBe(completion)
  const unread = unreadSessionVisit(completion)
  expect(unread).toBe('2026-09-20T11:59:59.999Z')
  expect(isSessionUnread(completion, unread ?? undefined)).toBe(true)
  expect(advanceSessionVisit(unread ?? undefined, completion)).toBe(completion)
  expect(unreadSessionVisit('invalid')).toBeNull()
})
test('timer wake survives an earlier visit and clears on engagement or lifecycle change', () => {
  const session = sessionShell({ snoozedAt: completion, snoozedUntil: deadline })
  const now = Date.parse(deadline)
  expect(sessionWokeAt(session, now - 1)).toBeNull()
  expect(unseenSessionWake(session, completion, now)).toBe(deadline)
  expect(unseenSessionWake(session, 'invalid', now)).toBe(deadline)
  expect(unseenSessionWake(session, deadline, now)).toBeNull()
  expect(unseenSessionWake({ ...session, settledOverride: 'settled' }, before, now)).toBeNull()
  expect(unseenSessionWake({ ...session, archivedAt: completion }, before, now)).toBeNull()
  expect(unseenSessionWake({ ...session, snoozedUntil: null }, before, now)).toBeNull()
})
test('an acknowledged early wake never changes to the scheduled timestamp', () => {
  const original = sessionShell()
  const session = sessionShell({
    snoozedAt: before,
    snoozedUntil: deadline,
    latestTurn: { ...original.latestTurn!, completedAt: completion, state: 'completed' },
  })
  expect(sessionWokeAt(session, Date.parse(completion))).toBe(completion)
  expect(sessionWokeAt(session, Date.parse(deadline))).toBe(completion)
  expect(unseenSessionWake(session, completion, Date.parse(deadline))).toBeNull()
})
test('only a fresh failure wakes early, pending requests always do', () => {
  const original = sessionShell()
  const session = sessionShell({
    snoozedAt: before,
    snoozedUntil: deadline,
    runtime: { ...original.runtime!, status: 'error', updatedAt: before },
  })
  expect(sessionWokeAt(session, Date.parse(completion))).toBeNull()
  expect(
    sessionWokeAt(
      { ...session, runtime: { ...session.runtime!, updatedAt: completion } },
      Date.parse(completion),
    ),
  ).toBe(completion)
  expect(sessionWokeAt({ ...session, pendingApprovalCount: 1 }, Date.parse(completion))).toBe(
    before,
  )
})
