import { afterEach, describe, expect, it } from 'vitest'
import type { PendingOrchestrationEvent } from '../event-store'
import { OrchestrationSnapshotQuery } from '../snapshot-query'
import {
  createProjectionFixture,
  proposedPlanUpsertedEvent,
  proposedPlanImplementedEvent,
  sessionBootstrapEvents,
  turnStartEvent,
  SESSION_ID,
} from './factories/projection'

const planMarkdown = '# Plan\n\n1. Read the code\n2. Change it'
const requestedAt = '2026-05-24T00:05:00.000Z'
const fixtures: Array<{ close: () => void }> = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.close()
  }
})

describe('orchestration proposed plan projection', () => {
  it('keeps the plan markdown readable after a reload', () => {
    const fixture = project(
      sessionBootstrapEvents().concat([
        proposedPlanUpsertedEvent({ planId: 'plan-1', planMarkdown }),
      ]),
    )

    // A fresh query over the same file is what a restart sees: no replay, no
    // live events, only what the projection wrote.
    const reloaded = new OrchestrationSnapshotQuery(fixture.database).sessionDetailSnapshot(
      SESSION_ID,
    )

    expect(reloaded.proposedPlans).toMatchObject([
      { id: 'plan-1', implementedAt: null, planMarkdown, sessionId: SESSION_ID },
    ])
  })

  it('reports an unimplemented plan as actionable in both projections', () => {
    const fixture = project(
      sessionBootstrapEvents().concat([
        proposedPlanUpsertedEvent({ planId: 'plan-1', planMarkdown }),
      ]),
    )

    expect(shellSession(fixture).hasActionableProposedPlan).toBe(true)
    expect(memorySession(fixture).hasActionableProposedPlan).toBe(true)
  })

  it('stops offering a plan once a turn is started from it', () => {
    const fixture = project(
      sessionBootstrapEvents().concat([
        proposedPlanUpsertedEvent({ planId: 'plan-1', planMarkdown }),
        turnStartEvent('turn-1', requestedAt, { planId: 'plan-1', sessionId: SESSION_ID }),
        proposedPlanImplementedEvent(SESSION_ID, requestedAt),
      ]),
    )
    const detail = fixture.snapshots.sessionDetailSnapshot(SESSION_ID)

    expect(detail.proposedPlans[0]).toMatchObject({
      implementationSessionId: SESSION_ID,
      implementedAt: requestedAt,
    })
    expect(shellSession(fixture).hasActionableProposedPlan).toBe(false)
    expect(memorySession(fixture).hasActionableProposedPlan).toBe(false)
  })

  it('never latches: a plan that arrives already implemented is not actionable', () => {
    const fixture = project(
      sessionBootstrapEvents().concat([
        proposedPlanUpsertedEvent({
          implementationSessionId: SESSION_ID,
          implementedAt: requestedAt,
          planId: 'plan-1',
          planMarkdown,
        }),
      ]),
    )

    expect(shellSession(fixture).hasActionableProposedPlan).toBe(false)
    expect(memorySession(fixture).hasActionableProposedPlan).toBe(false)
  })
})

function project(events: PendingOrchestrationEvent[]) {
  const fixture = createProjectionFixture()
  fixtures.push(fixture)
  fixture.pipeline.applyEvents(fixture.append(events))

  return fixture
}

function shellSession(fixture: ReturnType<typeof createProjectionFixture>) {
  const session = fixture.snapshots
    .shellSnapshot()
    .sessions.find((entry) => entry.id === SESSION_ID)
  if (!session) return expect.unreachable('shell snapshot is missing the session')

  return session
}

function memorySession(fixture: ReturnType<typeof createProjectionFixture>) {
  const model = fixture.snapshots.fullReadModel()
  const session = model.sessions.get(SESSION_ID)
  if (!session) return expect.unreachable('read model is missing the session')

  return session
}
