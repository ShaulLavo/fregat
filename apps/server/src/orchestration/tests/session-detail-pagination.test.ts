import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  type OrchestrationSessionDetailAnchor,
} from '@workspace/contracts'
import { OrchestrationEngine } from '../engine'
import type { OrchestrationSnapshotQuery } from '../snapshot-query'
import {
  activityAppendedEvent,
  createProjectionFixture,
  messageSentEvent,
  sessionBootstrapEvents,
  SESSION_ID,
} from './factories/projection'

const MESSAGE_COUNT = 5_000
const ACTIVITY_COUNT = 320
const SEED_TIMEOUT_MS = 60_000

/**
 * Seeded once: every test here is a read, and re-projecting five thousand events
 * per test is what turns a pagination suite into a minute of wall clock. The
 * timeout is generous because the seed runs the real event store and projector,
 * which under a fully parallel suite is far slower than it is alone.
 */
let fixture: ReturnType<typeof createProjectionFixture>
let snapshots: OrchestrationSnapshotQuery

beforeAll(() => {
  fixture = createProjectionFixture()
  snapshots = fixture.snapshots
  fixture.pipeline.applyEvents(fixture.append(sessionBootstrapEvents()))
  fixture.pipeline.applyEvents(
    fixture.append(
      Array.from({ length: MESSAGE_COUNT }, (_, index) =>
        messageSentEvent({
          createdAt: messageCreatedAt(index),
          messageId: messageId(index),
          streaming: false,
          text: `message ${index}`,
        }),
      ),
    ),
  )
  fixture.pipeline.applyEvents(
    fixture.append(
      Array.from({ length: ACTIVITY_COUNT }, (_, index) =>
        activityAppendedEvent({ createdAt: activityCreatedAt(index), id: activityId(index) }),
      ),
    ),
  )
}, SEED_TIMEOUT_MS)

afterAll(() => {
  fixture.close()
})

describe('session detail pagination', () => {
  it('opens a five thousand message session on a bounded window', () => {
    const detail = snapshots.sessionDetailSnapshot(SESSION_ID)

    expect(detail.session.messages).toHaveLength(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
    expect(detail.session.messages.at(-1)?.id).toBe(messageId(MESSAGE_COUNT - 1))
    expect(detail.session.messages.at(0)?.id).toBe(
      messageId(MESSAGE_COUNT - ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE),
    )
    expect(detail.session.activities).toHaveLength(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
  })

  it('walks backwards in order until the session is exhausted, reaching every row', () => {
    const detail = snapshots.sessionDetailSnapshot(SESSION_ID)
    const messages = detail.session.messages.map((message) => message.id)
    const activities = detail.session.activities.map((activity) => activity.id)
    let beforeMessage = anchorOf(detail.session.messages[0])
    let beforeActivity = anchorOf(detail.session.activities[0])
    let pages = 0

    while (pages < MESSAGE_COUNT) {
      const page = snapshots.sessionDetailPage({
        beforeActivity,
        beforeMessage,
        sessionId: SESSION_ID,
      })
      pages += 1
      expect(page.messages.length).toBeLessThanOrEqual(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
      messages.unshift(...page.messages.map((message) => message.id))
      activities.unshift(...page.activities.map((activity) => activity.id))
      beforeMessage = page.messages[0] ? anchorOf(page.messages[0]) : beforeMessage
      beforeActivity = page.activities[0] ? anchorOf(page.activities[0]) : beforeActivity
      if (!page.hasEarlier) break
    }

    // The walk terminated on `hasEarlier`, not on the loop guard.
    expect(pages).toBeLessThan(MESSAGE_COUNT)
    expect(messages).toEqual(Array.from({ length: MESSAGE_COUNT }, (_, index) => messageId(index)))
    expect(activities).toEqual(
      Array.from({ length: ACTIVITY_COUNT }, (_, index) => activityId(index)),
    )
  })

  it('reports no earlier rows once both streams reach the start of the session', () => {
    const page = snapshots.sessionDetailPage({
      beforeActivity: { createdAt: activityCreatedAt(5), id: activityId(5) },
      beforeMessage: { createdAt: messageCreatedAt(5), id: messageId(5) },
      limit: 10,
      sessionId: SESSION_ID,
    })

    expect(page.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 5 }, (_, index) => messageId(index)),
    )
    expect(page.activities.map((activity) => activity.id)).toEqual(
      Array.from({ length: 5 }, (_, index) => activityId(index)),
    )
    expect(page.hasEarlier).toBe(false)
  })

  it('keeps the message and activity walks on their own boundaries', () => {
    // Messages are exhausted while activities are not: the page must still
    // report more to come, or the activity tail would be stranded.
    const page = snapshots.sessionDetailPage({
      beforeActivity: {
        createdAt: activityCreatedAt(ACTIVITY_COUNT - 1),
        id: activityId(ACTIVITY_COUNT - 1),
      },
      beforeMessage: { createdAt: messageCreatedAt(0), id: messageId(0) },
      limit: 10,
      sessionId: SESSION_ID,
    })

    expect(page.messages).toHaveLength(0)
    expect(page.activities.map((activity) => activity.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => activityId(ACTIVITY_COUNT - 11 + index)),
    )
    expect(page.hasEarlier).toBe(true)
  })

  it('reads the whole session for a transcript, oldest first', () => {
    const transcript = snapshots.sessionTranscript(SESSION_ID)

    expect(transcript.session.messages).toHaveLength(MESSAGE_COUNT)
    expect(transcript.session.messages[0]?.id).toBe(messageId(0))
    expect(transcript.session.messages.at(-1)?.id).toBe(messageId(MESSAGE_COUNT - 1))
    expect(transcript.session.activities).toHaveLength(ACTIVITY_COUNT)
    expect(transcript.session.activities[0]?.id).toBe(activityId(0))
    expect(() => snapshots.sessionTranscript('missing-session')).toThrow()
  })

  it('rejects a page read for a session that does not exist', () => {
    expect(() =>
      snapshots.sessionDetailPage({ sessionId: '00000000-0000-4000-8000-000000999999' }),
    ).toThrow()
  })

  it('is reachable from the engine, which is what the RPC method calls', async () => {
    // The page query is only useful if something client-facing can reach it;
    // it spent a release complete and unexposed.
    const engine = new OrchestrationEngine(fixture.database, { providerRuntime: false })
    const page = await engine.sessionDetailPage({ limit: 3, sessionId: SESSION_ID })

    expect(page.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 3 }, (_, index) => messageId(MESSAGE_COUNT - 3 + index)),
    )
    expect(page.hasEarlier).toBe(true)
  })
})

function anchorOf(row: { createdAt: string; id: string } | undefined) {
  expect(row).toBeDefined()

  return { createdAt: row?.createdAt ?? '', id: row?.id ?? '' } as OrchestrationSessionDetailAnchor
}

/** Zero padded so the id tiebreak orders the same way the index does. */
function messageId(index: number) {
  return `message-${String(index).padStart(5, '0')}`
}

function activityId(index: number) {
  return `activity-${String(index).padStart(5, '0')}`
}

function messageCreatedAt(index: number) {
  // Each timestamp spans multiple pages, so the walk must use the ID tie breaker.
  return new Date(Date.UTC(2026, 4, 24) + Math.floor(index / 500) * 1000).toISOString()
}

function activityCreatedAt(index: number) {
  return new Date(Date.UTC(2026, 4, 25) + index * 1000).toISOString()
}
