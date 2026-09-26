import { afterEach, describe, expect, it } from 'vitest'
import { createMetadataDatabase, type MetadataDatabaseHandle } from '../../db/client'
import { initializePlatformDatabase } from '../../db/initialize'
import { projectionTurns } from '../../db/schema'
import { OrchestrationEventStore } from '../event-store'
import { OrchestrationProjectionPipeline } from '../projection-pipeline'
import { OrchestrationSnapshotQuery } from '../snapshot-query'
import { createShellRowReader, ProjectionShellRowReader } from '../shell-row-reader'
import { DOMAIN_AT, DOMAIN_IDS, domainBootstrap, domainEvent } from './factories/session-domain'

const handles: MetadataDatabaseHandle[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
})

function database() {
  const handle = createMetadataDatabase({ databasePath: ':memory:' })
  handles.push(handle)
  initializePlatformDatabase(handle.db)
  return handle.db
}

describe('session domain projection', () => {
  it.each([true, false])(
    'records the turn start before a final-only answer (runtime start=%s)',
    (runtimeStarted) => {
      const db = database()
      const pipeline = new OrchestrationProjectionPipeline(db)
      const startedAt = runtimeStarted ? '2026-09-05T00:00:01.000Z' : DOMAIN_AT
      const answeredAt = '2026-09-05T00:00:10.000Z'
      const completedAt = '2026-09-05T00:00:10.001Z'
      pipeline.applyEvents(domainBootstrap())
      pipeline.applyEvents([
        domainEvent(
          'session.turn-start-requested',
          {
            sessionId: DOMAIN_IDS.session,
            turnId: DOMAIN_IDS.turn,
            messageId: 'question',
            createdAt: DOMAIN_AT,
          },
          4,
        ),
      ])
      if (runtimeStarted) {
        pipeline.applyEvents([
          domainEvent(
            'session.runtime-set',
            {
              sessionId: DOMAIN_IDS.session,
              runtime: {
                sessionId: DOMAIN_IDS.session,
                providerInstanceId: 'mock',
                providerName: 'Mock',
                providerBindingHandle: 'mock-binding',
                providerConversationMarker: null,
                providerResumeCursor: null,
                runtimeEpoch: 'test-epoch',
                runtimeMode: 'full-access',
                activeTurnId: DOMAIN_IDS.turn,
                status: 'running',
                lastError: null,
                updatedAt: startedAt,
              },
            },
            5,
          ),
        ])
        expect(
          new OrchestrationSnapshotQuery(db).fullReadModel().sessions.get(DOMAIN_IDS.session)
            ?.latestTurn?.startedAt,
        ).toBe(startedAt)
      }
      pipeline.applyEvents([
        domainEvent(
          'session.message-sent',
          {
            sessionId: DOMAIN_IDS.session,
            turnId: DOMAIN_IDS.turn,
            messageId: 'final-answer',
            role: 'assistant',
            text: 'Done',
            attachments: [],
            streaming: false,
            createdAt: answeredAt,
            updatedAt: completedAt,
          },
          6,
        ),
      ])
      expect(db.select().from(projectionTurns).get()).toMatchObject({
        requestedAt: DOMAIN_AT,
        startedAt,
      })
      expect(
        new OrchestrationSnapshotQuery(db).fullReadModel().sessions.get(DOMAIN_IDS.session)
          ?.latestTurn?.startedAt,
      ).toBe(startedAt)
    },
  )

  it('interrupts ambiguous provider adoption even after assistant text completed', () => {
    const db = database()
    const pipeline = new OrchestrationProjectionPipeline(db)
    pipeline.applyEvents(domainBootstrap())
    pipeline.applyEvents([
      domainEvent(
        'session.turn-start-requested',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          messageId: 'message-fixture',
          createdAt: DOMAIN_AT,
        },
        4,
      ),
      domainEvent(
        'session.provider-start-claimed',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          generation: 1,
          runtimeEpoch: 'epoch-1',
          createdAt: DOMAIN_AT,
        },
        5,
      ),
      domainEvent(
        'session.provider-start-adopted',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          generation: 1,
          runtimeEpoch: 'epoch-1',
          createdAt: DOMAIN_AT,
        },
        6,
      ),
      domainEvent(
        'session.message-sent',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          messageId: 'assistant-complete',
          role: 'assistant',
          text: 'Done',
          attachments: [],
          streaming: false,
          createdAt: DOMAIN_AT,
          updatedAt: DOMAIN_AT,
        },
        7,
      ),
    ])
    expect(db.select().from(projectionTurns).get()).toMatchObject({
      state: 'completed',
      providerStartState: 'adopted',
    })
    pipeline.applyEvents([
      domainEvent(
        'session.runtime-recovered',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          observedSequence: 6,
          runtimeEpoch: 'epoch-1',
          message: 'Runtime ownership was lost',
          createdAt: DOMAIN_AT,
        },
        8,
      ),
    ])
    expect(db.select().from(projectionTurns).get()).toMatchObject({
      state: 'interrupted',
      providerStartState: 'interrupted',
      providerStartSequence: 8,
    })
  })

  it('drains more than one replay page before the first complete snapshot', () => {
    const db = database()
    const store = new OrchestrationEventStore(db)
    store.append(domainBootstrap())
    store.append(
      Array.from({ length: 1_102 }, (_, index) =>
        domainEvent(
          'project.meta-updated',
          { projectId: DOMAIN_IDS.project, title: `Project ${index}`, updatedAt: DOMAIN_AT },
          index + 4,
        ),
      ),
    )
    const pipeline = new OrchestrationProjectionPipeline(db, store)
    expect(pipeline.catchUp()).toMatchObject({ eventCount: 1_105, pageCount: 2, sequence: 1_105 })
    expect(new OrchestrationSnapshotQuery(db).shellSnapshot()).toMatchObject({
      snapshotSequence: 1_105,
      projects: [{ id: DOMAIN_IDS.project, title: 'Project 1101' }],
      worktrees: [{ id: DOMAIN_IDS.worktree, projectId: DOMAIN_IDS.project }],
      sessions: [
        { id: DOMAIN_IDS.session, worktreeId: DOMAIN_IDS.worktree, attentionState: 'settled' },
      ],
    })
    expect(pipeline.catchUp()).toMatchObject({ eventCount: 0, sequence: 1_105 })
  })
  it('keeps point reads, snapshots and read-model attention coherent', () => {
    const db = database()
    const pipeline = new OrchestrationProjectionPipeline(db)
    pipeline.applyEvents(domainBootstrap())
    pipeline.applyEvents([
      domainEvent(
        'session.activity-appended',
        {
          sessionId: DOMAIN_IDS.session,
          activity: {
            id: 'approval-activity',
            sessionId: DOMAIN_IDS.session,
            turnId: null,
            tone: 'approval',
            kind: 'approval.requested',
            summary: 'Approve',
            payload: { requestId: 'approval-1' },
            createdAt: DOMAIN_AT,
          },
        },
        4,
      ),
    ])
    const snapshots = new OrchestrationSnapshotQuery(db)
    const readers = new ProjectionShellRowReader(db)
    expect(readers.sessionShell(DOMAIN_IDS.session)).toEqual(snapshots.shellSnapshot().sessions[0])
    expect(readers.worktreeShell(DOMAIN_IDS.worktree)).toEqual(
      snapshots.shellSnapshot().worktrees[0],
    )
    expect(snapshots.fullReadModel().sessions.get(DOMAIN_IDS.session)).toMatchObject({
      attentionState: 'needs-input',
      attentionReason: 'approval',
      pendingApprovalCount: 1,
      hasError: false,
    })
  })
  it('keeps streamed point reads aligned with changing live background tasks', () => {
    const db = database()
    new OrchestrationProjectionPipeline(db).applyEvents(domainBootstrap())
    const states: Array<'working' | 'monitoring' | null> = ['working', 'monitoring', null]
    let liveness: (typeof states)[number] = null
    const snapshots = new OrchestrationSnapshotQuery(db, (sessionId) =>
      sessionId === DOMAIN_IDS.session ? liveness : null,
    )
    const reader = createShellRowReader(snapshots, db)

    for (const state of states) {
      liveness = state
      reader.beginWindow()
      const session = reader.sessionShell(DOMAIN_IDS.session)
      expect(session?.backgroundLiveness).toBe(state)
      expect(session).toEqual(snapshots.shellSnapshot().sessions[0])
    }
  })
  it('persists claims and exposes recovery interruptions after acknowledgement', () => {
    const db = database()
    const pipeline = new OrchestrationProjectionPipeline(db)
    pipeline.applyEvents(domainBootstrap())
    pipeline.applyEvents([
      domainEvent(
        'session.turn-start-requested',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          messageId: 'message-fixture',
          createdAt: DOMAIN_AT,
        },
        4,
      ),
    ])
    pipeline.applyEvents([
      domainEvent(
        'session.provider-start-claimed',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          generation: 1,
          runtimeEpoch: 'epoch-1',
          createdAt: DOMAIN_AT,
        },
        5,
      ),
    ])
    expect(db.select().from(projectionTurns).get()).toMatchObject({
      providerStartState: 'claimed',
      providerStartGeneration: 1,
      providerStartSequence: 5,
      runtimeEpoch: 'epoch-1',
    })
    pipeline.applyEvents([
      domainEvent(
        'session.runtime-recovered',
        {
          sessionId: DOMAIN_IDS.session,
          turnId: DOMAIN_IDS.turn,
          observedSequence: 5,
          runtimeEpoch: 'epoch-1',
          message: 'Provider start interrupted',
          createdAt: DOMAIN_AT,
        },
        6,
      ),
    ])
    const snapshots = new OrchestrationSnapshotQuery(db)
    expect(snapshots.sessionDetailSnapshot(DOMAIN_IDS.session).session).toMatchObject({
      attentionReason: 'interruption',
      hasError: true,
      latestTurn: { providerStartState: 'interrupted', state: 'interrupted' },
    })
    pipeline.applyEvents([
      domainEvent(
        'session.settled',
        {
          sessionId: DOMAIN_IDS.session,
          settledAt: DOMAIN_AT,
          updatedAt: DOMAIN_AT,
          acknowledgedFailureThroughSequence: 6,
        },
        7,
      ),
    ])
    expect(snapshots.shellSnapshot().sessions[0]).toMatchObject({
      attentionState: 'settled',
      hasError: false,
    })
    pipeline.applyEvents([
      domainEvent(
        'session.runtime-recovered',
        {
          sessionId: DOMAIN_IDS.session,
          observedSequence: 7,
          runtimeEpoch: 'epoch-2',
          message: 'Another interruption',
          createdAt: DOMAIN_AT,
        },
        8,
      ),
    ])
    expect(snapshots.shellSnapshot().sessions[0]).toMatchObject({
      attentionReason: 'interruption',
      hasError: true,
    })
  })
})
