import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import * as v from 'valibot'
import {
  ORCHESTRATION_REPLAY_MAX_EVENTS,
  orchestrationEventMetadataSchema,
} from '@workspace/contracts'
import {
  orchestrationEventSchema,
  type OrchestrationEvent,
  type OrchestrationReplayEventsInput,
} from './schemas'
import { getDefaultPlatformDatabase, type PlatformDatabase } from '../db/client'
import { orchestrationEvents, type OrchestrationEventRow } from '../db/schema'
import {
  orchestrationEventBatchSummary,
  orchestrationReplaySummary,
  recordChatPipelineInfo,
} from './orchestration-logging'
import { orchestrationErrors } from '../observability/structured-errors'

export type OrchestrationDatabase = PlatformDatabase

/**
 * A replay read with an optional caller-supplied page size. `limit` is clamped
 * to `ORCHESTRATION_REPLAY_MAX_EVENTS`, so it can only ever ask for less.
 */
export type OrchestrationReplayEventsQuery = OrchestrationReplayEventsInput & {
  limit?: number
}

export type PendingOrchestrationEvent = {
  [Type in OrchestrationEvent['type']]: Omit<
    Extract<OrchestrationEvent, { type: Type }>,
    'sequence'
  >
}[OrchestrationEvent['type']]

export class OrchestrationEventStore {
  private readonly database: OrchestrationDatabase

  constructor(database: OrchestrationDatabase = getDefaultPlatformDatabase()) {
    this.database = database
  }

  append(events: PendingOrchestrationEvent[]) {
    if (events.length === 0) return []

    recordChatPipelineInfo('chat.pipeline.event_store.append_start', {
      eventCount: events.length,
      eventTypes: events.map((event) => event.type),
    })
    const appended: OrchestrationEvent[] = []
    const streamVersions: number[] = []

    for (const event of events) {
      const inserted = this.database
        .insert(orchestrationEvents)
        .values({
          actorKind: event.actorKind,
          aggregateId: event.aggregateId,
          aggregateKind: event.aggregateKind,
          causationEventId: event.causationEventId,
          commandId: event.commandId,
          correlationId: event.correlationId,
          eventId: event.eventId,
          eventType: event.type,
          metadataJson: JSON.stringify(event.metadata),
          occurredAt: event.occurredAt,
          payloadJson: JSON.stringify(event.payload),
          streamVersion: nextStreamVersion(event),
        })
        .returning({
          sequence: orchestrationEvents.sequence,
          streamVersion: orchestrationEvents.streamVersion,
        })
        .get()

      streamVersions.push(inserted.streamVersion)
      appended.push(v.parse(orchestrationEventSchema, { ...event, sequence: inserted.sequence }))
    }

    recordChatPipelineInfo('chat.pipeline.event_store.append_complete', {
      ...orchestrationEventBatchSummary(appended),
      streamVersions,
    })
    return appended
  }

  hasPlatformTurn(sessionId: string) {
    return Boolean(
      this.database
        .select({ sequence: orchestrationEvents.sequence })
        .from(orchestrationEvents)
        .where(
          and(
            eq(orchestrationEvents.aggregateKind, 'session'),
            eq(orchestrationEvents.aggregateId, sessionId),
            eq(orchestrationEvents.eventType, 'session.turn-start-requested'),
          ),
        )
        .limit(1)
        .get(),
    )
  }

  historyImportState(sessionId: string) {
    const row = this.database
      .select({
        sequence: orchestrationEvents.sequence,
        metadata: orchestrationEvents.metadataJson,
        sourceUpdatedAt: sql<string>`json_extract(${orchestrationEvents.payloadJson}, '$.sourceUpdatedAt')`,
      })
      .from(orchestrationEvents)
      .where(
        and(
          eq(orchestrationEvents.aggregateKind, 'session'),
          eq(orchestrationEvents.aggregateId, sessionId),
          eq(orchestrationEvents.eventType, 'session.history-imported'),
        ),
      )
      .orderBy(desc(orchestrationEvents.sequence))
      .limit(1)
      .get()
    return {
      sequence: row?.sequence ?? 0,
      revision: row
        ? v.parse(orchestrationEventMetadataSchema, JSON.parse(row.metadata)).historyRevision
        : null,
      sourceUpdatedAt: row?.sourceUpdatedAt ?? null,
    }
  }

  currentSequence() {
    const row = this.database
      .select({ sequence: sql<number>`coalesce(max(${orchestrationEvents.sequence}), 0)` })
      .from(orchestrationEvents)
      .get()

    return row?.sequence ?? 0
  }

  /**
   * Reachable from a client through the `replayEvents` RPC and the `/replay`
   * route, so it is always paged: an unbounded read is a request-shaped way to
   * make the server decode the entire event log — every other session's tool
   * payloads included — into one array. Callers that want the rest page by
   * passing the last returned sequence back as `afterSequence`.
   */
  readAfter(input: OrchestrationReplayEventsQuery) {
    const limit = replayLimit(input.limit)
    recordChatPipelineInfo('chat.pipeline.event_store.replay_start', {
      ...orchestrationReplaySummary(input),
      limit,
    })
    const conditions = [gt(orchestrationEvents.sequence, input.afterSequence)]
    const aggregateFilter = aggregateConditions(input)

    if (aggregateFilter) conditions.push(aggregateFilter)

    const events = this.database
      .select()
      .from(orchestrationEvents)
      .where(and(...conditions))
      .orderBy(asc(orchestrationEvents.sequence))
      .limit(limit)
      .all()
      .map(rowToEvent)

    recordChatPipelineInfo('chat.pipeline.event_store.replay_complete', {
      ...orchestrationReplaySummary(input),
      ...orchestrationEventBatchSummary(events),
      limit,
      truncated: events.length === limit,
    })

    return events
  }
}

function replayLimit(requested: number | undefined) {
  if (!requested) return ORCHESTRATION_REPLAY_MAX_EVENTS

  return Math.min(requested, ORCHESTRATION_REPLAY_MAX_EVENTS)
}

function aggregateConditions(input: OrchestrationReplayEventsInput) {
  if (input.sessionId) {
    return and(
      eq(orchestrationEvents.aggregateKind, 'session'),
      eq(orchestrationEvents.aggregateId, input.sessionId),
    )
  }
  if (!input.aggregateKind || !input.aggregateId) return undefined

  return and(
    eq(orchestrationEvents.aggregateKind, input.aggregateKind),
    eq(orchestrationEvents.aggregateId, input.aggregateId),
  )
}

/**
 * The version is computed by the database inside the INSERT, not read out first
 * and handed back. A separate `SELECT max(...)` leaves a window in which another
 * writer can claim the same version; folded in here the read and the write are
 * one statement under the same write lock, so the
 * `(aggregate_kind, aggregate_id, stream_version)` unique index is enforced
 * against live truth rather than against whatever the caller last saw.
 */
function nextStreamVersion(event: PendingOrchestrationEvent) {
  return sql<number>`(
    select coalesce(max(${orchestrationEvents.streamVersion}), 0) + 1
    from ${orchestrationEvents}
    where ${orchestrationEvents.aggregateKind} = ${event.aggregateKind}
      and ${orchestrationEvents.aggregateId} = ${event.aggregateId}
  )`
}

export function rowToEvent(row: OrchestrationEventRow) {
  return v.parse(orchestrationEventSchema, {
    actorKind: row.actorKind,
    aggregateId: row.aggregateId,
    aggregateKind: row.aggregateKind,
    causationEventId: row.causationEventId,
    commandId: row.commandId,
    correlationId: row.correlationId,
    eventId: row.eventId,
    metadata: parseEventJson(row, 'metadataJson'),
    occurredAt: row.occurredAt,
    payload: parseEventJson(row, 'payloadJson'),
    sequence: row.sequence,
    type: row.eventType,
  })
}

function parseEventJson(row: OrchestrationEventRow, field: 'metadataJson' | 'payloadJson') {
  try {
    return JSON.parse(row[field]) as unknown
  } catch (cause) {
    throw orchestrationErrors.EVENT_JSON_INVALID({
      cause: cause instanceof Error ? cause : undefined,
      field,
      internal: { field, sequence: row.sequence },
      sequence: row.sequence,
    })
  }
}
