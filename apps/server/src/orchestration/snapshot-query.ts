import { terminalLeaseSchema } from '@workspace/contracts'
import { worktreesAffectedByEvent, referencingSessionIds } from './worktree-projection'
import { and, asc, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import * as v from 'valibot'
import {
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  orchestrationSessionDetailPageInputSchema,
  orchestrationSessionDetailPageSchema,
  type OrchestrationCheckpointFile,
  type OrchestrationSessionDetailAnchor,
  type OrchestrationSessionDetailPage,
  type OrchestrationSessionDetailPageInput,
} from '@workspace/contracts'
import { orchestrationErrors } from '../observability'
import {
  orchestrationShellSnapshotSchema,
  orchestrationSessionDetailSnapshotSchema,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationSessionDetailSnapshot,
} from '@workspace/contracts'
import { getDefaultPlatformDatabase } from '../db/client'
import {
  projectionProjects,
  projectionWorktrees,
  projectionTerminalLeases,
  projectionState,
  projectionSessionActivities,
  projectionSessionCheckpoints,
  projectionSessionMessages,
  projectionSessionProposedPlans,
  projectionSessionRuntime,
  projectionSessions,
  type ProjectionSessionCheckpointRow,
  type ProjectionSessionProposedPlanRow,
} from '../db/schema'
import type { OrchestrationDatabase } from './event-store'
import {
  appendBounded,
  boundCheckpoints,
  createEmptyReadModel,
  MAX_SESSION_ACTIVITIES,
  MAX_SESSION_MESSAGES,
  type OrchestrationProjectedCheckpoint,
  type OrchestrationProjectedSession,
  type OrchestrationReadModel,
} from './read-model'
import { ORCHESTRATION_PROJECTOR_NAME } from './projection-pipeline'
import {
  projectFromRow,
  projectShellFromRow,
  worktreeFromRow,
  worktreeShellFromRow,
  sessionFromRow,
  sessionShellFromRow,
  messageFromRow,
  activityFromRow,
} from './utils/projection-rows'

export class OrchestrationSnapshotQuery {
  private readonly database: OrchestrationDatabase

  constructor(database: OrchestrationDatabase = getDefaultPlatformDatabase()) {
    this.database = database
  }

  /**
   * Hydrates the engine's in-memory model, so it takes only the tail of each
   * session: the decider and the provider reactor ask about the live turn, and
   * loading every message of every session at boot is how a server runs out of
   * memory. Full history stays one `sessionDetailSnapshot` away.
   */
  fullReadModel(sequence = this.currentSequence()): OrchestrationReadModel {
    const model = createEmptyReadModel(sequence)

    for (const row of this.database.select().from(projectionTerminalLeases).all())
      model.terminalLeases.set(row.terminalLeaseId, v.parse(terminalLeaseSchema, row))
    for (const row of this.database.select().from(projectionProjects).all()) {
      model.projects.set(row.projectId, projectFromRow(row))
    }
    for (const row of this.database.select().from(projectionWorktrees).all()) {
      model.worktrees.set(row.worktreeId, {
        ...worktreeFromRow(row),
        retirementSequence: row.retirementSequence,
      })
    }
    for (const row of this.database.select().from(projectionSessions).all()) {
      const session = sessionFromRow(
        row,
        this.recentSessionMessages(row.sessionId),
        this.recentSessionActivities(row.sessionId),
        this.sessionRuntime(row.sessionId),
      )
      model.sessions.set(row.sessionId, {
        ...session,
        latestFailureSequence: row.latestFailureSequence,
        latestInterruptionSequence: row.latestInterruptionSequence,
        runtimeSequence: row.runtimeSequence,
        checkpointByTurnId: boundCheckpoints(this.sessionCheckpointIndex(row.sessionId)),
        hasActionableProposedPlan: row.hasActionableProposedPlan,
        latestUserMessageAt: row.latestUserMessageAt,
        pendingApprovalCount: row.pendingApprovalCount,
        pendingUserInputCount: row.pendingUserInputCount,
      })
    }

    return model
  }

  /**
   * Refreshes the engine's in-memory model from the rows the committed batch
   * just wrote. This folds nothing: `projection-pipeline.ts` has already applied
   * `events` inside the command transaction, so the model is a *cache* of that
   * projection and every projection rule lives in exactly one place.
   *
   * Cost is the batch, never the session. A session's scalars and session are two
   * point reads; a message or activity event re-reads only the single row it
   * wrote and splices it into the array the model already holds.
   * `tests/read-model-bounds.test.ts` pins that as object identity — a refresh
   * that rebuilt the retained rows would fail it and would put dispatch cost
   * back on a curve with session length, which is the regression that killed the
   * old per-event clone.
   */
  refreshReadModel(model: OrchestrationReadModel, events: OrchestrationEvent[]) {
    for (const projectId of touchedProjectIds(events)) {
      this.refreshProject(model, projectId)
    }
    const worktreeIds = new Set(
      events.flatMap((event) => worktreesAffectedByEvent(this.database, event)),
    )
    for (const worktreeId of worktreeIds) {
      const row = this.database
        .select()
        .from(projectionWorktrees)
        .where(eq(projectionWorktrees.worktreeId, worktreeId))
        .get()
      if (row)
        model.worktrees.set(row.worktreeId, {
          ...worktreeFromRow(row),
          retirementSequence: row.retirementSequence,
        })
    }
    for (const event of events) {
      if (event.type !== 'terminal.lease-updated') continue
      model.terminalLeases.set(event.payload.terminalLeaseId, event.payload)
    }
    // Scalars first: a `session.created` in this batch has to land in the map
    // before the message that shares the batch can splice into it. Order is
    // otherwise irrelevant — every row the batch wrote is already final.
    const sessionIds = new Set<string>(touchedSessionIds(events))
    for (const event of events) {
      if (event.aggregateKind !== 'worktree') continue
      for (const id of referencingSessionIds(this.database, event.aggregateId)) sessionIds.add(id)
    }
    for (const sessionId of sessionIds) {
      this.hydrateSession(model, sessionId, model.sessions.get(sessionId))
    }
    for (const event of events) {
      model.sequence = Math.max(model.sequence, event.sequence)
      this.refreshSessionStreams(model, event)
    }

    return model
  }

  shellSnapshot(): OrchestrationShellSnapshot {
    const projects = this.database
      .select()
      .from(projectionProjects)
      .where(isNull(projectionProjects.deletedAt))
      .orderBy(asc(projectionProjects.updatedAt))
      .all()
      .map(projectShellFromRow)
    const worktrees = this.database
      .select({ worktree: projectionWorktrees })
      .from(projectionWorktrees)
      .innerJoin(
        projectionProjects,
        eq(projectionProjects.projectId, projectionWorktrees.projectId),
      )
      .where(
        and(
          isNull(projectionProjects.deletedAt),
          or(
            isNull(projectionWorktrees.retiredAt),
            eq(projectionWorktrees.lifecycleState, 'removed'),
          ),
        ),
      )
      .orderBy(asc(projectionWorktrees.createdAt))
      .all()
      .map(({ worktree }) => worktreeShellFromRow(worktree))
    const sessions = this.database
      .select()
      .from(projectionSessions)
      .where(isNull(projectionSessions.deletedAt))
      .orderBy(asc(projectionSessions.createdAt))
      .all()
      .map((session) => sessionShellFromRow(session, this.sessionRuntime(session.sessionId)))

    return v.parse(orchestrationShellSnapshotSchema, {
      projects,
      worktrees,
      snapshotSequence: this.currentSequence(),
      sessions,
      updatedAt: latestShellSnapshotUpdatedAt([...projects, ...worktrees], sessions),
    })
  }

  /**
   * The newest window of the session, never the whole session: opening a 5,000
   * message session has to cost the same as opening a 5 message one. Older rows
   * are reached with `sessionDetailPage`, walking backwards from the oldest row
   * the caller holds — nothing here is trimmed out of reach.
   */
  sessionDetailSnapshot(sessionId: string): OrchestrationSessionDetailSnapshot {
    const row = this.database
      .select()
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, sessionId))
      .get()
    if (!row) throw orchestrationErrors.SESSION_NOT_FOUND({ sessionId })

    return v.parse(orchestrationSessionDetailSnapshotSchema, {
      checkpoints: this.sessionCheckpointRows(sessionId).map(checkpointFromRow),
      proposedPlans: this.sessionProposedPlans(sessionId).map(proposedPlanFromRow),
      snapshotSequence: this.currentSequence(),
      session: sessionFromRow(
        row,
        this.messagesBefore(sessionId, null, ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE).rows,
        this.activitiesBefore(sessionId, null, ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE).rows,
        this.sessionRuntime(sessionId),
      ),
    })
  }

  /**
   * One page of strictly older rows. Messages and activities are two streams
   * with their own boundaries, so each walks back independently and the page is
   * exhausted only once both have reached the start of the session.
   */
  sessionDetailPage(input: OrchestrationSessionDetailPageInput): OrchestrationSessionDetailPage {
    const query = v.parse(orchestrationSessionDetailPageInputSchema, input)
    const exists = this.database
      .select({ sessionId: projectionSessions.sessionId })
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, query.sessionId))
      .get()
    if (!exists) throw orchestrationErrors.SESSION_NOT_FOUND({ sessionId: query.sessionId })

    const messages = this.messagesBefore(query.sessionId, query.beforeMessage, query.limit)
    const activities = this.activitiesBefore(query.sessionId, query.beforeActivity, query.limit)

    return v.parse(orchestrationSessionDetailPageSchema, {
      activities: activities.rows.map(activityFromRow),
      hasEarlier: messages.hasEarlier || activities.hasEarlier,
      messages: messages.rows.map(messageFromRow),
      snapshotSequence: this.currentSequence(),
      sessionId: query.sessionId,
    })
  }

  private messagesBefore(
    sessionId: string,
    before: OrchestrationSessionDetailAnchor | null,
    limit: number,
  ) {
    const rows = this.database
      .select()
      .from(projectionSessionMessages)
      .where(
        and(
          eq(projectionSessionMessages.sessionId, sessionId),
          olderThan(
            projectionSessionMessages.createdAt,
            projectionSessionMessages.messageId,
            before,
          ),
        ),
      )
      .orderBy(desc(projectionSessionMessages.createdAt), desc(projectionSessionMessages.messageId))
      .limit(limit + 1)
      .all()

    return takeBackwardsPage(rows, limit)
  }

  private activitiesBefore(
    sessionId: string,
    before: OrchestrationSessionDetailAnchor | null,
    limit: number,
  ) {
    const rows = this.database
      .select()
      .from(projectionSessionActivities)
      .where(
        and(
          eq(projectionSessionActivities.sessionId, sessionId),
          olderThan(
            projectionSessionActivities.createdAt,
            projectionSessionActivities.activityId,
            before,
          ),
        ),
      )
      .orderBy(
        desc(projectionSessionActivities.createdAt),
        desc(projectionSessionActivities.activityId),
      )
      .limit(limit + 1)
      .all()

    return takeBackwardsPage(rows, limit)
  }

  private recentSessionMessages(sessionId: string) {
    return this.messagesBefore(sessionId, null, MAX_SESSION_MESSAGES).rows
  }

  private recentSessionActivities(sessionId: string) {
    return this.activitiesBefore(sessionId, null, MAX_SESSION_ACTIVITIES).rows
  }

  private sessionRuntime(sessionId: string) {
    return this.database
      .select()
      .from(projectionSessionRuntime)
      .where(eq(projectionSessionRuntime.sessionId, sessionId))
      .get()
  }

  private sessionCheckpointRows(sessionId: string) {
    return this.database
      .select()
      .from(projectionSessionCheckpoints)
      .where(eq(projectionSessionCheckpoints.sessionId, sessionId))
      .orderBy(asc(projectionSessionCheckpoints.checkpointTurnCount))
      .all()
  }

  private sessionProposedPlans(sessionId: string) {
    return this.database
      .select()
      .from(projectionSessionProposedPlans)
      .where(eq(projectionSessionProposedPlans.sessionId, sessionId))
      .orderBy(
        asc(projectionSessionProposedPlans.createdAt),
        asc(projectionSessionProposedPlans.planId),
      )
      .all()
  }

  private sessionCheckpointIndex(sessionId: string) {
    const entries = this.sessionCheckpointRows(sessionId).map(
      (row) => [row.turnId, projectedCheckpointFromRow(row)] as const,
    )

    return Object.fromEntries(entries) as Record<string, OrchestrationProjectedCheckpoint>
  }

  private refreshProject(model: OrchestrationReadModel, projectId: string) {
    const row = this.database
      .select()
      .from(projectionProjects)
      .where(eq(projectionProjects.projectId, projectId))
      .get()
    if (!row) return

    model.projects.set(projectId, projectFromRow(row))
  }

  /**
   * `held` is the session the model already carries, or undefined to re-read its
   * streams from SQL as well. Passing it is what keeps a refresh O(1) in session
   * length: the retained messages, activities and checkpoints are rows this
   * model already read and nothing in this batch invalidated wholesale.
   */
  private hydrateSession(
    model: OrchestrationReadModel,
    sessionId: string,
    held: OrchestrationProjectedSession | undefined,
  ) {
    const row = this.database
      .select()
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, sessionId))
      .get()
    if (!row) return

    const session = sessionFromRow(row, [], [], this.sessionRuntime(sessionId))
    model.sessions.set(sessionId, {
      ...session,
      latestFailureSequence: row.latestFailureSequence,
      latestInterruptionSequence: row.latestInterruptionSequence,
      runtimeSequence: row.runtimeSequence,
      activities: held?.activities ?? this.recentSessionActivities(sessionId).map(activityFromRow),
      checkpointByTurnId:
        held?.checkpointByTurnId ?? boundCheckpoints(this.sessionCheckpointIndex(sessionId)),
      hasActionableProposedPlan: row.hasActionableProposedPlan,
      latestUserMessageAt: row.latestUserMessageAt,
      messages: held?.messages ?? this.recentSessionMessages(sessionId).map(messageFromRow),
      pendingApprovalCount: row.pendingApprovalCount,
      pendingUserInputCount: row.pendingUserInputCount,
    })
  }

  private refreshSessionStreams(model: OrchestrationReadModel, event: OrchestrationEvent) {
    if (event.type === 'session.message-sent') {
      this.refreshMessage(model, event.payload.sessionId, event.payload.messageId)
      return
    }
    if (event.type === 'session.activity-appended') {
      this.refreshActivity(model, event.payload.sessionId, event.payload.activity.id)
      return
    }
    if (event.type === 'session.turn-diff-completed') {
      this.refreshCheckpoint(model, event.payload.sessionId, event.payload.turnId)
      return
    }
    // A revert prunes messages, activities, turns, checkpoints and plans at
    // once, so the held streams are the one thing a point read cannot repair.
    if (event.type !== 'session.reverted' && event.type !== 'session.history-imported') return

    this.hydrateSession(model, event.payload.sessionId, undefined)
  }

  private refreshMessage(model: OrchestrationReadModel, sessionId: string, messageId: string) {
    const session = model.sessions.get(sessionId)
    if (!session) return

    const row = this.database
      .select()
      .from(projectionSessionMessages)
      .where(eq(projectionSessionMessages.messageId, messageId))
      .get()
    if (!row) return

    upsertById(session.messages, messageFromRow(row), MAX_SESSION_MESSAGES)
  }

  private refreshActivity(model: OrchestrationReadModel, sessionId: string, activityId: string) {
    const session = model.sessions.get(sessionId)
    if (!session) return

    const row = this.database
      .select()
      .from(projectionSessionActivities)
      .where(eq(projectionSessionActivities.activityId, activityId))
      .get()
    if (!row) return

    upsertById(session.activities, activityFromRow(row), MAX_SESSION_ACTIVITIES)
  }

  /**
   * The row, not the event: a mid-turn placeholder that arrives after a real
   * capture is refused by the projection's upsert, so re-reading the row is how
   * that rule reaches the cache without being written down a second time.
   */
  private refreshCheckpoint(model: OrchestrationReadModel, sessionId: string, turnId: string) {
    const session = model.sessions.get(sessionId)
    if (!session) return

    const row = this.database
      .select()
      .from(projectionSessionCheckpoints)
      .where(
        and(
          eq(projectionSessionCheckpoints.sessionId, sessionId),
          eq(projectionSessionCheckpoints.turnId, turnId),
        ),
      )
      .get()
    if (!row) return

    model.sessions.set(sessionId, {
      ...session,
      checkpointByTurnId: boundCheckpoints({
        ...session.checkpointByTurnId,
        [turnId]: projectedCheckpointFromRow(row),
      }),
    })
  }

  private currentSequence() {
    return (
      this.database
        .select({ sequence: projectionState.lastAppliedSequence })
        .from(projectionState)
        .where(eq(projectionState.projector, ORCHESTRATION_PROJECTOR_NAME))
        .get()?.sequence ?? 0
    )
  }
}

/**
 * Strictly-older predicate under `(createdAt, id)` ordering. A `null` boundary
 * is "hold nothing yet", which reads the newest rows — the same slice the
 * detail snapshot's window carries.
 */
function olderThan(
  createdAtColumn: SQLiteColumn,
  idColumn: SQLiteColumn,
  before: OrchestrationSessionDetailAnchor | null,
): SQL | undefined {
  if (!before) return undefined

  return or(
    lt(createdAtColumn, before.createdAt),
    and(eq(createdAtColumn, before.createdAt), lt(idColumn, before.id)),
  )
}

/**
 * Rows arrive newest-first and one past the limit: reading the extra row is how
 * `hasEarlier` stays exact without a second count query. The page is returned
 * oldest-first so callers prepend it as-is.
 */
function takeBackwardsPage<Row>(rows: Row[], limit: number) {
  return {
    hasEarlier: rows.length > limit,
    rows: rows.slice(0, limit).toReversed(),
  }
}

type ShellSnapshotTimestampSource = {
  runtime?: { updatedAt: string } | null
  updatedAt: string
}

function latestShellSnapshotUpdatedAt(
  projects: ShellSnapshotTimestampSource[],
  sessions: ShellSnapshotTimestampSource[],
) {
  let updatedAt = new Date(0).toISOString()

  for (const project of projects) {
    updatedAt = latestTimestamp(updatedAt, project.updatedAt)
  }
  for (const session of sessions) {
    updatedAt = latestTimestamp(updatedAt, session.updatedAt)
    updatedAt = latestTimestamp(updatedAt, session.runtime?.updatedAt)
  }

  return updatedAt
}

function latestTimestamp(current: string, candidate: string | null | undefined) {
  if (!candidate) return current
  if (candidate <= current) return current

  return candidate
}

function checkpointFromRow(row: ProjectionSessionCheckpointRow) {
  return {
    assistantMessageId: row.assistantMessageId,
    checkpointRef: row.checkpointRef,
    checkpointTurnCount: row.checkpointTurnCount,
    completedAt: row.completedAt,
    files: parseJson<OrchestrationCheckpointFile[]>(row.filesJson, []),
    status: row.status,
    turnId: row.turnId,
  }
}

/** The in-memory model answers "what can be reverted", so it drops the files. */
function projectedCheckpointFromRow(row: ProjectionSessionCheckpointRow) {
  return {
    assistantMessageId: row.assistantMessageId,
    checkpointRef: row.checkpointRef,
    checkpointTurnCount: row.checkpointTurnCount,
    completedAt: row.completedAt,
    status: row.status,
    turnId: row.turnId,
  } as OrchestrationProjectedCheckpoint
}

function proposedPlanFromRow(row: ProjectionSessionProposedPlanRow) {
  return {
    createdAt: row.createdAt,
    id: row.planId,
    implementationSessionId: row.implementationSessionId,
    implementedAt: row.implementedAt,
    planMarkdown: row.planMarkdown,
    sessionId: row.sessionId,
    turnId: row.turnId,
    updatedAt: row.updatedAt,
  }
}

function parseJson<T>(value: string | null, fallback?: T) {
  if (value === null || value === undefined) return fallback as T

  return JSON.parse(value) as T
}

function touchedProjectIds(events: OrchestrationEvent[]) {
  const ids = new Set<string>()

  for (const event of events) {
    if (event.aggregateKind !== 'project') continue

    ids.add(event.aggregateId)
  }

  return ids
}

function touchedSessionIds(events: readonly OrchestrationEvent[]) {
  return new Set(
    events.filter((event) => event.aggregateKind === 'session').map((event) => event.aggregateId),
  )
}

/** Corrects the entry the row already has, else appends it within the cap. */
function upsertById<Row extends { id: string }>(rows: Row[], row: Row, max: number) {
  const index = rows.findLastIndex((held) => held.id === row.id)
  if (index < 0) {
    appendBounded(rows, row, max)
    return
  }

  rows[index] = row
}
