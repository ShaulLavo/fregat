import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import type { HealthDescriptor } from '@workspace/contracts'
import { railEnvironment } from '../../../../../test/factories/chat-mode'
import { fixtureSessionId, sessionShell } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const capabilities: NonNullable<HealthDescriptor['capabilities']> = {
  sessionSettlement: true,
  sessionSnooze: true,
  sessionPinning: true,
  sessionPinReorder: true,
  sessionActiveReorder: false,
  sessionTitleRegeneration: true,
}
const now = Date.parse('2026-09-20T12:00:00Z')
const snoozedAt = '2026-09-20T11:00:00Z'
const snoozedUntil = '2026-09-20T13:00:00Z'

test('places lifecycle shelves independently of live status and historic attention', () => {
  const base = { runtime: null, latestTurn: null }
  const sessions = [
    sessionShell({
      ...base,
      id: fixtureSessionId(1),
      pinnedAt: snoozedAt,
      pendingApprovalCount: 1,
    }),
    sessionShell({ ...base, id: fixtureSessionId(2), attentionState: 'settled' }),
    sessionShell({
      ...base,
      id: fixtureSessionId(3),
      settledAt: snoozedAt,
      settledOverride: 'settled',
    }),
    sessionShell({
      ...base,
      id: fixtureSessionId(4),
      snoozedAt,
      snoozedUntil,
      pinnedAt: snoozedAt,
      settledOverride: 'settled',
    }),
    sessionShell({
      ...base,
      id: fixtureSessionId(5),
      attentionState: 'needs-input',
      attentionReason: 'plan',
      hasActionableProposedPlan: true,
    }),
  ]
  const model = sessionRailModel({
    environments: [railEnvironment({ capabilities }, sessions)],
    now,
  })
  expect(
    model.sections.map((section) => [
      section.state,
      section.groups.flatMap((group) => group.sessions.map((session) => session.id)),
    ]),
  ).toEqual([
    ['pinned', [fixtureSessionId(1)]],
    ['active', [fixtureSessionId(2), fixtureSessionId(5)]],
    ['snoozed', [fixtureSessionId(4)]],
    ['settled', [fixtureSessionId(3)]],
  ])
  expect(model.sessions.find((session) => session.id === fixtureSessionId(1))?.status).toBe(
    'approval',
  )
  expect(model.sessions.find((session) => session.id === fixtureSessionId(5))?.status).toBe('ready')
  expect(model.sessions.find((session) => session.id === fixtureSessionId(2))?.canReorder).toBe(
    false,
  )
})

test('missing owner capabilities keep rows reachable and never change pin sorting', () => {
  const sessions = [
    sessionShell({
      runtime: null,
      latestTurn: null,
      id: fixtureSessionId(1),
      snoozedAt,
      snoozedUntil,
      settledOverride: 'settled',
    }),
    sessionShell({
      runtime: null,
      latestTurn: null,
      id: fixtureSessionId(2),
      pinnedAt: snoozedAt,
      pinOrderKey: 'b',
    }),
    sessionShell({
      runtime: null,
      latestTurn: null,
      id: fixtureSessionId(3),
      pinnedAt: snoozedAt,
      pinOrderKey: 'a',
    }),
  ]
  const unsupported = sessionRailModel({ environments: [railEnvironment({}, sessions)], now })
  expect(
    unsupported.sessions.map((session) => [session.id, session.placement, session.canReorder]),
  ).toEqual([
    [fixtureSessionId(3), 'pinned', false],
    [fixtureSessionId(2), 'pinned', false],
    [fixtureSessionId(1), 'active', false],
  ])
  const supported = sessionRailModel({
    environments: [railEnvironment({ capabilities }, sessions)],
    now,
  })
  expect(supported.sessions.slice(0, 2).map((session) => session.id)).toEqual([
    fixtureSessionId(3),
    fixtureSessionId(2),
  ])
  expect(supported.sessions[2]?.placement).toBe('snoozed')
})

test('timer wake changes placement without changing retained snooze fields', () => {
  const environments = [
    railEnvironment({ capabilities }, [
      sessionShell({ runtime: null, latestTurn: null, snoozedAt, snoozedUntil }),
    ]),
  ]
  expect(sessionRailModel({ environments, now }).sessions[0]?.placement).toBe('snoozed')
  const woke = sessionRailModel({ environments, now: Date.parse(snoozedUntil) }).sessions[0]
  expect(woke?.placement).toBe('active')
  expect(woke?.snoozedUntil).toBe(snoozedUntil)
})

test('shows background agents and monitors after the parent turn completes', () => {
  const sessions = [
    sessionShell({ id: fixtureSessionId(1), runtime: null, backgroundLiveness: 'working' }),
    sessionShell({ id: fixtureSessionId(2), runtime: null, backgroundLiveness: 'monitoring' }),
    sessionShell({
      id: fixtureSessionId(3),
      runtime: null,
      backgroundLiveness: 'working',
      pendingApprovalCount: 1,
    }),
  ]
  const model = sessionRailModel({ environments: [railEnvironment({}, sessions)], now })
  expect(model.sessions.find((session) => session.id === fixtureSessionId(1))?.status).toBe(
    'working',
  )
  expect(model.sessions.find((session) => session.id === fixtureSessionId(2))?.status).toBe(
    'monitoring',
  )
  expect(model.sessions.find((session) => session.id === fixtureSessionId(3))?.status).toBe(
    'approval',
  )
})
