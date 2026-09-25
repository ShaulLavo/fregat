import { questionAnswerHistory } from './question-answer-history'
import { approvalResponseEvents, endedApprovalEvents } from './approval-admission'
import { decideSessionTitle, titleMetadata } from './title-decider'
import { createInternalError } from '../observability/structured-errors'
import {
  pendingMessageQuestions,
  messageQuestionDismissalEvents,
  messageQuestionAnswer,
  messageQuestionResolutionEvent,
} from './message-questions'
import { requireSettled } from './command-invariants'
import { requireNoRewindConflict } from './rewind-admission'
import {
  decideWorktreeLifecycle,
  creationTargetEvents,
  requireReadyWorktree,
} from './worktree-decider'
import { worktreeLifecycleErrors } from './worktree-errors'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type OrchestrationCommand,
  approvalRequestIdSchema,
  messageIdSchema,
  turnIdSchema,
  type OrchestrationEventMetadata,
} from '@workspace/contracts'
import * as v from 'valibot'

import { orchestrationErrors } from '../observability'
import { activityRequestId } from './pending-requests'
import { event, one } from './event-factory'
import { settlementActivityEvents, userEngagementEvents } from './lifecycle-events'
import { decideRegistration, decideWorktreeCommand } from './registration-decider'
import { decideProviderStart, decideRuntimeRecovery, decideDeletionUpdate } from './runtime-decider'
import { requireWorktree } from './read-model'
import { sessionDomainErrors } from './structured-errors'
import {
  liveProjectSessions,
  requireFutureWakeTime,
  requirePinned,
  requireActiveOrderable,
  requireSettleable,
  requireSnoozable,
  requireSessionAbsent,
  requireSessionArchived,
  requireSessionNotArchived,
  requireValidOrderKey,
} from './command-invariants'
import { requireSession as requireSessionNotDeleted } from './read-model'
import { requireProject } from './read-model'
import type { PendingOrchestrationEvent } from './event-store'
import type { OrchestrationProjectedSession, OrchestrationReadModel } from './read-model'

/**
 * One server clock reading per command. It stamps every event's `occurredAt`
 * and every projected timestamp, so a batch (a cascade, a turn start) lands as
 * one instant and a client can never place an event in the past or the future.
 */
export function decideOrchestrationCommand(
  command: OrchestrationCommand,
  model: OrchestrationReadModel,
): PendingOrchestrationEvent[] {
  requireNoRewindConflict(command, model)
  const at = new Date().toISOString()
  const events = decideCommandEvents(command, model, at)

  return [...events, ...endedApprovalEvents(command, events, model, at)]
}

function decideCommandEvents(
  command: OrchestrationCommand,
  model: OrchestrationReadModel,
  at: string,
): PendingOrchestrationEvent[] {
  switch (command.type) {
    case 'session.title.generate.complete':
    case 'session.title.refine':
    case 'session.title.regeneration.complete':
      return decideSessionTitle(command, model, at)
    case 'worktree.retry':
    case 'worktree.cleanup':
    case 'worktree.force-cleanup':
    case 'worktree.retain':
    case 'worktree.adopt':
    case 'worktree.release':
    case 'worktree.resolve-missing':
    case 'worktree.create.complete':
    case 'worktree.create.fail':
    case 'worktree.cleanup.complete':
    case 'worktree.cleanup.blocked':
    case 'worktree.cleanup.fail':
    case 'worktree.mark-missing':
    case 'worktree.metadata.refresh':
    case 'worktree.orphan.register':
    case 'session.worktree.release':
    case 'terminal.lease.request':
    case 'terminal.lease.claim':
    case 'terminal.lease.activate':
    case 'terminal.lease.terminate':
    case 'terminal.lease.end':
    case 'terminal.lease.mark-unknown':
      return decideWorktreeLifecycle(command, model, at)
    case 'project.create':
    case 'project.revive':
      return decideRegistration(command, model, at)
    case 'worktree.register':
    case 'worktree.revive':
      return decideWorktreeCommand(command, model, at)
    case 'project.meta.update':
      return projectMetaUpdated(command, model, at)
    case 'project.reorder':
      return projectReordered(command, model, at)
    case 'project.delete':
      return projectDeleted(command, model, at)
    case 'session.create':
    case 'session.discover':
      return sessionCreated(command, model, at)
    case 'session.fork':
      return sessionForked(command, model, at)
    case 'session.discovery-metadata.update':
      return discoveryMetadataUpdated(command, model, at)
    case 'session.provider-start.claim':
    case 'session.provider-start.adopt':
    case 'session.provider-start.settle':
      return decideProviderStart(command, model, at)
    case 'session.runtime.recover':
      return decideRuntimeRecovery(command, model, at)
    case 'session.deletion.update':
      return decideDeletionUpdate(command, model, at)
    case 'session.meta.update':
      return sessionMetaUpdated(command, model, at)
    case 'session.delete':
      requireSessionNotDeleted(model, command.sessionId)

      return one(command, at, 'session.deleted', {
        deletedAt: at,
        sessionId: command.sessionId,
      })
    case 'session.archive':
      requireSessionNotArchived(model, command.sessionId, command.type)

      return one(command, at, 'session.archived', {
        archivedAt: at,
        sessionId: command.sessionId,
        updatedAt: at,
      })
    case 'session.unarchive':
      requireSessionArchived(model, command.sessionId)

      return one(command, at, 'session.unarchived', {
        sessionId: command.sessionId,
        updatedAt: at,
      })
    case 'session.settle':
      return sessionSettled(command, model, at)
    case 'session.unsettle':
      return sessionUnsettled(command, model, at)
    case 'session.snooze':
      return sessionSnoozed(command, model, at)
    case 'session.unsnooze':
      return sessionUnsnoozed(command, model, at)
    case 'session.pin':
      return sessionPinned(command, model, at)
    case 'session.unpin':
      return sessionUnpinned(command, model, at)
    case 'session.active.reorder':
      return sessionActiveReordered(command, model, at)
    case 'session.pin.reorder':
      return sessionPinReordered(command, model, at)
    case 'session.runtime-mode.set':
      requireSessionNotArchived(model, command.sessionId, command.type)

      return one(command, at, 'session.runtime-mode-set', {
        runtimeMode: command.runtimeMode,
        sessionId: command.sessionId,
        updatedAt: at,
      })
    case 'session.interaction-mode.set':
      requireSessionNotArchived(model, command.sessionId, command.type)

      return one(command, at, 'session.interaction-mode-set', {
        interactionMode: command.interactionMode,
        sessionId: command.sessionId,
        updatedAt: at,
      })
    case 'session.turn.start':
      return turnStartRequested(command, model, at)
    case 'session.turn.steer':
      return turnSteerRequested(command, model, at)
    case 'session.turn.interrupt':
      requireSessionNotDeleted(model, command.sessionId)

      return one(command, at, 'session.turn-interrupt-requested', {
        createdAt: at,
        sessionId: command.sessionId,
        turnId: command.turnId ?? model.sessions.get(command.sessionId)?.latestTurn?.turnId,
      })
    case 'session.runtime.stop':
      const stoppedSession = requireSessionNotDeleted(model, command.sessionId)
      if (command.onlyIfSettled) {
        requireSettled(stoppedSession)
        requireSettleable(stoppedSession, command.type, at)
      }
      return one(command, at, 'session.runtime-stop-requested', {
        onlyIfSettled: command.onlyIfSettled,
        createdAt: at,
        sessionId: command.sessionId,
      })
    case 'session.approval.respond':
      return approvalResponseEvents(command, model, at)
    case 'session.user-input.respond':
      return userInputResponse(command, model, at)
    case 'session.user-input.dismiss': {
      const session = requireSessionNotDeleted(model, command.sessionId)
      const request = pendingMessageQuestions(session.activities).find(
        (entry) => entry.payload.requestId === command.requestId,
      )
      if (!request)
        throw createInternalError('This question cannot be dismissed. Answer it or stop the turn.')
      return messageQuestionDismissalEvents(command, command.sessionId, [request], at)
    }
    case 'session.checkpoint.revert':
      requireSettleable(
        requireSessionNotArchived(model, command.sessionId, command.type),
        command.type,
        at,
      )

      return one(command, at, 'session.checkpoint-revert-requested', {
        createdAt: at,
        sessionId: command.sessionId,
        turnCount: command.turnCount,
        restoreFiles: command.restoreFiles,
      })
    case 'session.runtime.set':
      return sessionSet(command, model, at)
    case 'session.message.assistant.delta':
      requireSessionNotDeleted(model, command.sessionId)

      return one(command, at, 'session.message-sent', {
        attachments: [],
        createdAt: command.createdAt,
        messageId: command.messageId,
        role: 'assistant',
        streaming: true,
        text: command.delta,
        sessionId: command.sessionId,
        turnId: command.turnId ?? null,
        updatedAt: command.createdAt,
      })
    case 'session.terminal-history.append':
      requireSessionNotDeleted(model, command.sessionId)
      return command.messages.map((message) =>
        event(command, at, 'session.message-sent', {
          sessionId: command.sessionId,
          messageId: message.id,
          role: message.role,
          text: message.text,
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        }),
      )
    case 'session.history.import': {
      const session = requireSessionNotDeleted(model, command.sessionId)
      if (session.origin !== 'discovered' || session.latestTurn || session.runtime) return []
      return one(
        command,
        at,
        'session.history-imported',
        {
          sessionId: command.sessionId,
          messages: command.messages,
          sourceUpdatedAt: command.sourceUpdatedAt,
        },
        { metadata: { historyRevision: command.revision } },
      )
    }
    case 'session.message.assistant.complete':
      requireSessionNotDeleted(model, command.sessionId)

      return one(command, at, 'session.message-sent', {
        attachments: [],
        createdAt: command.completedAt,
        messageId: command.messageId,
        role: 'assistant',
        streaming: false,
        text: '',
        sessionId: command.sessionId,
        turnId: command.turnId ?? null,
        updatedAt: command.completedAt,
      })
    case 'session.activity.append':
      return activityAppended(command, model, at)
    case 'session.proposed-plan.upsert':
      return proposedPlanUpserted(command, model, at)
    case 'session.turn.diff.complete':
      requireSessionNotDeleted(model, command.sessionId)

      return one(command, at, 'session.turn-diff-completed', {
        assistantMessageId: command.assistantMessageId ?? null,
        checkpointRef: command.checkpointRef,
        checkpointTurnCount: command.checkpointTurnCount,
        completedAt: command.completedAt,
        files: command.files,
        status: command.status,
        sessionId: command.sessionId,
        turnId: command.turnId,
      })
    case 'session.revert.complete':
      requireSessionNotDeleted(model, command.sessionId)

      return one(
        command,
        at,
        'session.reverted',
        {
          revertedAt: command.createdAt,
          sessionId: command.sessionId,
          turnCount: command.turnCount,
        },
        { correlationId: command.revertCommandId },
      )
  }
}

function projectMetaUpdated(
  command: Extract<OrchestrationCommand, { type: 'project.meta.update' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  requireProject(model, command.projectId)

  return one(command, at, 'project.meta-updated', {
    defaultModelSelection: command.defaultModelSelection,
    projectId: command.projectId,
    scripts: command.scripts,
    title: command.title,
    updatedAt: at,
  })
}

/**
 * A drag writes exactly one key to exactly one project: the client mints a
 * fractional key that sorts between the drop position's neighbours, and the
 * neighbours are never touched. A reorder that raced a delete is refused rather
 * than resurrecting the row as an orphaned key.
 */
function projectReordered(
  command: Extract<OrchestrationCommand, { type: 'project.reorder' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  requireProject(model, command.projectId)
  requireValidOrderKey(command.orderKey)

  return one(command, at, 'project.reordered', {
    orderKey: command.orderKey,
    projectId: command.projectId,
  })
}

/**
 * Deleting a project is a cascade, not a flag flip: every session it owns keeps
 * a live provider session and keeps showing up in session queries until it is
 * tombstoned too. The sessions are deleted in the same batch as the project so
 * the whole cascade commits or rolls back as one transaction.
 */
function projectDeleted(
  command: Extract<OrchestrationCommand, { type: 'project.delete' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  requireProject(model, command.projectId)
  if (
    [...model.worktrees.values()].some(
      (worktree) =>
        worktree.projectId === command.projectId &&
        worktree.ownership === 'platform' &&
        worktree.lifecycle.state !== 'removed',
    )
  )
    throw worktreeLifecycleErrors.PROJECT_HAS_WORKTREES({
      projectId: command.projectId,
      internal: {
        liveWorktreeIds: [...model.worktrees.values()]
          .filter(
            (worktree) =>
              worktree.projectId === command.projectId &&
              !worktree.retiredAt &&
              worktree.lifecycle.state !== 'removed',
          )
          .map((worktree) => worktree.id),
      },
    })
  const sessions = liveProjectSessions(model, command.projectId)
  if (sessions.length > 0 && !command.force) {
    throw orchestrationErrors.PROJECT_NOT_EMPTY({
      projectId: command.projectId,
      sessionCount: sessions.length,
      internal: { force: command.force, sessionIds: sessions.map((session) => session.id) },
    })
  }

  const cascade = sessions.map((session) =>
    event(command, at, 'session.deleted', {
      deletedAt: at,
      sessionId: session.id,
    }),
  )

  return [
    ...cascade,
    ...Array.from(model.worktrees.values())
      .filter((worktree) => worktree.projectId === command.projectId && !worktree.retiredAt)
      .map((worktree) =>
        event(command, at, 'worktree.retired', { worktreeId: worktree.id, retiredAt: at }),
      ),
    event(command, at, 'project.deleted', {
      deletedAt: at,
      projectId: command.projectId,
    }),
  ]
}

function sessionCreated(
  command: Extract<OrchestrationCommand, { type: 'session.create' | 'session.discover' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const worktreeId =
    command.type === 'session.discover' ? command.worktreeId : command.worktreeTarget.worktreeId
  const creation =
    command.type === 'session.discover'
      ? []
      : creationTargetEvents(
          command,
          command.worktreeTarget,
          command.worktreeProvisioning,
          model,
          at,
        )
  if (command.type === 'session.discover') requireWorktree(model, worktreeId)
  const existing = model.sessions.get(command.sessionId)
  if (existing && command.type === 'session.discover') {
    requireDiscoveryOwner(existing, command)
    return []
  }
  requireSessionAbsent(model, command.sessionId)

  return [
    ...creation,
    event(command, at, 'session.created', {
      ...(command.agent ? { agent: command.agent } : {}),
      createdAt: at,
      interactionMode: command.interactionMode ?? DEFAULT_INTERACTION_MODE,
      modelSelection: command.modelSelection,
      worktreeId,
      origin: command.type === 'session.discover' ? 'discovered' : 'platform',
      runtimeMode: command.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      sessionId: command.sessionId,
      title: command.title,
      updatedAt: at,
    }),
  ]
}

function sessionForked(
  command: Extract<OrchestrationCommand, { type: 'session.fork' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const source = requireSessionNotDeleted(model, command.sourceSessionId)
  requireWorktree(model, source.worktreeId)
  requireSessionAbsent(model, command.sessionId)
  const internal = { sessionId: command.sourceSessionId, turnId: command.throughTurnId }
  if (source.latestTurn?.turnId === command.throughTurnId && source.latestTurn.state === 'running')
    throw sessionDomainErrors.FORK_TURN_RUNNING({ internal })
  const lastIndex = source.messages.findLastIndex(
    (message) => message.turnId === command.throughTurnId,
  )
  if (lastIndex < 0) throw sessionDomainErrors.FORK_TURN_NOT_FOUND({ internal })

  const kept = source.messages.slice(0, lastIndex + 1)
  const dropped = source.messages.slice(lastIndex + 1)
  return [
    event(command, at, 'session.created', {
      createdAt: at,
      ...(source.agent ? { agent: source.agent } : {}),
      forkedFrom: {
        droppedPrompts: dropped.filter((message) => message.role === 'user').length,
        sessionId: command.sourceSessionId,
        turnId: command.throughTurnId,
      },
      interactionMode: source.interactionMode,
      modelSelection: source.modelSelection,
      origin: 'platform',
      runtimeMode: source.runtimeMode,
      sessionId: command.sessionId,
      title: `${source.title} (fork)`,
      updatedAt: at,
      worktreeId: source.worktreeId,
    }),
    event(command, at, 'session.history-imported', {
      messages: kept.flatMap((message, index) =>
        message.role === 'system'
          ? []
          : [
              {
                createdAt: message.createdAt,
                id: v.parse(messageIdSchema, `fork:${command.sessionId}:${index}`),
                role: message.role,
                text: message.text,
              },
            ],
      ),
      sessionId: command.sessionId,
      sourceUpdatedAt: at,
    }),
  ]
}

function sessionMetaUpdated(
  command: Extract<OrchestrationCommand, { type: 'session.meta.update' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotDeleted(model, command.sessionId)
  requireProviderInstance(session, command.modelSelection)

  return one(command, at, 'session.meta-updated', {
    ...titleMetadata(command, session, at),
    modelSelection: command.modelSelection,
    sessionId: command.sessionId,
    title: command.title,
    updatedAt: at,
  })
}

function requireProviderInstance(
  session: OrchestrationProjectedSession,
  selection: OrchestrationProjectedSession['modelSelection'] | undefined,
) {
  if (!selection || selection.providerInstanceId === session.modelSelection.providerInstanceId)
    return
  throw sessionDomainErrors.PROVIDER_INSTANCE_IMMUTABLE({
    sessionId: session.id,
    internal: {
      bound: session.modelSelection.providerInstanceId,
      requested: selection.providerInstanceId,
    },
  })
}

function requireDiscoveryOwner(
  session: OrchestrationProjectedSession,
  command: Extract<
    OrchestrationCommand,
    { type: 'session.discover' | 'session.discovery-metadata.update' }
  >,
) {
  requireProviderInstance(session, command.modelSelection)
  if (session.worktreeId === command.worktreeId) return
  throw sessionDomainErrors.SESSION_REPARENT_CONFLICT({
    sessionId: session.id,
    internal: { bound: session.worktreeId, requested: command.worktreeId },
  })
}

function discoveryMetadataUpdated(
  command: Extract<OrchestrationCommand, { type: 'session.discovery-metadata.update' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotDeleted(model, command.sessionId)
  requireDiscoveryOwner(session, command)
  if (session.origin !== 'discovered' || session.title === command.title) return []
  return one(command, at, 'session.discovery-metadata-updated', {
    sessionId: command.sessionId,
    title: command.title,
    sourceUpdatedAt: command.sourceUpdatedAt,
    updatedAt: at,
  })
}

/**
 * Settling is idempotent by re-emission rather than by returning nothing: the
 * engine rejects a zero-event command, and a bulk settle or a double click has
 * to stay a silent no-op instead of surfacing an error. Re-emitting the
 * original `settledAt` *and* `updatedAt` is what makes the duplicate project as
 * a no-op — a fresh timestamp would churn every ordering that reads updatedAt.
 */
function sessionSettled(
  command: Extract<OrchestrationCommand, { type: 'session.settle' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  requireSettleable(session, command.type, at, true)

  const settledAt = session.settledOverride === 'settled' ? session.settledAt : null
  const settled = event(command, at, 'session.settled', {
    settledAt: settledAt ?? at,
    acknowledgedFailureThroughSequence: Math.max(
      session.latestFailureSequence ?? 0,
      session.latestInterruptionSequence ?? 0,
    ),
    sessionId: command.sessionId,
    updatedAt: settledAt ? session.updatedAt : at,
  })
  const events = [
    ...messageQuestionDismissalEvents(
      command,
      session.id,
      pendingMessageQuestions(session.activities),
      at,
    ),
    settled,
  ]
  if (session.pinnedAt)
    events.push(event(command, at, 'session.unpinned', { sessionId: session.id, updatedAt: at }))
  if (session.snoozedUntil != null)
    events.push(
      event(command, at, 'session.unsnoozed', {
        sessionId: session.id,
        updatedAt: at,
        reason: 'user',
      }),
    )
  return events
}

function sessionUnsettled(
  command: Extract<OrchestrationCommand, { type: 'session.unsettle' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  const alreadyActive = session.settledOverride === 'active'

  return one(command, at, 'session.unsettled', {
    reason: command.reason,
    sessionId: command.sessionId,
    updatedAt: alreadyActive ? session.updatedAt : at,
  })
}

function sessionSnoozed(
  command: Extract<OrchestrationCommand, { type: 'session.snooze' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  requireFutureWakeTime(command.sessionId, command.snoozedUntil, at)
  requireSnoozable(session, command.type, at)

  // Re-snoozing to the SAME wake time is a duplicate (double click, raced
  // clients) and re-emits the original timestamps so it projects as a no-op. A
  // different wake time is a real change and stamps fresh.
  const snoozedAt = session.snoozedUntil === command.snoozedUntil ? session.snoozedAt : null

  return one(command, at, 'session.snoozed', {
    snoozedAt: snoozedAt ?? at,
    snoozedUntil: command.snoozedUntil,
    sessionId: command.sessionId,
    updatedAt: snoozedAt ? session.updatedAt : at,
  })
}

function sessionUnsnoozed(
  command: Extract<OrchestrationCommand, { type: 'session.unsnooze' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  const alreadyAwake = session.snoozedUntil == null

  return one(command, at, 'session.unsnoozed', {
    reason: command.reason,
    sessionId: command.sessionId,
    updatedAt: alreadyAwake ? session.updatedAt : at,
  })
}

/**
 * Pinning carries no lifecycle invariant — a pin only ever promotes a session,
 * so it can never hide pending work — but it is a promotion rather than an
 * override: it spends the settle and the snooze instead of silently outranking
 * them. The session is on top now, not on Tuesday.
 */
function sessionPinned(
  command: Extract<OrchestrationCommand, { type: 'session.pin' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  const pinnedAt = session.pinnedAt ?? null
  const pinned = event(command, at, 'session.pinned', {
    pinnedAt: pinnedAt ?? at,
    // A fresh pin takes the client's slot; on a re-pin the existing key wins so
    // a raced duplicate cannot move a session the user already placed.
    ...(pinnedAt || command.orderKey === undefined ? {} : { pinOrderKey: command.orderKey }),
    sessionId: command.sessionId,
    updatedAt: pinnedAt ? session.updatedAt : at,
  })

  return [pinned, ...promotionEvents(command, session, at)]
}

function promotionEvents(
  command: Extract<OrchestrationCommand, { type: 'session.pin' }>,
  session: OrchestrationProjectedSession,
  at: string,
) {
  const events: PendingOrchestrationEvent[] = []
  if (session.settledOverride === 'settled') {
    events.push(
      event(command, at, 'session.unsettled', {
        reason: 'user',
        sessionId: command.sessionId,
        updatedAt: at,
      }),
    )
  }
  if (session.snoozedUntil != null) {
    events.push(
      event(command, at, 'session.unsnoozed', {
        reason: 'user',
        sessionId: command.sessionId,
        updatedAt: at,
      }),
    )
  }

  return events
}

function sessionUnpinned(
  command: Extract<OrchestrationCommand, { type: 'session.unpin' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  const alreadyUnpinned = session.pinnedAt == null

  return one(command, at, 'session.unpinned', {
    sessionId: command.sessionId,
    updatedAt: alreadyUnpinned ? session.updatedAt : at,
  })
}

/**
 * A drag writes exactly one key to exactly one row: the client computes a
 * fractional key that sorts between the drop position's neighbours, and the
 * neighbours are never touched. Refusing an unpinned session (rather than
 * silently pinning it) keeps a reorder that raced an unpin from resurrecting
 * the pin the user just cleared.
 */
function sessionActiveReordered(
  command: Extract<OrchestrationCommand, { type: 'session.active.reorder' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  requireActiveOrderable(session)
  return one(command, at, 'session.active-reordered', {
    sessionId: command.sessionId,
    orderKey: command.orderKey,
    updatedAt: session.activeOrderKey === command.orderKey ? session.updatedAt : at,
  })
}

function sessionPinReordered(
  command: Extract<OrchestrationCommand, { type: 'session.pin.reorder' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  requirePinned(session)
  const unchanged = session.pinOrderKey === command.orderKey

  return one(command, at, 'session.pin-reordered', {
    orderKey: command.orderKey,
    sessionId: command.sessionId,
    updatedAt: unchanged ? session.updatedAt : at,
  })
}

function sessionSet(
  command: Extract<OrchestrationCommand, { type: 'session.runtime.set' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotDeleted(model, command.sessionId)
  const sessionSetEvent = event(command, at, 'session.runtime-set', {
    runtime: command.runtime,
    sessionId: command.sessionId,
  })
  const status = command.runtime.status
  const wakes = status === 'starting' || status === 'running'
  if (!wakes) return [sessionSetEvent]
  return [...settlementActivityEvents(command, session, at), sessionSetEvent]
}

/**
 * An approval or user-input request is blocked-on-you work: it must never stay
 * hidden inside a settled row.
 */
function activityAppended(
  command: Extract<OrchestrationCommand, { type: 'session.activity.append' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotDeleted(model, command.sessionId)
  const appended = event(
    command,
    at,
    'session.activity-appended',
    {
      activity: command.activity,
      sessionId: command.sessionId,
    },
    { metadata: activityEnvelopeMetadata(command.activity) },
  )
  const wakes =
    command.activity.kind === 'approval.requested' ||
    command.activity.kind === 'user-input.requested'
  if (!wakes) return [appended]
  return [...settlementActivityEvents(command, session, at), appended]
}

/**
 * Lifts the request an approval/user-input activity addresses into the event
 * envelope, so the log correlates request and response without payload
 * unpacking. Non-request activities keep an empty metadata object.
 */
function activityEnvelopeMetadata(
  activity: Extract<OrchestrationCommand, { type: 'session.activity.append' }>['activity'],
): OrchestrationEventMetadata {
  const requestId = activityRequestId(activity.payload)
  if (requestId === null) return {}

  return { requestId: v.parse(approvalRequestIdSchema, requestId) }
}

function turnStartRequested(
  command: Extract<OrchestrationCommand, { type: 'session.turn.start' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const bootstrapEvent = bootstrapSessionCreated(command, model, at)
  if (!bootstrapEvent) {
    const session = requireSessionNotArchived(model, command.sessionId, command.type)
    requireProviderInstance(session, command.modelSelection)
    requireReadyWorktree(model, session.worktreeId)
    if (
      session.latestTurn &&
      ['blocked-on-worktree', 'queued', 'claimed', 'adopted'].includes(
        session.latestTurn.providerStartState,
      )
    ) {
      throw sessionDomainErrors.START_STATE_CONFLICT({
        sessionId: command.sessionId,
        internal: {
          at: 'message-send',
          providerStartState: session.latestTurn.providerStartState,
          turnState: session.latestTurn.state,
        },
      })
    }
  }
  const messageEvent = event(command, at, 'session.message-sent', {
    attachments: command.message.attachments,
    createdAt: at,
    messageId: command.message.messageId,
    role: command.message.role,
    streaming: false,
    text: command.message.text,
    sessionId: command.sessionId,
    turnId: command.turnId,
    updatedAt: at,
  })
  const turnEvents = [
    ...userEngagementEvents(command, model.sessions.get(command.sessionId), at),
    messageEvent,
    // The turn exists because the message asked for it; without the link the
    // message→turn causal chain is unreconstructible from the log.
    event(
      command,
      at,
      'session.turn-start-requested',
      {
        createdAt: at,
        interactionMode: command.interactionMode,
        messageId: command.message.messageId,
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode,
        sourceProposedPlan: command.sourceProposedPlan,
        sessionId: command.sessionId,
        titleSeed: command.titleSeed,
        turnId: command.turnId,
      },
      { causationEventId: messageEvent.eventId },
    ),
  ]

  const source = command.sourceProposedPlan
  if (source) {
    turnEvents.push(
      event(command, at, 'session.proposed-plan-implemented', {
        sessionId: source.sessionId,
        planId: source.planId,
        implementationSessionId: command.sessionId,
        implementedAt: at,
        updatedAt: at,
      }),
    )
  }
  return bootstrapEvent ? [...bootstrapEvent, ...turnEvents] : turnEvents
}

function turnSteerRequested(
  command: Extract<OrchestrationCommand, { type: 'session.turn.steer' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSessionNotArchived(model, command.sessionId, command.type)
  if (
    session.latestTurn?.turnId !== command.turnId ||
    session.latestTurn.state !== 'running' ||
    session.latestTurn.providerStartState !== 'adopted' ||
    session.pendingApprovalCount > 0 ||
    session.pendingUserInputCount > pendingMessageQuestions(session.activities).length
  ) {
    throw sessionDomainErrors.STEER_TURN_NOT_ACTIVE({
      internal: {
        sessionId: session.id,
        latestTurnState: session.latestTurn?.state ?? null,
        pendingApprovalCount: session.pendingApprovalCount,
        pendingUserInputCount: session.pendingUserInputCount,
      },
    })
  }
  return [
    event(command, at, 'session.message-sent', {
      attachments: command.message.attachments,
      createdAt: at,
      messageId: command.message.messageId,
      role: 'user',
      streaming: false,
      text: command.message.text,
      sessionId: command.sessionId,
      turnId: command.turnId,
      updatedAt: at,
    }),
    event(command, at, 'session.turn-steer-requested', {
      createdAt: at,
      sessionId: command.sessionId,
      turnId: command.turnId,
      messageId: command.message.messageId,
    }),
  ]
}

function bootstrapSessionCreated(
  command: Extract<OrchestrationCommand, { type: 'session.turn.start' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const createSession = command.bootstrap?.createSession
  if (!createSession) return null

  const creation = creationTargetEvents(
    command,
    createSession.worktreeTarget,
    command.worktreeProvisioning,
    model,
    at,
  )
  requireSessionAbsent(model, command.sessionId)

  return [
    ...creation,
    event(command, at, 'session.created', {
      ...(createSession.agent ? { agent: createSession.agent } : {}),
      createdAt: at,
      interactionMode: createSession.interactionMode ?? DEFAULT_INTERACTION_MODE,
      modelSelection: createSession.modelSelection,
      worktreeId: createSession.worktreeTarget.worktreeId,
      origin: 'platform',
      runtimeMode: createSession.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      sessionId: command.sessionId,
      title: createSession.title,
      updatedAt: at,
    }),
  ]
}

function proposedPlanUpserted(
  command: Extract<OrchestrationCommand, { type: 'session.proposed-plan.upsert' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  requireSessionNotDeleted(model, command.sessionId)
  return [
    event(command, at, 'session.proposed-plan-upserted', {
      proposedPlan: command.proposedPlan,
      sessionId: command.sessionId,
    }),
  ]
}

function userInputResponse(
  command: Extract<OrchestrationCommand, { type: 'session.user-input.respond' }>,
  model: OrchestrationReadModel,
  at: string,
): PendingOrchestrationEvent[] {
  const session = requireSessionNotDeleted(model, command.sessionId)
  const request = pendingMessageQuestions(session.activities).find(
    (entry) => entry.payload.requestId === command.requestId,
  )
  if (!request) {
    if (command.requestId.startsWith('codex-async:'))
      throw createInternalError('This question has already been answered or dismissed.')
    return [
      ...questionAnswerHistory(command, session.activities, at),
      ...one(
        command,
        at,
        'session.user-input-response-requested',
        {
          answers: command.answers,
          attachmentsByQuestionId: command.attachmentsByQuestionId,
          createdAt: at,
          requestId: command.requestId,
          sessionId: command.sessionId,
        },
        { metadata: { requestId: command.requestId } },
      ),
    ]
  }
  const message = {
    messageId: v.parse(messageIdSchema, `async-answer:${command.requestId}`),
    role: 'user' as const,
    text: messageQuestionAnswer(request, command.answers, command.attachmentsByQuestionId),
    attachments: Object.values(command.attachmentsByQuestionId ?? {}).flat(),
  }
  const resolution = messageQuestionResolutionEvent(
    command,
    command.sessionId,
    request,
    at,
    command.answers,
    command.attachmentsByQuestionId,
  )
  if (session.latestTurn?.state === 'running') {
    return [
      resolution,
      ...turnSteerRequested(
        {
          ...command,
          type: 'session.turn.steer',
          turnId: session.latestTurn.turnId,
          message,
        },
        model,
        at,
      ),
    ]
  }
  return [
    resolution,
    ...turnStartRequested(
      {
        ...command,
        type: 'session.turn.start',
        turnId: v.parse(turnIdSchema, `async-answer:${command.requestId}`),
        message,
        runtimeMode: session.runtimeMode,
        interactionMode: session.interactionMode,
      },
      model,
      at,
    ),
  ]
}
