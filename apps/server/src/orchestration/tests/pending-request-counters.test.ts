import { afterEach, describe, expect, it } from 'vitest'
import type { PendingOrchestrationEvent } from '../event-store'
import type { OrchestrationProjectedSession, OrchestrationReadModel } from '../read-model'
import {
  activityAppendedEvent,
  applyIncrementally,
  createProjectionFixture,
  pendingEvent,
  sessionBootstrapEvents,
  turnDiffCompletedEvent,
  turnStartEvent,
  SESSION_ID,
} from './factories/projection'

const requestedAt = '2026-05-24T00:01:00.000Z'
const fixtures: Array<{ close: () => void }> = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.close()
  }
})

describe('pending request counters', () => {
  it('counts open approval and user-input requests in both projections', () => {
    const projected = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1'),
      userInputRequested('req-2'),
    ])

    expectCounts(projected.memory, 1, 1)
    expectCounts(projected.sqlSession, 1, 1)
  })

  it('closes the counter when the request resolves', () => {
    const projected = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1'),
      userInputRequested('req-2'),
      requestActivity('approval.resolved', 'activity-resolve-1', 'req-1'),
    ])

    expectCounts(projected.memory, 0, 1)
    expectCounts(projected.sqlSession, 0, 1)
  })

  it('keeps a request open through a transient respond failure and closes it on a dead one', () => {
    const projected = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1'),
      requestActivity('provider.approval.respond.failed', 'activity-fail-1', 'req-1', {
        detail: 'provider timed out',
      }),
    ])

    expectCounts(projected.memory, 1, 0)
    expectCounts(projected.sqlSession, 1, 0)

    const dead = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1'),
      requestActivity('provider.approval.respond.failed', 'activity-fail-2', 'req-1', {
        code: 'provider.REQUEST_GONE',
        detail: 'The agent no longer holds this request. Restart the turn to continue.',
      }),
    ])

    expectCounts(dead.memory, 0, 0)
    expectCounts(dead.sqlSession, 0, 0)
  })

  it('does not double-count a replayed request activity', () => {
    const projected = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1'),
      approvalRequested('req-1', 'activity-approval-1'),
    ])

    expectCounts(projected.memory, 1, 0)
    expectCounts(projected.sqlSession, 1, 0)
  })

  it('drops the requests a revert pruned and keeps the ones it retained', () => {
    const projected = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1', 'activity-approval-1', 'turn-1'),
      turnDiffCompletedEvent({ checkpointTurnCount: 1, turnId: 'turn-1' }),
      turnStartEvent('turn-2', requestedAt),
      userInputRequested('req-2', 'activity-input-2', 'turn-2'),
      turnDiffCompletedEvent({ checkpointTurnCount: 2, turnId: 'turn-2' }),
      pendingEvent(
        'session.reverted',
        { revertedAt: '2026-05-24T00:05:00.000Z', sessionId: SESSION_ID, turnCount: 1 },
        '2026-05-24T00:05:00.000Z',
      ),
    ])

    expectCounts(projected.memory, 1, 0)
    expectCounts(projected.sqlSession, 1, 0)
  })

  it('survives a storm of unrelated activities and still closes on resolve', () => {
    const noise = Array.from({ length: 50 }, (_, index) =>
      activityAppendedEvent({ id: `activity-tool-${index}` }),
    )
    const open = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1'),
      ...noise,
    ])

    expectCounts(open.memory, 1, 0)
    expectCounts(open.sqlSession, 1, 0)

    const closed = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      approvalRequested('req-1'),
      ...noise,
      requestActivity('approval.resolved', 'activity-resolve-1', 'req-1'),
    ])

    expectCounts(closed.memory, 0, 0)
    expectCounts(closed.sqlSession, 0, 0)
  })
})

function project(events: PendingOrchestrationEvent[]) {
  const fixture = createProjectionFixture()
  fixtures.push(fixture)

  const model = applyIncrementally(fixture, events)

  return {
    memory: projectedSession(model),
    sqlSession: projectedSession(fixture.snapshots.fullReadModel()),
  }
}

function projectedSession(model: OrchestrationReadModel) {
  const session = model.sessions.get(SESSION_ID)
  expect(session).toBeDefined()

  return session as OrchestrationProjectedSession
}

function expectCounts(
  session: OrchestrationProjectedSession,
  approvals: number,
  userInputs: number,
) {
  expect(session.pendingApprovalCount).toBe(approvals)
  expect(session.pendingUserInputCount).toBe(userInputs)
}

function approvalRequested(requestId: string, id = 'activity-approval-1', turnId = 'turn-1') {
  return requestActivity('approval.requested', id, requestId, { turnId }, turnId)
}

function userInputRequested(requestId: string, id = 'activity-input-1', turnId = 'turn-1') {
  return requestActivity('user-input.requested', id, requestId, { turnId }, turnId)
}

function requestActivity(
  kind: string,
  id: string,
  requestId: string,
  extraPayload: Record<string, unknown> = {},
  turnId: string | null = null,
) {
  return activityAppendedEvent({
    id,
    kind,
    payload: { requestId, ...extraPayload },
    summary: kind,
    tone: 'info',
    turnId,
  })
}
