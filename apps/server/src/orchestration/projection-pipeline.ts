import {
  applyWorktreeEvent,
  lifecycleFields,
  preserveDiscoveredOwnership,
  refreshWorktreePolicy,
  referencingSessionIds,
  worktreesAffectedByEvent,
} from './worktree-projection'
import { or, and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import * as v from 'valibot'
import {
  ORCHESTRATION_REPLAY_MAX_EVENTS,
  orchestrationLatestTurnSchema,
  type SessionDeletionState,
  type SessionRuntimeStatus,
} from '@workspace/contracts'
import type { OrchestrationEvent } from '@workspace/contracts'
import { getDefaultPlatformDatabase } from '../db/client'
import {
  projectionProjects,
  projectionWorktrees,
  projectionState,
  projectionSessionActivities,
  projectionSessionCheckpoints,
  projectionSessionMessages,
  projectionSessionProposedPlans,
  projectionSessionRuntime,
  projectionSessions,
  projectionTurns,
} from '../db/schema'
import type { OrchestrationDatabase } from './event-store'
import { OrchestrationEventStore } from './event-store'
import {
  orchestrationEventBatchSummary,
  orchestrationEventSummary,
  recordChatPipelineInfo,
} from './orchestration-logging'
import {
  isPlanProgressActivityKind,
  mergedMessageText,
  PLAN_PROGRESS_ACTIVITY_KIND,
  settledTurnStateForSessionStatus,
  sessionPlanProgress,
  type SessionPlanProgress,
} from './read-model'
import {
  isPendingRequestActivityKind,
  PENDING_REQUEST_ACTIVITY_KINDS,
  pendingRequestCounts,
} from './pending-requests'

import { sessionAttention } from './utils/session-attention'

export const ORCHESTRATION_PROJECTOR_NAME = 'orchestration'

export class OrchestrationProjectionPipeline {
  private readonly database: OrchestrationDatabase
  private readonly eventStore: OrchestrationEventStore

  constructor(
    database: OrchestrationDatabase = getDefaultPlatformDatabase(),
    eventStore = new OrchestrationEventStore(database),
  ) {
    this.database = database
    this.eventStore = eventStore
  }

  catchUp() {
    const afterSequence = this.lastAppliedSequence()
    let sequence = afterSequence
    let eventCount = 0
    let pageCount = 0
    while (true) {
      const events = this.eventStore.readAfter({ afterSequence: sequence })
      this.applyEvents(events)
      sequence = events.at(-1)?.sequence ?? sequence
      eventCount += events.length
      pageCount += 1
      if (events.length < ORCHESTRATION_REPLAY_MAX_EVENTS) break
    }
    recordChatPipelineInfo('chat.pipeline.projection.catch_up.complete', {
      afterSequence,
      eventCount,
      pageCount,
      sequence,
    })
    return { afterSequence, eventCount, pageCount, sequence }
  }

  applyEvents(events: OrchestrationEvent[]) {
    recordChatPipelineInfo('chat.pipeline.projection.apply_events.start', {
      ...orchestrationEventBatchSummary(events),
    })
    for (const event of events) {
      recordChatPipelineInfo('chat.pipeline.projection.apply_event', {
        ...orchestrationEventSummary(event),
      })
      this.applyEventAtomically(event)
    }
    recordChatPipelineInfo('chat.pipeline.projection.apply_events.complete', {
      ...orchestrationEventBatchSummary(events),
    })
  }

  lastAppliedSequence() {
    return (
      this.database
        .select()
        .from(projectionState)
        .where(eq(projectionState.projector, ORCHESTRATION_PROJECTOR_NAME))
        .get()?.lastAppliedSequence ?? 0
    )
  }

  /**
   * The cursor advance rides in the same transaction as the projection write.
   * Split, a crash in between replays an already-applied event on the next
   * start, and a streaming assistant frame appends its text a second time.
   * Nested under the engine's command transaction this is a savepoint.
   */
  private applyEventAtomically(event: OrchestrationEvent) {
    this.database.transaction(() => {
      if (event.sequence <= this.lastAppliedSequence()) return
      this.applyEvent(event)
      preserveDiscoveredOwnership(this.database, event)
      for (const id of worktreesAffectedByEvent(this.database, event))
        refreshWorktreePolicy(this.database, id)
      this.refreshAttentionForEvent(event)
      this.markApplied(event.sequence)
    })
  }

  private applyEvent(event: OrchestrationEvent) {
    if (applyWorktreeEvent(this.database, event)) return
    switch (event.type) {
      case 'project.created':
      case 'project.revived':
        this.upsertProject(event)
        return
      case 'project.meta-updated':
        this.updateProject(event.payload.projectId, {
          defaultModelSelectionJson: jsonPatch(event.payload.defaultModelSelection),
          // `jsonOrUndefined`, not `jsonPatch`: an empty list is a real value
          // the user chose, and it has to survive as `[]` rather than becoming
          // the null that means "never set".
          scriptsJson: jsonOrUndefined(event.payload.scripts),
          title: event.payload.title,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'project.reordered':
        this.updateProject(event.payload.projectId, { orderKey: event.payload.orderKey })
        return
      case 'project.deleted':
        this.updateProject(event.payload.projectId, {
          deletedAt: event.payload.deletedAt,
          updatedAt: event.payload.deletedAt,
        })
        return
      case 'worktree.registered':
      case 'worktree.revived':
        this.upsertWorktree(event)
        return
      case 'worktree.retired':
        this.database
          .update(projectionWorktrees)
          .set({
            ...lifecycleFields({ state: 'retired', retiredAt: event.payload.retiredAt }),
            retiredAt: event.payload.retiredAt,
            retirementSequence: event.sequence,
            updatedAt: event.payload.retiredAt,
          })
          .where(eq(projectionWorktrees.worktreeId, event.payload.worktreeId))
          .run()
        return
      case 'worktree.meta-updated':
        this.database
          .update(projectionWorktrees)
          .set({ branch: event.payload.branch, updatedAt: event.payload.updatedAt })
          .where(eq(projectionWorktrees.worktreeId, event.payload.worktreeId))
          .run()
        return
      case 'session.provider-start-claimed':
      case 'session.provider-start-adopted':
      case 'session.provider-start-settled':
        this.updateProviderStart(event)
        return
      case 'session.runtime-recovered':
        this.recoverRuntime(event)
        return
      case 'session.deletion-updated':
        this.updateDeletion(event.payload.sessionId, event.payload.deletion)
        return
      case 'session.discovery-metadata-updated':
        this.updateSession(event.payload.sessionId, {
          title: event.payload.title,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.history-imported':
        this.replaceImportedHistory(event)
        return
      case 'session.worktree-released':
        this.releaseWorktreeTurn(event)
        return
      case 'session.worktree-blocked':
        this.blockWorktreeTurn(event)
        return
      case 'session.created':
        this.upsertSession(event)
        return
      case 'session.meta-updated':
        this.updateSession(event.payload.sessionId, {
          modelSelectionJson: jsonOrUndefined(event.payload.modelSelection),
          title: event.payload.title,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.message-sent':
        this.upsertMessage(event)
        return
      case 'session.turn-start-requested':
        this.upsertTurn(event)
        return
      case 'session.runtime-set':
        this.upsertRuntime(event)
        this.settleRunningTurns(
          event.payload.sessionId,
          event.payload.runtime.status,
          event.payload.runtime.updatedAt,
        )
        return
      case 'session.activity-appended':
        this.upsertActivity(event)
        this.updateTurnForActivity(event)
        this.refreshPendingRequestCountsForActivity(event)
        this.refreshPlanProgressForActivity(event)
        return
      case 'session.deleted':
        this.updateDeletion(event.payload.sessionId, {
          deletionSequence: event.sequence,
          providerStop: 'requested',
          blobCleanup: 'requested',
          providerStopError: null,
          blobCleanupError: null,
          updatedAt: event.payload.deletedAt,
        })
        this.updateSession(event.payload.sessionId, {
          deletedAt: event.payload.deletedAt,
          updatedAt: event.payload.deletedAt,
        })
        return
      case 'session.archived':
        this.updateSession(event.payload.sessionId, {
          archivedAt: event.payload.archivedAt,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.unarchived':
        this.updateSession(event.payload.sessionId, {
          archivedAt: null,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.settled':
        this.updateSession(event.payload.sessionId, {
          settledAt: event.payload.settledAt,
          settledOverride: 'settled',
          acknowledgedFailureThroughSequence: event.payload.acknowledgedFailureThroughSequence,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.unsettled':
        // "user" is an explicit keep-active override; "activity" resets to
        // neutral so the session can settle on its own again.
        this.updateSession(event.payload.sessionId, {
          settledAt: null,
          settledOverride: event.payload.reason === 'user' ? 'active' : null,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.snoozed':
        this.updateSession(event.payload.sessionId, {
          snoozedAt: event.payload.snoozedAt,
          snoozedUntil: event.payload.snoozedUntil,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.unsnoozed':
        this.updateSession(event.payload.sessionId, {
          snoozedAt: null,
          snoozedUntil: null,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.pinned':
        // An absent key is "keep what is there": a re-pin must not overwrite the
        // slot the user already dragged this session into.
        this.updateSession(event.payload.sessionId, {
          pinOrderKey: event.payload.pinOrderKey,
          pinnedAt: event.payload.pinnedAt,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.unpinned':
        this.updateSession(event.payload.sessionId, {
          pinOrderKey: null,
          pinnedAt: null,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.pin-reordered':
        this.updateSession(event.payload.sessionId, {
          pinOrderKey: event.payload.orderKey,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.runtime-mode-set':
        this.updateSession(event.payload.sessionId, {
          runtimeMode: event.payload.runtimeMode,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.interaction-mode-set':
        this.updateSession(event.payload.sessionId, {
          interactionMode: event.payload.interactionMode,
          updatedAt: event.payload.updatedAt,
        })
        return
      case 'session.turn-interrupt-requested':
        this.completeTurn(
          event.payload.sessionId,
          event.payload.turnId,
          'interrupted',
          event.payload.createdAt,
        )
        return
      case 'session.turn-diff-completed':
        this.upsertCheckpoint(event)
        return
      case 'session.runtime-stop-requested':
        this.updateSessionStatus(event.payload.sessionId, 'stopped', event.payload.createdAt)
        this.settleRunningTurns(event.payload.sessionId, 'stopped', event.payload.createdAt)
        return
      case 'session.proposed-plan-implemented':
        this.markProposedPlanImplemented(event)
        return
      case 'session.proposed-plan-upserted':
        this.upsertProposedPlan(event)
        return
      case 'session.checkpoint-revert-requested':
        return
      case 'session.reverted':
        this.pruneSessionAfterRevert(event)
        return
      case 'session.approval-response-requested':
      case 'session.user-input-response-requested':
        return
    }
  }

  private upsertWorktree(
    event: Extract<OrchestrationEvent, { type: 'worktree.registered' | 'worktree.revived' }>,
  ) {
    const row = {
      ...event.payload,
      ...lifecycleFields({ state: 'ready' }),
      operationId: null,
      retiredAt: null,
      removedAt: null,
      retirementSequence: null,
    }
    this.database
      .insert(projectionWorktrees)
      .values(row)
      .onConflictDoUpdate({ target: projectionWorktrees.worktreeId, set: row })
      .run()
  }

  private blockWorktreeTurn(
    event: Extract<OrchestrationEvent, { type: 'session.worktree-blocked' }>,
  ) {
    const { sessionId, turnId, updatedAt } = event.payload
    this.updateSession(sessionId, { updatedAt })
    if (!turnId) return
    this.database
      .update(projectionTurns)
      .set({ providerStartState: 'blocked-on-worktree', providerStartSequence: event.sequence })
      .where(
        and(
          eq(projectionTurns.sessionId, sessionId),
          eq(projectionTurns.turnId, turnId),
          eq(projectionTurns.providerStartState, 'queued'),
        ),
      )
      .run()
    this.refreshLatestTurn(sessionId, updatedAt)
  }

  private releaseWorktreeTurn(
    event: Extract<OrchestrationEvent, { type: 'session.worktree-released' }>,
  ) {
    this.database
      .update(projectionTurns)
      .set({ providerStartState: 'queued', providerStartSequence: event.sequence })
      .where(
        and(
          eq(projectionTurns.sessionId, event.payload.sessionId),
          eq(projectionTurns.turnId, event.payload.turnId),
          eq(projectionTurns.providerStartState, 'blocked-on-worktree'),
        ),
      )
      .run()
    this.refreshLatestTurn(event.payload.sessionId, event.payload.updatedAt)
  }

  private updateProviderStart(
    event: Extract<
      OrchestrationEvent,
      {
        type:
          | 'session.provider-start-claimed'
          | 'session.provider-start-adopted'
          | 'session.provider-start-settled'
      }
    >,
  ) {
    const providerStartState = PROVIDER_START_STATE[event.type]
    this.database
      .update(projectionTurns)
      .set({
        providerStartState,
        providerStartGeneration: event.payload.generation,
        providerStartSequence: event.sequence,
        runtimeEpoch: event.payload.runtimeEpoch,
      })
      .where(
        and(
          eq(projectionTurns.sessionId, event.payload.sessionId),
          eq(projectionTurns.turnId, event.payload.turnId),
        ),
      )
      .run()
    this.refreshLatestTurn(event.payload.sessionId, event.payload.createdAt)
  }

  private recoverRuntime(
    event: Extract<OrchestrationEvent, { type: 'session.runtime-recovered' }>,
  ) {
    this.database
      .update(projectionSessionRuntime)
      .set({
        status: 'interrupted',
        activeTurnId: null,
        lastError: event.payload.message,
        updatedAt: event.payload.createdAt,
      })
      .where(eq(projectionSessionRuntime.sessionId, event.payload.sessionId))
      .run()
    this.database
      .update(projectionTurns)
      .set({
        state: 'interrupted',
        providerStartState: 'interrupted',
        providerStartSequence: event.sequence,
        completedAt: event.payload.createdAt,
      })
      .where(
        and(
          eq(projectionTurns.sessionId, event.payload.sessionId),
          inArray(projectionTurns.providerStartState, ['claimed', 'adopted']),
          event.payload.turnId ? eq(projectionTurns.turnId, event.payload.turnId) : undefined,
        ),
      )
      .run()
    this.refreshLatestTurn(event.payload.sessionId, event.payload.createdAt)
    this.updateSession(event.payload.sessionId, {
      latestInterruptionSequence: event.sequence,
      runtimeSequence: event.sequence,
    })
  }

  private updateDeletion(sessionId: string, deletion: SessionDeletionState) {
    this.updateSession(sessionId, {
      deletionSequence: deletion.deletionSequence,
      providerStopState: deletion.providerStop,
      blobCleanupState: deletion.blobCleanup,
      providerStopError: deletion.providerStopError,
      blobCleanupError: deletion.blobCleanupError,
      deletionUpdatedAt: deletion.updatedAt,
    })
  }

  private refreshAttentionForEvent(event: OrchestrationEvent) {
    if (event.aggregateKind === 'worktree') {
      for (const sessionId of referencingSessionIds(this.database, event.aggregateId))
        this.refreshAttention(sessionId)
      return
    }
    if (event.aggregateKind !== 'session') return
    const failure = failureKind(event)
    if (failure === 'failure')
      this.updateSession(event.aggregateId, { latestFailureSequence: event.sequence })
    if (failure === 'interruption')
      this.updateSession(event.aggregateId, { latestInterruptionSequence: event.sequence })
    this.refreshAttention(event.aggregateId)
  }

  private refreshAttention(sessionId: string) {
    const row = this.database
      .select()
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, sessionId))
      .get()
    if (!row) return
    const runtime =
      this.database
        .select()
        .from(projectionSessionRuntime)
        .where(eq(projectionSessionRuntime.sessionId, sessionId))
        .get() ?? null
    const latestTurn = row.latestTurnJson
      ? v.parse(orchestrationLatestTurnSchema, JSON.parse(row.latestTurnJson))
      : null
    const worktree = this.database
      .select({ lifecycleState: projectionWorktrees.lifecycleState })
      .from(projectionWorktrees)
      .where(eq(projectionWorktrees.worktreeId, row.worktreeId))
      .get()
    const attention = sessionAttention({
      ...row,
      latestTurn,
      runtime,
      worktreeState: worktree?.lifecycleState,
    })
    this.updateSession(sessionId, attention)
  }

  private upsertProject(
    event: Extract<OrchestrationEvent, { type: 'project.created' | 'project.revived' }>,
  ) {
    this.database
      .insert(projectionProjects)
      .values({
        createdAt: event.payload.createdAt,
        defaultModelSelectionJson: jsonOrNull(event.payload.defaultModelSelection),
        deletedAt: null,
        // Only on insert: a replayed `project.created` must not wipe the slot
        // the user dragged this project into.
        orderKey: null,
        projectId: event.payload.projectId,
        // Only on insert, for the same reason as `orderKey`: a replayed
        // `project.created` must not wipe scripts added since.
        scriptsJson: null,
        title: event.payload.title,
        updatedAt: event.payload.updatedAt,
        repositoryKey: event.payload.repositoryKey,
        repositoryKind: event.payload.repositoryKind,
        repositoryIdentityJson: JSON.stringify(event.payload.repositoryIdentity),
      })
      .onConflictDoUpdate({
        target: projectionProjects.projectId,
        set: {
          defaultModelSelectionJson: jsonOrNull(event.payload.defaultModelSelection),
          deletedAt: null,
          title: event.payload.title,
          updatedAt: event.payload.updatedAt,
        },
      })
      .run()
  }

  private upsertSession(event: Extract<OrchestrationEvent, { type: 'session.created' }>) {
    this.database
      .insert(projectionSessions)
      .values({
        archivedAt: null,
        createdAt: event.payload.createdAt,
        deletedAt: null,
        hasActionableProposedPlan: false,
        interactionMode: event.payload.interactionMode,
        latestTurnId: null,
        latestTurnJson: null,
        latestUserMessageAt: null,
        modelSelectionJson: JSON.stringify(event.payload.modelSelection),
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        pinOrderKey: null,
        planProgressJson: null,
        pinnedAt: null,
        worktreeId: event.payload.worktreeId,
        origin: event.payload.origin,
        attentionState: 'settled',
        attentionReason: null,
        hasError: false,
        runtimeMode: event.payload.runtimeMode,
        settledAt: null,
        settledOverride: null,
        snoozedAt: null,
        snoozedUntil: null,
        sessionId: event.payload.sessionId,
        title: event.payload.title,
        updatedAt: event.payload.updatedAt,
      })
      .onConflictDoUpdate({
        target: projectionSessions.sessionId,
        set: {
          archivedAt: null,
          deletedAt: null,
          interactionMode: event.payload.interactionMode,
          modelSelectionJson: JSON.stringify(event.payload.modelSelection),
          worktreeId: event.payload.worktreeId,
          origin: event.payload.origin,
          attentionState: 'settled',
          attentionReason: null,
          hasError: false,
          runtimeMode: event.payload.runtimeMode,
          title: event.payload.title,
          updatedAt: event.payload.updatedAt,
        },
      })
      .run()
  }

  private replaceImportedHistory(
    event: Extract<OrchestrationEvent, { type: 'session.history-imported' }>,
  ) {
    const { sessionId, messages, sourceUpdatedAt } = event.payload
    this.database
      .delete(projectionSessionMessages)
      .where(eq(projectionSessionMessages.sessionId, sessionId))
      .run()
    for (const message of messages) {
      this.database
        .insert(projectionSessionMessages)
        .values({
          messageId: message.id,
          sessionId,
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
          attachmentsJson: '[]',
          streaming: false,
          turnId: null,
        })
        .run()
    }
    this.updateSession(sessionId, {
      updatedAt: sourceUpdatedAt,
      latestUserMessageAt:
        messages.findLast((message) => message.role === 'user')?.createdAt ?? null,
    })
  }

  private upsertMessage(event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>) {
    const existing = this.database
      .select()
      .from(projectionSessionMessages)
      .where(eq(projectionSessionMessages.messageId, event.payload.messageId))
      .get()
    const text = mergedMessageText(existing?.text ?? null, event.payload)
    // turnId and attachments are backfilled, never erased: a later frame that
    // carries neither (a bare completion) must keep what the first one bound.
    const turnId = event.payload.turnId ?? existing?.turnId ?? null
    const attachmentsJson =
      event.payload.attachments.length > 0
        ? JSON.stringify(event.payload.attachments)
        : (existing?.attachmentsJson ?? '[]')

    this.database
      .insert(projectionSessionMessages)
      .values({
        attachmentsJson,
        createdAt: event.payload.createdAt,
        messageId: event.payload.messageId,
        role: event.payload.role,
        streaming: event.payload.streaming,
        text,
        sessionId: event.payload.sessionId,
        turnId,
        updatedAt: event.payload.updatedAt,
      })
      .onConflictDoUpdate({
        target: projectionSessionMessages.messageId,
        set: {
          attachmentsJson,
          streaming: event.payload.streaming,
          text,
          turnId,
          updatedAt: event.payload.updatedAt,
        },
      })
      .run()

    this.updateSessionForMessage(event)
  }

  private updateSessionForMessage(
    event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
  ) {
    if (event.payload.role === 'user') {
      this.updateSession(event.payload.sessionId, {
        latestUserMessageAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      })
      return
    }

    this.updateSession(event.payload.sessionId, { updatedAt: event.payload.updatedAt })
    this.updateAssistantTurn(event)
  }

  private updateAssistantTurn(
    event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
  ) {
    if (event.payload.role !== 'assistant') return
    if (!event.payload.turnId) return

    const turn = this.selectTurn(event.payload.sessionId, event.payload.turnId)
    const state = assistantTurnState(turn?.state, event.payload.streaming)
    const completedAt = assistantTurnCompletedAt(turn?.completedAt, event)
    const startedAt = turn?.startedAt ?? event.payload.createdAt
    const requestedAt = turn?.requestedAt ?? event.payload.createdAt

    this.upsertAssistantTurn(event, { completedAt, requestedAt, startedAt, state })
    this.updateSessionLatestTurnForAssistantMessage(event)
  }

  private upsertTurn(event: Extract<OrchestrationEvent, { type: 'session.turn-start-requested' }>) {
    const session = this.database
      .select({ worktreeId: projectionSessions.worktreeId })
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, event.payload.sessionId))
      .get()
    const worktree = session
      ? this.database
          .select()
          .from(projectionWorktrees)
          .where(eq(projectionWorktrees.worktreeId, session.worktreeId))
          .get()
      : undefined
    const providerStartState =
      worktree?.lifecycleState === 'ready' ? 'queued' : 'blocked-on-worktree'
    const latestTurn = {
      assistantMessageId: null,
      completedAt: null,
      requestedAt: event.payload.createdAt,
      sourceProposedPlan: event.payload.sourceProposedPlan,
      startedAt: null,
      state: 'running',
      providerStartState,
      providerStartGeneration: 0,
      providerStartSequence: event.sequence,
      runtimeEpoch: null,
      turnId: event.payload.turnId,
    }

    this.database
      .insert(projectionTurns)
      .values({
        assistantMessageId: null,
        completedAt: null,
        requestedAt: event.payload.createdAt,
        sourceProposedPlanJson: jsonOrUndefined(event.payload.sourceProposedPlan),
        startedAt: null,
        state: 'running',
        providerStartState,
        providerStartGeneration: 0,
        providerStartSequence: event.sequence,
        runtimeEpoch: null,
        sessionId: event.payload.sessionId,
        turnId: event.payload.turnId,
        userMessageId: event.payload.messageId,
      })
      .onConflictDoUpdate({
        target: [projectionTurns.sessionId, projectionTurns.turnId],
        set: {
          requestedAt: event.payload.createdAt,
          state: 'running',
          userMessageId: event.payload.messageId,
        },
      })
      .run()

    this.updateSession(event.payload.sessionId, {
      interactionMode: event.payload.interactionMode,
      latestTurnId: event.payload.turnId,
      latestTurnJson: JSON.stringify(latestTurn),
      // turn-start's modelSelection is optional but never null, so absent means
      // "leave it alone" — jsonOrUndefined, not jsonPatch.
      modelSelectionJson: jsonOrUndefined(event.payload.modelSelection),
      runtimeMode: event.payload.runtimeMode,
      updatedAt: event.payload.createdAt,
    })
  }

  /**
   * Starting a turn from a plan is the moment the plan stops being actionable.
   * The plan can live on another session, so the flag is refreshed there, not on
   * the session that ran the turn.
   */
  private markProposedPlanImplemented(
    event: Extract<OrchestrationEvent, { type: 'session.proposed-plan-implemented' }>,
  ) {
    this.database
      .update(projectionSessionProposedPlans)
      .set({
        implementationSessionId: event.payload.implementationSessionId,
        implementedAt: event.payload.implementedAt,
        updatedAt: event.payload.updatedAt,
      })
      .where(
        and(
          eq(projectionSessionProposedPlans.planId, event.payload.planId),
          eq(projectionSessionProposedPlans.sessionId, event.payload.sessionId),
          isNull(projectionSessionProposedPlans.implementedAt),
        ),
      )
      .run()
    this.refreshActionableProposedPlan(event.payload.sessionId)
  }

  private upsertProposedPlan(
    event: Extract<OrchestrationEvent, { type: 'session.proposed-plan-upserted' }>,
  ) {
    const plan = event.payload.proposedPlan
    const row = {
      createdAt: plan.createdAt,
      implementationSessionId: plan.implementationSessionId ?? null,
      implementedAt: plan.implementedAt ?? null,
      planId: plan.id,
      planMarkdown: plan.planMarkdown,
      sessionId: event.payload.sessionId,
      turnId: plan.turnId,
      updatedAt: plan.updatedAt,
    }

    this.database
      .insert(projectionSessionProposedPlans)
      .values(row)
      .onConflictDoUpdate({
        target: projectionSessionProposedPlans.planId,
        set: {
          implementationSessionId: row.implementationSessionId,
          implementedAt: row.implementedAt,
          planMarkdown: row.planMarkdown,
          turnId: row.turnId,
          updatedAt: row.updatedAt,
        },
      })
      .run()
    this.updateSession(event.payload.sessionId, { updatedAt: plan.updatedAt })
    this.refreshActionableProposedPlan(event.payload.sessionId)
  }

  /**
   * Derived, never latched: the newest plan decides. The in-memory projector
   * carries no plan history, so both projections read "the last plan we heard
   * about" and agree.
   */
  private refreshActionableProposedPlan(sessionId: string) {
    const latest = this.latestProposedPlan(sessionId)

    this.updateSession(sessionId, {
      hasActionableProposedPlan: latest !== undefined && latest.implementedAt === null,
    })
  }

  private latestProposedPlan(sessionId: string) {
    return this.database
      .select()
      .from(projectionSessionProposedPlans)
      .where(eq(projectionSessionProposedPlans.sessionId, sessionId))
      .orderBy(
        desc(projectionSessionProposedPlans.updatedAt),
        desc(projectionSessionProposedPlans.planId),
      )
      .limit(1)
      .get()
  }

  private upsertCheckpoint(
    event: Extract<OrchestrationEvent, { type: 'session.turn-diff-completed' }>,
  ) {
    const { assistantMessageId, completedAt, status, sessionId, turnId } = event.payload
    const existing = this.selectCheckpoint(sessionId, turnId)
    // Mid-turn diff updates carry a placeholder ref with status "missing". Once
    // a real capture has landed, a later placeholder must change nothing at all
    // — not the ref, and not the turn's state.
    if (existing && existing.status !== 'missing' && status === 'missing') return

    this.database
      .insert(projectionSessionCheckpoints)
      .values({
        assistantMessageId,
        checkpointRef: event.payload.checkpointRef,
        checkpointTurnCount: event.payload.checkpointTurnCount,
        completedAt,
        filesJson: JSON.stringify(event.payload.files),
        status,
        sessionId,
        turnId,
      })
      .onConflictDoUpdate({
        target: [projectionSessionCheckpoints.sessionId, projectionSessionCheckpoints.turnId],
        set: {
          assistantMessageId,
          checkpointRef: event.payload.checkpointRef,
          checkpointTurnCount: event.payload.checkpointTurnCount,
          completedAt,
          filesJson: JSON.stringify(event.payload.files),
          status,
        },
      })
      .run()
    // Recording a checkpoint is not a turn ending: a placeholder arrives while
    // the session is still streaming the very turn it describes.
    if (this.isSessionRunningTurn(sessionId, turnId)) return

    this.completeTurn(
      sessionId,
      turnId,
      status === 'error' ? 'error' : 'completed',
      completedAt,
      assistantMessageId,
    )
  }

  private isSessionRunningTurn(sessionId: string, turnId: string) {
    const session = this.database
      .select()
      .from(projectionSessionRuntime)
      .where(eq(projectionSessionRuntime.sessionId, sessionId))
      .get()
    if (session?.status !== 'running' && session?.status !== 'waiting') return false

    return session.activeTurnId === turnId
  }

  private selectCheckpoint(sessionId: string, turnId: string) {
    return this.database
      .select()
      .from(projectionSessionCheckpoints)
      .where(
        and(
          eq(projectionSessionCheckpoints.sessionId, sessionId),
          eq(projectionSessionCheckpoints.turnId, turnId),
        ),
      )
      .get()
  }

  private upsertRuntime(event: Extract<OrchestrationEvent, { type: 'session.runtime-set' }>) {
    this.updateSession(event.payload.sessionId, { runtimeSequence: event.sequence })
    this.database
      .insert(projectionSessionRuntime)
      .values({
        activeTurnId: event.payload.runtime.activeTurnId,
        lastError: event.payload.runtime.lastError,
        providerInstanceId: event.payload.runtime.providerInstanceId ?? 'codex',
        providerName: event.payload.runtime.providerName,
        providerBindingHandle: event.payload.runtime.providerBindingHandle,
        providerConversationMarker: event.payload.runtime.providerConversationMarker,
        providerResumeCursor: event.payload.runtime.providerResumeCursor,
        runtimeEpoch: event.payload.runtime.runtimeEpoch,
        runtimeMode: event.payload.runtime.runtimeMode ?? 'full-access',
        status: event.payload.runtime.status,
        sessionId: event.payload.sessionId,
        updatedAt: event.payload.runtime.updatedAt,
      })
      .onConflictDoUpdate({
        target: projectionSessionRuntime.sessionId,
        set: {
          activeTurnId: event.payload.runtime.activeTurnId,
          lastError: event.payload.runtime.lastError,
          providerInstanceId: event.payload.runtime.providerInstanceId ?? 'codex',
          providerName: event.payload.runtime.providerName,
          providerBindingHandle: event.payload.runtime.providerBindingHandle,
          providerConversationMarker: event.payload.runtime.providerConversationMarker,
          providerResumeCursor: event.payload.runtime.providerResumeCursor,
          runtimeEpoch: event.payload.runtime.runtimeEpoch,
          runtimeMode: event.payload.runtime.runtimeMode ?? 'full-access',
          status: event.payload.runtime.status,
          updatedAt: event.payload.runtime.updatedAt,
        },
      })
      .run()
  }

  /**
   * A streaming activity is revised in place: the provider re-emits the same id
   * as a tool's title, status and payload fill in. Conflict-do-nothing froze the
   * first frame forever, so the row disagreed with the event log. `createdAt`
   * and `sequence` are where the activity sits in the stream, not content — a
   * revision must correct the entry, never reorder the timeline around it.
   */
  private upsertActivity(
    event: Extract<OrchestrationEvent, { type: 'session.activity-appended' }>,
  ) {
    const payloadJson = JSON.stringify(event.payload.activity.payload)

    this.database
      .insert(projectionSessionActivities)
      .values({
        activityId: event.payload.activity.id,
        createdAt: event.payload.activity.createdAt,
        kind: event.payload.activity.kind,
        payloadJson,
        sequence: event.payload.activity.sequence ?? event.sequence,
        summary: event.payload.activity.summary,
        sessionId: event.payload.sessionId,
        tone: event.payload.activity.tone,
        turnId: event.payload.activity.turnId,
      })
      .onConflictDoUpdate({
        target: projectionSessionActivities.activityId,
        set: {
          kind: event.payload.activity.kind,
          payloadJson,
          summary: event.payload.activity.summary,
          tone: event.payload.activity.tone,
          // turnId is backfilled, never erased — same rule as messages: a later
          // frame that carries no turn must keep the one the first frame bound,
          // or the activity drops out of its turn's fold.
          turnId: sql`coalesce(excluded.turn_id, ${projectionSessionActivities.turnId})`,
        },
      })
      .run()
  }

  private updateTurnForActivity(
    event: Extract<OrchestrationEvent, { type: 'session.activity-appended' }>,
  ) {
    if (!isProviderTurnFailureActivity(event.payload.activity.kind)) return
    if (!event.payload.activity.turnId) return

    this.completeTurn(
      event.payload.sessionId,
      event.payload.activity.turnId,
      'error',
      event.payload.activity.createdAt,
    )
  }

  /**
   * Only a request-relevant activity can move the counters, so the streaming
   * storm of tool-call activities never pays for the fold.
   */
  private refreshPendingRequestCountsForActivity(
    event: Extract<OrchestrationEvent, { type: 'session.activity-appended' }>,
  ) {
    if (!isPendingRequestActivityKind(event.payload.activity.kind)) return

    this.refreshPendingRequestCounts(event.payload.sessionId)
  }

  /**
   * The counters are a fold over the session's whole activity history, recomputed
   * rather than incremented: a replayed event (the upsert above), a revised
   * activity or a revert then can never leave them drifted from the request
   * state they describe. This is the same fold the settle guard runs against the
   * read model (`pending-requests.ts`).
   */
  private refreshPendingRequestCounts(sessionId: string) {
    const counts = pendingRequestCounts(this.requestActivities(sessionId))

    this.updateSession(sessionId, {
      pendingApprovalCount: counts.approvals,
      pendingUserInputCount: counts.userInputs,
    })
  }

  /**
   * Only a plan snapshot can move the field, so the streaming storm of tool-call
   * activities never pays for the refold.
   */
  private refreshPlanProgressForActivity(
    event: Extract<OrchestrationEvent, { type: 'session.activity-appended' }>,
  ) {
    if (!isPlanProgressActivityKind(event.payload.activity.kind)) return

    this.refreshPlanProgress(event.payload.sessionId)
  }

  /**
   * A refold over the session's retained plan activities, never an in-place
   * advance: a replayed snapshot, a revised one, or a revert that pruned the
   * planning turn then cannot leave the rail narrating a step that no longer
   * exists. The in-memory model runs the same fold over the same activities.
   */
  private refreshPlanProgress(sessionId: string) {
    const progress = sessionPlanProgress(this.planActivities(sessionId))

    this.updateSession(sessionId, {
      planProgressJson: progress === null ? null : JSON.stringify(progress),
    })
  }

  /**
   * Filtered by kind in SQL rather than folded over the whole history: a plan
   * snapshot is a handful of rows in a session that can hold thousands.
   */
  private planActivities(sessionId: string) {
    const rows = this.database
      .select({
        kind: projectionSessionActivities.kind,
        payloadJson: projectionSessionActivities.payloadJson,
        turnId: projectionSessionActivities.turnId,
      })
      .from(projectionSessionActivities)
      .where(
        and(
          eq(projectionSessionActivities.sessionId, sessionId),
          eq(projectionSessionActivities.kind, PLAN_PROGRESS_ACTIVITY_KIND),
        ),
      )
      .orderBy(
        asc(projectionSessionActivities.sequence),
        asc(projectionSessionActivities.createdAt),
        asc(projectionSessionActivities.activityId),
      )
      .all()

    return rows.map((row) => ({
      kind: row.kind,
      payload: parseActivityPayload(row.payloadJson),
      // The column stores what the branded id serialized to; this read is the
      // boundary that hands it back.
      turnId: row.turnId as SessionPlanProgress['turnId'],
    }))
  }

  /**
   * Filtered by kind in SQL, exactly like `planActivities`: the fold reacts to
   * six kinds, and a session's activity table holds every tool call it ever made
   * with its diff in the payload. Reading and parsing those to ignore them is
   * what made an approval cost more the longer the session ran.
   */
  private requestActivities(sessionId: string) {
    const rows = this.database
      .select({
        kind: projectionSessionActivities.kind,
        payloadJson: projectionSessionActivities.payloadJson,
      })
      .from(projectionSessionActivities)
      .where(
        and(
          eq(projectionSessionActivities.sessionId, sessionId),
          inArray(projectionSessionActivities.kind, PENDING_REQUEST_ACTIVITY_KINDS),
        ),
      )
      .orderBy(
        asc(projectionSessionActivities.sequence),
        asc(projectionSessionActivities.createdAt),
        asc(projectionSessionActivities.activityId),
      )
      .all()

    return rows.map((row) => ({ kind: row.kind, payload: parseActivityPayload(row.payloadJson) }))
  }

  private completeTurn(
    sessionId: string,
    turnId: string | undefined,
    state: 'completed' | 'interrupted' | 'error',
    completedAt: string,
    assistantMessageId?: string | null,
  ) {
    if (!turnId) return

    const turn = this.selectTurn(sessionId, turnId)
    const nextAssistantMessageId =
      assistantMessageId === undefined ? (turn?.assistantMessageId ?? null) : assistantMessageId

    this.database
      .update(projectionTurns)
      .set({
        assistantMessageId: nextAssistantMessageId,
        completedAt,
        state,
        providerStartState: state === 'interrupted' ? 'interrupted' : 'settled',
      })
      .where(and(eq(projectionTurns.sessionId, sessionId), eq(projectionTurns.turnId, turnId)))
      .run()
    this.refreshLatestTurn(sessionId, completedAt)
  }

  /**
   * Leaving the "running" session status is the turn-end signal. Without it a
   * turn that ended with no assistant message — or whose session errored
   * mid-turn — stays `running` in SQL forever and the session spins.
   */
  private settleRunningTurns(sessionId: string, status: SessionRuntimeStatus, settledAt: string) {
    const state = settledTurnStateForSessionStatus(status)
    if (!state) return

    const running = this.database
      .select({ turnId: projectionTurns.turnId })
      .from(projectionTurns)
      .where(
        and(
          eq(projectionTurns.sessionId, sessionId),
          or(
            eq(projectionTurns.state, 'running'),
            inArray(projectionTurns.providerStartState, ['claimed', 'adopted']),
          ),
        ),
      )
      .all()
    // Touching nothing keeps the session's updatedAt — and the shell snapshot
    // timestamp — stable when a session status carries no turn news.
    if (running.length === 0) return

    this.database
      .update(projectionTurns)
      .set({
        completedAt: settledAt,
        state,
        providerStartState: state === 'interrupted' ? 'interrupted' : 'settled',
      })
      .where(
        and(
          eq(projectionTurns.sessionId, sessionId),
          or(
            eq(projectionTurns.state, 'running'),
            inArray(projectionTurns.providerStartState, ['claimed', 'adopted']),
          ),
        ),
      )
      .run()
    this.refreshLatestTurn(sessionId, settledAt)
  }

  private refreshLatestTurn(sessionId: string, updatedAt: string) {
    const row = this.database
      .select()
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, sessionId))
      .get()
    if (!row?.latestTurnId) return

    const turn = this.selectTurn(sessionId, row.latestTurnId)
    if (!turn) return

    this.updateSession(sessionId, {
      latestTurnJson: JSON.stringify(latestTurnJson(turn)),
      updatedAt,
    })
  }

  private selectTurn(sessionId: string, turnId: string) {
    return this.database
      .select()
      .from(projectionTurns)
      .where(and(eq(projectionTurns.sessionId, sessionId), eq(projectionTurns.turnId, turnId)))
      .get()
  }

  private upsertAssistantTurn(
    event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
    turn: {
      completedAt: string | null
      requestedAt: string
      startedAt: string
      state: 'running' | 'completed' | 'interrupted' | 'error'
    },
  ) {
    const turnId = event.payload.turnId
    if (!turnId) return

    this.database
      .insert(projectionTurns)
      .values({
        assistantMessageId: event.payload.messageId,
        completedAt: turn.completedAt,
        requestedAt: turn.requestedAt,
        sourceProposedPlanJson: null,
        startedAt: turn.startedAt,
        state: turn.state,
        providerStartState: turn.state === 'running' ? 'adopted' : 'settled',
        providerStartGeneration: 0,
        providerStartSequence: event.sequence,
        runtimeEpoch: null,
        sessionId: event.payload.sessionId,
        turnId,
        userMessageId: null,
      })
      .onConflictDoUpdate({
        target: [projectionTurns.sessionId, projectionTurns.turnId],
        set: {
          assistantMessageId: event.payload.messageId,
          completedAt: turn.completedAt,
          requestedAt: turn.requestedAt,
          startedAt: turn.startedAt,
          state: turn.state,
        },
      })
      .run()
  }

  private updateSessionLatestTurnForAssistantMessage(
    event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
  ) {
    const turnId = event.payload.turnId
    if (!turnId) return

    const row = this.database
      .select()
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, event.payload.sessionId))
      .get()
    if (row?.latestTurnId && row.latestTurnId !== turnId) return

    const updatedTurn = this.selectTurn(event.payload.sessionId, turnId)

    this.updateSession(event.payload.sessionId, {
      latestTurnId: turnId,
      latestTurnJson: updatedTurn ? JSON.stringify(latestTurnJson(updatedTurn)) : null,
      updatedAt: event.payload.updatedAt,
    })
  }

  private pruneSessionAfterRevert(
    event: Extract<OrchestrationEvent, { type: 'session.reverted' }>,
  ) {
    const sessionId = event.payload.sessionId
    const retainedTurnIds = new Set(
      this.dropCheckpointsAfterRevert(sessionId, event.payload.turnCount).map((row) => row.turnId),
    )
    const messages = this.database
      .select()
      .from(projectionSessionMessages)
      .where(eq(projectionSessionMessages.sessionId, sessionId))
      .all()
      .filter((message) => shouldRetainAfterRevert(message.turnId, retainedTurnIds))
    const activities = this.database
      .select()
      .from(projectionSessionActivities)
      .where(eq(projectionSessionActivities.sessionId, sessionId))
      .all()
      .filter((activity) => shouldRetainAfterRevert(activity.turnId, retainedTurnIds))
    const turns = this.database
      .select()
      .from(projectionTurns)
      .where(eq(projectionTurns.sessionId, sessionId))
      .all()
      .filter((turn) => retainedTurnIds.has(turn.turnId))
    const latestTurn = latestProjectionTurn(turns)

    this.replaceSessionMessages(sessionId, messages)
    this.replaceSessionActivities(sessionId, activities)
    this.database.delete(projectionTurns).where(eq(projectionTurns.sessionId, sessionId)).run()
    if (turns.length > 0) {
      this.database.insert(projectionTurns).values(turns.map(turnInsertRow)).run()
    }

    this.updateSession(sessionId, {
      latestTurnId: latestTurn?.turnId ?? null,
      latestTurnJson: latestTurn ? JSON.stringify(latestTurnJson(latestTurn)) : null,
      latestUserMessageAt: latestUserMessageAt(messages),
      updatedAt: event.payload.revertedAt,
    })
    // Requests pruned with their turns must not keep the counters flagged, and a
    // plan pruned with its turn must not keep narrating a step.
    this.refreshPendingRequestCounts(sessionId)
    this.refreshPlanProgress(sessionId)
    this.dropProposedPlansAfterRevert(sessionId, retainedTurnIds)
    this.refreshActionableProposedPlan(sessionId)
  }

  /** Drops the checkpoints the revert undid and returns the ones that survive. */
  private dropCheckpointsAfterRevert(sessionId: string, turnCount: number) {
    this.database
      .delete(projectionSessionCheckpoints)
      .where(
        and(
          eq(projectionSessionCheckpoints.sessionId, sessionId),
          gt(projectionSessionCheckpoints.checkpointTurnCount, turnCount),
        ),
      )
      .run()

    return this.sessionCheckpointRows(sessionId)
  }

  /** A plan belongs to the turn that proposed it; an unturned plan outlives every revert. */
  private dropProposedPlansAfterRevert(sessionId: string, retainedTurnIds: Set<string>) {
    const droppedIds = this.database
      .select({
        planId: projectionSessionProposedPlans.planId,
        turnId: projectionSessionProposedPlans.turnId,
      })
      .from(projectionSessionProposedPlans)
      .where(eq(projectionSessionProposedPlans.sessionId, sessionId))
      .all()
      .filter((plan) => !shouldRetainAfterRevert(plan.turnId, retainedTurnIds))
      .map((plan) => plan.planId)
    if (droppedIds.length === 0) return

    this.database
      .delete(projectionSessionProposedPlans)
      .where(inArray(projectionSessionProposedPlans.planId, droppedIds))
      .run()
  }

  private sessionCheckpointRows(sessionId: string) {
    return this.database
      .select()
      .from(projectionSessionCheckpoints)
      .where(eq(projectionSessionCheckpoints.sessionId, sessionId))
      .all()
  }

  private replaceSessionMessages(
    sessionId: string,
    rows: Array<typeof projectionSessionMessages.$inferSelect>,
  ) {
    this.database
      .delete(projectionSessionMessages)
      .where(eq(projectionSessionMessages.sessionId, sessionId))
      .run()
    if (rows.length === 0) return

    this.database.insert(projectionSessionMessages).values(rows).run()
  }

  private replaceSessionActivities(
    sessionId: string,
    rows: Array<typeof projectionSessionActivities.$inferSelect>,
  ) {
    this.database
      .delete(projectionSessionActivities)
      .where(eq(projectionSessionActivities.sessionId, sessionId))
      .run()
    if (rows.length === 0) return

    this.database.insert(projectionSessionActivities).values(rows).run()
  }

  private updateSessionStatus(sessionId: string, status: 'stopped', updatedAt: string) {
    this.database
      .update(projectionSessionRuntime)
      .set({ status, updatedAt })
      .where(eq(projectionSessionRuntime.sessionId, sessionId))
      .run()
  }

  private updateProject(projectId: string, patch: Partial<typeof projectionProjects.$inferInsert>) {
    this.database
      .update(projectionProjects)
      .set(compactPatch(patch))
      .where(eq(projectionProjects.projectId, projectId))
      .run()
  }

  private updateSession(sessionId: string, patch: Partial<typeof projectionSessions.$inferInsert>) {
    this.database
      .update(projectionSessions)
      .set(compactPatch(patch))
      .where(eq(projectionSessions.sessionId, sessionId))
      .run()
  }

  private markApplied(sequence: number) {
    const updatedAt = new Date().toISOString()

    this.database
      .insert(projectionState)
      .values({
        lastAppliedSequence: sequence,
        projector: ORCHESTRATION_PROJECTOR_NAME,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: projectionState.projector,
        set: {
          lastAppliedSequence: sequence,
          updatedAt,
        },
      })
      .run()
  }
}

function compactPatch<T extends Record<string, unknown>>(patch: T) {
  return Object.fromEntries(
    Object.entries(patch).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>
}

function jsonOrNull(value: unknown) {
  if (value === undefined || value === null) return null

  return JSON.stringify(value)
}

/**
 * Three-way, for nullable-and-optional payload fields: absent leaves the column alone
 * (compactPatch drops undefined), explicit null clears it. Collapsing the two would let
 * a partial update — say a rename carrying no defaultModelSelection — wipe the stored value.
 */
function jsonPatch(value: unknown) {
  if (value === undefined) return undefined
  if (value === null) return null

  return JSON.stringify(value)
}

function jsonOrUndefined(value: unknown) {
  if (value === undefined) return undefined

  return JSON.stringify(value)
}

function assistantTurnState(
  current: 'running' | 'completed' | 'interrupted' | 'error' | undefined,
  streaming: boolean,
) {
  if (streaming) return current ?? 'running'
  if (current === 'interrupted' || current === 'error') return current

  return 'completed'
}

function isProviderTurnFailureActivity(kind: string) {
  return kind === 'provider.turn.start.failed' || kind === 'provider.turn.failed'
}

function assistantTurnCompletedAt(
  current: string | null | undefined,
  event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
) {
  if (event.payload.streaming) return current ?? null

  return current ?? event.payload.updatedAt
}

function shouldRetainAfterRevert(turnId: string | null, retainedTurnIds: Set<string>) {
  if (!turnId) return true

  return retainedTurnIds.has(turnId)
}

function latestProjectionTurn(turns: Array<typeof projectionTurns.$inferSelect>) {
  return turns
    .toSorted((left, right) => {
      const requestedOrder = left.requestedAt.localeCompare(right.requestedAt)
      if (requestedOrder !== 0) return requestedOrder

      return left.turnId.localeCompare(right.turnId)
    })
    .at(-1)
}

function latestTurnJson(turn: typeof projectionTurns.$inferSelect) {
  return {
    assistantMessageId: turn.assistantMessageId,
    completedAt: turn.completedAt,
    requestedAt: turn.requestedAt,
    sourceProposedPlan: parseJsonOrUndefined(turn.sourceProposedPlanJson),
    startedAt: turn.startedAt,
    state: turn.state,
    providerStartState: turn.providerStartState,
    providerStartGeneration: turn.providerStartGeneration,
    providerStartSequence: turn.providerStartSequence,
    runtimeEpoch: turn.runtimeEpoch,
    turnId: turn.turnId,
  }
}

function turnInsertRow(
  turn: typeof projectionTurns.$inferSelect,
): typeof projectionTurns.$inferInsert {
  const { rowId: _rowId, ...row } = turn
  return row
}

function latestUserMessageAt(messages: Array<typeof projectionSessionMessages.$inferSelect>) {
  return (
    messages
      .filter((message) => message.role === 'user')
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1)?.createdAt ?? null
  )
}

function parseJsonOrUndefined(value: string | null) {
  if (!value) return undefined

  return JSON.parse(value) as unknown
}

/**
 * Null — never a throw — for a row whose payload no longer parses: the fold
 * treats it as a non-request activity instead of poisoning the projection.
 */
function parseActivityPayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown
  } catch {
    return null
  }
}

const PROVIDER_START_STATE = {
  'session.provider-start-claimed': 'claimed',
  'session.provider-start-adopted': 'adopted',
  'session.provider-start-settled': 'settled',
} as const

function failureKind(event: OrchestrationEvent) {
  if (event.type === 'session.runtime-set')
    return event.payload.runtime.status === 'error' ? 'failure' : null
  if (event.type === 'session.runtime-recovered') return 'interruption'
  if (event.type === 'session.turn-diff-completed' && event.payload.status === 'error')
    return 'failure'
  if (event.type !== 'session.activity-appended') return null
  return isProviderTurnFailureActivity(event.payload.activity.kind) ||
    event.payload.activity.kind === 'runtime.error'
    ? 'failure'
    : null
}
