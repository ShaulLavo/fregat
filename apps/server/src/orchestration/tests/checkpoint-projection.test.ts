import { sql } from 'drizzle-orm'
import * as v from 'valibot'
import { sessionIdSchema, turnIdSchema } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import type { PendingOrchestrationEvent } from '../event-store'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../../git/service'
import { OrchestrationCheckpointDiffQuery } from '../checkpoint-diff-query'
import {
  createProjectionFixture,
  pendingEvent,
  runtimeSetEvent,
  sessionBootstrapEvents,
  turnDiffCompletedEvent,
  turnStartEvent,
  SESSION_ID,
} from './factories/projection'

const sessionId = v.parse(sessionIdSchema, SESSION_ID)
const turnOneId = v.parse(turnIdSchema, 'turn-1')
const requestedAt = '2026-05-24T00:01:00.000Z'
const readyRef = 'refs/platform/session-1/ready'
const placeholderRef = 'refs/platform/session-1/placeholder'
const fixtures: Array<{ close: () => void }> = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.close()
  }
})

describe('orchestration checkpoint projection', () => {
  it('answers from the projection after the event log is gone', async () => {
    const fixture = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      turnDiffCompletedEvent({
        checkpointRef: readyRef,
        checkpointTurnCount: 1,
        files: [{ additions: 2, deletions: 1, kind: 'modified', path: 'app.txt' }],
        turnId: 'turn-1',
      }),
    ])
    // Nothing may re-fold the stream to answer a checkpoint question: with the
    // events deleted, a reader that still scans them comes back empty.
    fixture.database.run(sql`DELETE FROM orchestration_events`)

    const detail = fixture.snapshots.sessionDetailSnapshot(SESSION_ID)

    expect(detail.checkpoints).toMatchObject([
      {
        checkpointRef: readyRef,
        checkpointTurnCount: 1,
        files: [{ additions: 2, deletions: 1, kind: 'modified', path: 'app.txt' }],
        status: 'ready',
        turnId: 'turn-1',
      },
    ])
    await expect(
      diffQuery(fixture).turnDiff({ fromTurnCount: 1, sessionId, toTurnCount: 1 }),
    ).resolves.toEqual([])
  })

  it('drops the checkpoints a revert undid', () => {
    const fixture = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      turnDiffCompletedEvent({ checkpointTurnCount: 1, turnId: 'turn-1' }),
      turnStartEvent('turn-2', requestedAt),
      turnDiffCompletedEvent({ checkpointTurnCount: 2, turnId: 'turn-2' }),
      revertedEvent(1),
    ])

    expect(
      fixture.snapshots.sessionDetailSnapshot(SESSION_ID).checkpoints.map((entry) => entry.turnId),
    ).toEqual(['turn-1'])
  })

  it('never lets a placeholder overwrite a captured checkpoint', () => {
    const fixture = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      turnDiffCompletedEvent({ checkpointRef: readyRef, checkpointTurnCount: 1, turnId: 'turn-1' }),
      turnDiffCompletedEvent({
        checkpointRef: placeholderRef,
        checkpointTurnCount: 1,
        status: 'missing',
        turnId: 'turn-1',
      }),
    ])

    expect(fixture.snapshots.sessionDetailSnapshot(SESSION_ID).checkpoints).toMatchObject([
      { checkpointRef: readyRef, status: 'ready' },
    ])
    expect(memorySession(fixture).checkpointByTurnId[turnOneId]).toMatchObject({
      checkpointRef: readyRef,
      status: 'ready',
    })
  })

  it('does not settle a turn its session is still running', () => {
    const fixture = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      runtimeSetEvent({ activeTurnId: 'turn-1', status: 'running' }),
      turnDiffCompletedEvent({
        checkpointTurnCount: 1,
        status: 'missing',
        turnId: 'turn-1',
      }),
    ])

    expect(fixture.snapshots.sessionDetailSnapshot(SESSION_ID).session.latestTurn).toMatchObject({
      completedAt: null,
      state: 'running',
    })
    expect(memorySession(fixture).latestTurn).toMatchObject({ completedAt: null, state: 'running' })
  })

  it('rejects an inverted range with a typed code the client can branch on', async () => {
    const fixture = project(sessionBootstrapEvents())

    const error = await captureRejection(
      diffQuery(fixture).turnDiff({ fromTurnCount: 3, sessionId, toTurnCount: 1 }),
    )

    expect(error).toMatchObject({
      code: 'checkpoint.RANGE_INVALID',
      name: 'EvlogError',
      status: 400,
    })
  })

  it('rejects a range past the last checkpoint with a typed code', async () => {
    const fixture = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      turnDiffCompletedEvent({ checkpointTurnCount: 1, turnId: 'turn-1' }),
    ])

    const error = await captureRejection(
      diffQuery(fixture).turnDiff({ fromTurnCount: 0, sessionId, toTurnCount: 4 }),
    )

    expect(error).toMatchObject({
      code: 'checkpoint.RANGE_EXCEEDS_TURN_COUNT',
      name: 'EvlogError',
      status: 404,
    })
  })

  it('rejects an uncaptured checkpoint with a typed code', async () => {
    const fixture = project([
      ...sessionBootstrapEvents(),
      turnStartEvent('turn-1', requestedAt),
      turnDiffCompletedEvent({ checkpointTurnCount: 1, status: 'missing', turnId: 'turn-1' }),
    ])

    const error = await captureRejection(
      diffQuery(fixture).turnDiff({ fromTurnCount: 0, sessionId, toTurnCount: 1 }),
    )

    expect(error).toMatchObject({ code: 'checkpoint.REF_UNAVAILABLE', name: 'EvlogError' })
  })
})

function project(events: PendingOrchestrationEvent[]) {
  const fixture = createProjectionFixture()
  fixtures.push(fixture)
  fixture.pipeline.applyEvents(fixture.append(events))

  return fixture
}

function revertedEvent(turnCount: number, revertedAt = '2026-05-24T00:06:00.000Z') {
  return pendingEvent(
    'session.reverted',
    { revertedAt, sessionId: SESSION_ID, turnCount },
    revertedAt,
  )
}

function memorySession(fixture: ReturnType<typeof createProjectionFixture>) {
  const model = fixture.snapshots.fullReadModel()
  const session = model.sessions.get(SESSION_ID)
  if (!session) return expect.unreachable('read model is missing the session')

  return session
}

function diffQuery(fixture: ReturnType<typeof createProjectionFixture>) {
  return new OrchestrationCheckpointDiffQuery(
    fixture.database,
    new GitService(createWorkspacePaths(process.cwd())),
  )
}

async function captureRejection(pending: Promise<unknown>) {
  try {
    await pending
  } catch (error) {
    return error
  }

  return expect.unreachable('expected the checkpoint query to reject')
}
