import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../../db/migrations'
import * as schema from '../../../db/schema'
import { OrchestrationEventStore, type PendingOrchestrationEvent } from '../../event-store'
import { OrchestrationProjectionPipeline } from '../../projection-pipeline'
import { OrchestrationSnapshotQuery } from '../../snapshot-query'
import { createEmptyReadModel, type OrchestrationReadModel } from '../../read-model'

export const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
export const WORKTREE_ID = '20000000-0000-4000-8000-000000000001'
export const SESSION_ID = '00000000-0000-4000-8000-000000000001'

export function createProjectionFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)
  const eventStore = new OrchestrationEventStore(database)

  return {
    close: () => sqlite.close(),
    database,
    eventStore,
    pipeline: new OrchestrationProjectionPipeline(database, eventStore),
    snapshots: new OrchestrationSnapshotQuery(database),
    /** Appends to the real event store and returns the sequenced events. */
    append: (events: PendingOrchestrationEvent[]) => eventStore.append(events),
  }
}

export function pendingEvent(
  type: PendingOrchestrationEvent['type'],
  payload: unknown,
  occurredAt = '2026-05-24T00:00:00.000Z',
) {
  const pending = {
    actorKind: 'client',
    // The aggregate follows the payload, exactly as the decider does it, so a
    // fixture can name a session other than the default one.
    ...aggregate(payload),
    causationEventId: null,
    commandId: null,
    correlationId: null,
    eventId: `event-${crypto.randomUUID()}`,
    metadata: {},
    occurredAt,
    payload,
    type,
  }

  return pending as PendingOrchestrationEvent
}

function aggregate(payload: unknown) {
  const record = payload as { projectId?: string; worktreeId?: string; sessionId?: string }
  if (record.sessionId) return { aggregateId: record.sessionId, aggregateKind: 'session' } as const

  if (record.worktreeId)
    return { aggregateId: record.worktreeId, aggregateKind: 'worktree' } as const
  return { aggregateId: record.projectId ?? PROJECT_ID, aggregateKind: 'project' } as const
}

/**
 * Drives the pipeline and the read-model cache exactly as the engine does: one
 * committed batch at a time, SQL first, then the cache refresh over the same
 * events. Tests that assert on the in-memory model must go through this and not
 * through a hand-rolled loop, or they stop testing the path production runs.
 */
export function applyIncrementally(
  fixture: ReturnType<typeof createProjectionFixture>,
  events: PendingOrchestrationEvent[],
): OrchestrationReadModel {
  let model = createEmptyReadModel()

  for (const pending of events) {
    const batch = fixture.append([pending])
    fixture.pipeline.applyEvents(batch)
    model = fixture.snapshots.refreshReadModel(model, batch)
  }

  return model
}

export function sessionCreatedEvent(sessionId: string, createdAt = '2026-05-24T00:00:00.000Z') {
  return pendingEvent(
    'session.created',
    {
      createdAt,
      interactionMode: 'default',
      modelSelection: { model: 'gpt-5-codex', providerInstanceId: 'codex' },
      worktreeId: WORKTREE_ID,
      origin: 'platform',
      runtimeMode: 'full-access',
      sessionId,
      title: 'Projection',
      updatedAt: createdAt,
    },
    createdAt,
  )
}

export function sessionBootstrapEvents(createdAt = '2026-05-24T00:00:00.000Z') {
  return [
    pendingEvent(
      'project.created',
      {
        createdAt,
        defaultModelSelection: null,
        projectId: PROJECT_ID,
        title: 'Platform',
        updatedAt: createdAt,
        repositoryKey: 'projection-fixture',
        repositoryKind: 'directory',
        repositoryIdentity: { source: 'path', canonical: '/workspace' },
      },
      createdAt,
    ),
    pendingEvent(
      'worktree.registered',
      {
        worktreeId: WORKTREE_ID,
        projectId: PROJECT_ID,
        registrationGeneration: 0,
        canonicalPath: '/workspace',
        path: '/workspace',
        branch: null,
        kind: 'current',
        ownership: 'protected',
        createdAt,
        updatedAt: createdAt,
      },
      createdAt,
    ),
    sessionCreatedEvent(SESSION_ID, createdAt),
  ]
}

export function turnStartEventOnSession(
  sessionId: string,
  turnId: string,
  requestedAt: string,
  sourceProposedPlan?: { planId: string; sessionId: string },
) {
  return pendingEvent(
    'session.turn-start-requested',
    {
      createdAt: requestedAt,
      interactionMode: 'default',
      messageId: `message-user-${turnId}`,
      runtimeMode: 'full-access',
      sourceProposedPlan,
      sessionId,
      turnId,
    },
    requestedAt,
  )
}

export function turnStartEvent(
  turnId: string,
  requestedAt: string,
  sourceProposedPlan?: { planId: string; sessionId: string },
) {
  return turnStartEventOnSession(SESSION_ID, turnId, requestedAt, sourceProposedPlan)
}

export function proposedPlanUpsertedEvent(input: {
  createdAt?: string
  implementedAt?: string | null
  implementationSessionId?: string | null
  planId: string
  planMarkdown: string
  turnId?: string | null
  updatedAt?: string
}) {
  const createdAt = input.createdAt ?? '2026-05-24T00:01:00.000Z'
  const updatedAt = input.updatedAt ?? createdAt

  return pendingEvent(
    'session.proposed-plan-upserted',
    {
      proposedPlan: {
        createdAt,
        id: input.planId,
        implementationSessionId: input.implementationSessionId ?? null,
        implementedAt: input.implementedAt ?? null,
        planMarkdown: input.planMarkdown,
        sessionId: SESSION_ID,
        turnId: input.turnId ?? null,
        updatedAt,
      },
      sessionId: SESSION_ID,
    },
    updatedAt,
  )
}

export function turnDiffCompletedEvent(input: {
  assistantMessageId?: string | null
  checkpointRef?: string
  checkpointTurnCount: number
  completedAt?: string
  files?: Array<{ additions: number; deletions: number; kind: string; path: string }>
  status?: 'ready' | 'missing' | 'error'
  turnId: string
}) {
  const completedAt = input.completedAt ?? '2026-05-24T00:04:00.000Z'

  return pendingEvent(
    'session.turn-diff-completed',
    {
      assistantMessageId: input.assistantMessageId ?? null,
      checkpointRef: input.checkpointRef ?? `refs/platform/${SESSION_ID}/${input.turnId}`,
      checkpointTurnCount: input.checkpointTurnCount,
      completedAt,
      files: input.files ?? [],
      status: input.status ?? 'ready',
      sessionId: SESSION_ID,
      turnId: input.turnId,
    },
    completedAt,
  )
}

export function runtimeSetEvent(
  session: Partial<{
    activeTurnId: string | null
    lastError: string | null
    status: string
    updatedAt: string
  }> = {},
) {
  const updatedAt = session.updatedAt ?? '2026-05-24T00:02:00.000Z'

  return pendingEvent(
    'session.runtime-set',
    {
      runtime: {
        activeTurnId: session.activeTurnId ?? null,
        lastError: session.lastError ?? null,
        providerInstanceId: 'codex',
        providerName: 'codex',
        providerBindingHandle: 'provider-session-1',
        providerConversationMarker: null,
        providerResumeCursor: null,
        runtimeEpoch: 'epoch-fixture',
        runtimeMode: 'full-access',
        status: session.status ?? 'running',
        sessionId: SESSION_ID,
        updatedAt,
      },
      sessionId: SESSION_ID,
    },
    updatedAt,
  )
}

export function messageSentEvent(input: {
  attachments?: unknown[]
  createdAt?: string
  messageId: string
  role?: 'assistant' | 'user'
  streaming: boolean
  text: string
  turnId?: string | null
  updatedAt?: string
}) {
  const createdAt = input.createdAt ?? '2026-05-24T00:01:00.000Z'
  const updatedAt = input.updatedAt ?? createdAt

  return pendingEvent(
    'session.message-sent',
    {
      attachments: input.attachments ?? [],
      createdAt,
      messageId: input.messageId,
      role: input.role ?? 'assistant',
      streaming: input.streaming,
      text: input.text,
      sessionId: SESSION_ID,
      turnId: input.turnId ?? null,
      updatedAt,
    },
    updatedAt,
  )
}

export function activityAppendedEvent(input: {
  createdAt?: string
  id: string
  kind?: string
  payload?: unknown
  summary?: string
  tone?: string
  turnId?: string | null
}) {
  const createdAt = input.createdAt ?? '2026-05-24T00:01:30.000Z'

  return pendingEvent(
    'session.activity-appended',
    {
      activity: {
        createdAt,
        id: input.id,
        kind: input.kind ?? 'tool.started',
        payload: input.payload ?? null,
        summary: input.summary ?? 'Tool started',
        sessionId: SESSION_ID,
        tone: input.tone ?? 'tool',
        turnId: input.turnId ?? null,
      },
      sessionId: SESSION_ID,
    },
    createdAt,
  )
}

export function proposedPlanImplementedEvent(
  implementationSessionId: string,
  implementedAt: string,
  planId = 'plan-1',
) {
  return pendingEvent(
    'session.proposed-plan-implemented',
    {
      sessionId: SESSION_ID,
      planId,
      implementationSessionId,
      implementedAt,
      updatedAt: implementedAt,
    },
    implementedAt,
  )
}
