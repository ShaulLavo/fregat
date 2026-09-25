import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../../db/migrations'
import * as schema from '../../../db/schema'
import type { PlatformDatabase } from '../../../db/client'
import { OrchestrationEventStore, type PendingOrchestrationEvent } from '../../event-store'
import { OrchestrationProjectionPipeline } from '../../projection-pipeline'
import { OrchestrationSnapshotQuery } from '../../snapshot-query'

const WORKSPACE_PROJECT_ID = '10000000-0000-4000-8000-000000000002'

const WORKTREE_ID = '20000000-0000-4000-8000-000000000002'
const CREATED_AT = '2026-05-24T00:00:00.000Z'

/**
 * A projected workspace with `sessionCount` live sessions, plus a read handle
 * that counts the queries a stream issues. Query counts are the only honest
 * assertion here: wall time on an in-memory SQLite is dominated by noise, while
 * "does a delta read the whole workspace" is exactly a count.
 */
export function createShellWorkspace(sessionCount: number) {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)

  const eventStore = new OrchestrationEventStore(database)
  const pipeline = new OrchestrationProjectionPipeline(database, eventStore)
  const counter = countingDatabase(database)
  const sessionIds = Array.from(
    { length: sessionCount },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  )

  const seeded = eventStore.append([
    projectCreatedEvent(),
    workspaceEvent(WORKTREE_ID, 'worktree', 'worktree.registered', {
      worktreeId: WORKTREE_ID,
      projectId: WORKSPACE_PROJECT_ID,
      registrationGeneration: 0,
      canonicalPath: '/workspace',
      path: '/workspace',
      branch: null,
      kind: 'current',
      ownership: 'protected',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      retiredAt: null,
    }),
    ...sessionIds.map((sessionId) => sessionCreatedEvent(sessionId)),
    ...sessionIds.map((sessionId) => runtimeSetEvent(sessionId)),
  ])
  pipeline.applyEvents(seeded)

  return {
    close: () => sqlite.close(),
    countedDatabase: counter.database,
    database,
    eventStore,
    pipeline,
    resetQueryCount: counter.reset,
    queryCount: counter.count,
    snapshots: new OrchestrationSnapshotQuery(counter.database),
    sessionIds,
    /** Appends, projects, and returns sequenced events ready to publish. */
    commit: (pending: PendingOrchestrationEvent[]) => {
      const events = eventStore.append(pending)
      pipeline.applyEvents(events)

      return events
    },
  }
}

export function assistantDeltaEvent(sessionId: string, text: string, occurredAt = CREATED_AT) {
  return workspaceEvent(sessionId, 'session', 'session.message-sent', {
    attachments: [],
    createdAt: occurredAt,
    messageId: `message-${sessionId}`,
    role: 'assistant',
    streaming: true,
    text,
    sessionId,
    turnId: null,
    updatedAt: occurredAt,
  })
}

export function sessionDeletedEvent(sessionId: string, occurredAt = CREATED_AT) {
  return workspaceEvent(sessionId, 'session', 'session.deleted', {
    deletedAt: occurredAt,
    sessionId,
  })
}

function projectCreatedEvent() {
  return workspaceEvent(WORKSPACE_PROJECT_ID, 'project', 'project.created', {
    createdAt: CREATED_AT,
    defaultModelSelection: null,
    projectId: WORKSPACE_PROJECT_ID,
    title: 'Shell',
    updatedAt: CREATED_AT,
    repositoryKey: 'shell-fixture',
    repositoryKind: 'directory',
    repositoryIdentity: { source: 'path', canonical: '/workspace' },
  })
}

function sessionCreatedEvent(sessionId: string) {
  return workspaceEvent(sessionId, 'session', 'session.created', {
    createdAt: CREATED_AT,
    interactionMode: 'default',
    modelSelection: { model: 'gpt-5-codex', providerInstanceId: 'codex' },
    worktreeId: WORKTREE_ID,
    origin: 'platform',
    runtimeMode: 'full-access',
    sessionId,
    title: sessionId,
    updatedAt: CREATED_AT,
  })
}

function runtimeSetEvent(sessionId: string) {
  return workspaceEvent(sessionId, 'session', 'session.runtime-set', {
    runtime: {
      activeTurnId: null,
      lastError: null,
      providerInstanceId: 'codex',
      providerName: 'codex',
      providerBindingHandle: `provider-session-${sessionId}`,
      providerConversationMarker: null,
      providerResumeCursor: null,
      runtimeEpoch: 'epoch-fixture',
      runtimeMode: 'full-access',
      status: 'running',
      sessionId,
      updatedAt: CREATED_AT,
    },
    sessionId,
  })
}

function workspaceEvent(
  aggregateId: string,
  aggregateKind: 'project' | 'worktree' | 'session',
  type: string,
  payload: unknown,
  occurredAt = CREATED_AT,
) {
  return {
    actorKind: 'client',
    aggregateId,
    aggregateKind,
    causationEventId: null,
    commandId: null,
    correlationId: null,
    eventId: `event-${crypto.randomUUID()}`,
    metadata: {},
    occurredAt,
    payload,
    type,
  } as unknown as PendingOrchestrationEvent
}

/**
 * Counts `select()` calls, which is one-to-one with statements issued: drizzle
 * builds every read from `database.select()`.
 */
function countingDatabase(database: PlatformDatabase) {
  let selects = 0
  const proxy = new Proxy(database, {
    get(target, property) {
      if (property === 'select') selects += 1
      const value = Reflect.get(target, property) as unknown

      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return {
    count: () => selects,
    database: proxy as PlatformDatabase,
    reset: () => {
      selects = 0
    },
  }
}
