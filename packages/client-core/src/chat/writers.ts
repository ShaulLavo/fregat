import { retainPendingMessageQuestions } from './pending-user-input'
import {
  assistantTurnState,
  isProviderTurnFailureActivity,
  shouldRetainAfterRevert,
} from '@workspace/contracts'
import { shellItemKey } from './shell-item-key'
import { projectWorktreeEvent } from './worktree-event'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type EventId,
  type OrchestrationCheckpointSummary,
  type OrchestrationEvent,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationProposedPlan,
  type SessionRuntimeState,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  type OrchestrationSession,
  type OrchestrationSessionActivity,
  type OrchestrationSessionDetailPage,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSessionShell,
  type OrchestrationSessionStreamItem,
  type ProjectId,
  type WorktreeId,
  type OrchestrationWorktreeShell,
  type SessionId,
  type TurnId,
} from '@workspace/contracts'
import { replaceEqualDeep } from '@tanstack/query-core'

import {
  CHAT_ACTIVITY_CACHE_LIMIT,
  CHAT_CHECKPOINT_CACHE_LIMIT,
  CHAT_MESSAGE_CACHE_LIMIT,
  CHAT_PROPOSED_PLAN_CACHE_LIMIT,
} from './cache-constants'
import type { ChatProjectionSlice, ChatTurnDiffSummary, ProjectionSession } from './types'

type SessionOrchestrationEvent = Extract<OrchestrationEvent, { type: `session.${string}` }>
type WorktreeOrchestrationEvent = Extract<OrchestrationEvent, { type: `worktree.${string}` }>
type ProjectOrchestrationEvent = Extract<OrchestrationEvent, { type: `project.${string}` }>

export function syncChatProjectionShellSnapshot(
  state: ChatProjectionSlice,
  snapshot: OrchestrationShellSnapshot,
): ChatProjectionSlice {
  if (!shouldApplyShellSnapshot(state, snapshot)) return state

  const nextSessionIds = new Set(snapshot.sessions.map((session) => session.id))
  const nextState: ChatProjectionSlice = {
    ...state,
    ...projectStateFromShell(snapshot.projects),
    worktreeById: recordById(snapshot.worktrees, (worktree) => worktree.id),
    worktreeIds: snapshot.worktrees.map((worktree) => worktree.id),
    worktreeSequenceById: Object.fromEntries(
      snapshot.worktrees.map((worktree) => [worktree.id, snapshot.snapshotSequence]),
    ),
    ...retainSurvivingSessionSlices(state, nextSessionIds),
    bootstrapComplete: true,
    lastAppliedShellSequence: snapshot.snapshotSequence,
    lastShellItemKeys: null,
    lastAppliedShellUpdatedAt: snapshot.updatedAt,
    sessionIds: [...nextSessionIds],
  }

  for (const session of snapshot.sessions) {
    nextState.sessionById[session.id] = sessionFromShell(session, nextState.sessionById[session.id])
  }

  return nextState
}

export function syncChatProjectionSessionDetailSnapshot(
  state: ChatProjectionSlice,
  snapshot: OrchestrationSessionDetailSnapshot,
  mode: 'replace' | 'reconcile' = 'replace',
): ChatProjectionSlice {
  const sessionId = snapshot.session.id
  if (!shouldApplySessionDetailSnapshot(state, sessionId, snapshot.snapshotSequence)) return state

  const nextState = writeSessionDetailState(state, snapshot, mode)

  return markSessionSequence(
    markSessionHistorySequence(nextState, sessionId, snapshot.snapshotSequence),
    sessionId,
    snapshot.snapshotSequence,
  )
}

/**
 * Merges one backwards page in front of the session's timeline. Rows already held
 * are dropped rather than re-inserted, so a page that overlaps the window — a
 * boundary row read twice, a page raced against a live append — is idempotent.
 */
export function prependChatProjectionSessionDetailPage(
  state: ChatProjectionSlice,
  page: OrchestrationSessionDetailPage,
): ChatProjectionSlice {
  const sessionId = page.sessionId
  if (!state.sessionById[sessionId]) return state
  if (page.snapshotSequence < (state.sessionHistorySequenceById[sessionId] ?? 0)) return state

  const messages = prependUnheld(page.messages, selectMessages(state, sessionId), messageKey)
  const activities = prependUnheld(page.activities, selectActivities(state, sessionId), activityKey)
  const withRows = {
    ...state,
    activityBySessionId: {
      ...state.activityBySessionId,
      [sessionId]: recordById(activities, activityKey),
    },
    activityIdsBySessionId: {
      ...state.activityIdsBySessionId,
      [sessionId]: activities.map(activityKey),
    },
    messageBySessionId: {
      ...state.messageBySessionId,
      [sessionId]: recordById(messages, messageKey),
    },
    messageIdsBySessionId: {
      ...state.messageIdsBySessionId,
      [sessionId]: messages.map(messageKey),
    },
  }

  return writeSessionHasEarlier(withRows, sessionId, page.hasEarlier)
}

function prependUnheld<TValue, TKey extends string>(
  older: readonly TValue[],
  held: readonly TValue[],
  getKey: (value: TValue) => TKey,
): TValue[] {
  const heldKeys = new Set(held.map(getKey))

  return [...older.filter((value) => !heldKeys.has(getKey(value))), ...held]
}

function markSessionHistorySequence(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  sequence: number,
): ChatProjectionSlice {
  return {
    ...state,
    sessionHistorySequenceById: {
      ...state.sessionHistorySequenceById,
      [sessionId]: sequence,
    },
  }
}

function messageKey(message: OrchestrationMessage) {
  return message.id
}

function activityKey(activity: OrchestrationSessionActivity) {
  return activity.id
}

/**
 * The cache limit bounds what the live stream may grow to on its own; it must
 * not shrink a transcript the user explicitly paged back into, so an already
 * expanded session keeps its length and slides forward instead. Either way the
 * trim is recoverable: the earlier-page boundary is derived from the oldest row
 * still held, so a trimmed row is one "load earlier" away rather than lost.
 */
function boundedTail<TValue>(rows: TValue[], limit: number, heldCount: number): TValue[] {
  const max = Math.max(limit, heldCount)
  if (rows.length <= max) return rows

  return rows.slice(-max)
}

function markTrimmedFront(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  trimmedCount: number,
): ChatProjectionSlice {
  if (trimmedCount <= 0) return state

  return writeSessionHasEarlier(state, sessionId, true)
}

function writeSessionHasEarlier(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  hasEarlier: boolean,
): ChatProjectionSlice {
  if (state.sessionHasEarlierById[sessionId] === hasEarlier) return state

  return {
    ...state,
    sessionHasEarlierById: {
      ...state.sessionHasEarlierById,
      [sessionId]: hasEarlier,
    },
  }
}

/**
 * Everything a surviving session owns crosses a shell resnapshot; everything a session
 * the snapshot no longer lists owns is dropped. `sessionById` is in here because the
 * record carries facts no shell write can refresh — the arranged pin slot, and the
 * `pendingSourceProposedPlan` whose event the retained detail cursor guarantees is
 * never replayed, so wiping it would lose the plan banner until the next turn.
 */
function retainSurvivingSessionSlices(
  state: ChatProjectionSlice,
  sessionIds: ReadonlySet<SessionId>,
) {
  return {
    activityBySessionId: retainSessionScopedRecord(state.activityBySessionId, sessionIds),
    activityIdsBySessionId: retainSessionScopedRecord(state.activityIdsBySessionId, sessionIds),
    messageBySessionId: retainSessionScopedRecord(state.messageBySessionId, sessionIds),
    messageIdsBySessionId: retainSessionScopedRecord(state.messageIdsBySessionId, sessionIds),
    proposedPlanBySessionId: retainSessionScopedRecord(state.proposedPlanBySessionId, sessionIds),
    proposedPlanIdsBySessionId: retainSessionScopedRecord(
      state.proposedPlanIdsBySessionId,
      sessionIds,
    ),
    sessionById: retainSessionScopedRecord(state.sessionById, sessionIds),
    sessionDetailSequenceById: retainSessionScopedRecord(
      state.sessionDetailSequenceById,
      sessionIds,
    ),
    sessionHasEarlierById: retainSessionScopedRecord(state.sessionHasEarlierById, sessionIds),
    sessionHistorySequenceById: retainSessionScopedRecord(
      state.sessionHistorySequenceById,
      sessionIds,
    ),
    turnDiffIdsBySessionId: retainSessionScopedRecord(state.turnDiffIdsBySessionId, sessionIds),
    turnDiffSummaryBySessionId: retainSessionScopedRecord(
      state.turnDiffSummaryBySessionId,
      sessionIds,
    ),
  }
}

export function applyChatProjectionShellStreamItem(
  state: ChatProjectionSlice,
  item: OrchestrationShellStreamItem,
): ChatProjectionSlice {
  if (item.kind === 'snapshot') return syncChatProjectionShellSnapshot(state, item.snapshot)
  const key = shellItemKey(item)
  if (!shouldApplyShellSequence(state, item.sequence, key)) return state

  const nextState = applyFreshShellStreamItem(state, item)

  return {
    ...markShellSequence(nextState, item.sequence),
    lastShellItemKeys:
      item.sequence > state.lastAppliedShellSequence
        ? [key]
        : [...(state.lastShellItemKeys ?? []), key],
  }
}

export function applyChatProjectionSessionStreamItem(
  state: ChatProjectionSlice,
  item: OrchestrationSessionStreamItem,
): ChatProjectionSlice {
  if (item.kind === 'snapshot') return syncChatProjectionSessionDetailSnapshot(state, item.snapshot)

  return applyChatProjectionEvent(state, item.event)
}

export function applyChatProjectionEvents(
  state: ChatProjectionSlice,
  events: ReadonlyArray<OrchestrationEvent>,
): ChatProjectionSlice {
  let nextState = state

  for (const event of events) {
    nextState = applyChatProjectionEvent(nextState, event)
  }

  return nextState
}

export function applyChatProjectionEvent(
  state: ChatProjectionSlice,
  event: OrchestrationEvent,
): ChatProjectionSlice {
  if (isSessionOrchestrationEvent(event)) {
    return applySessionEventWithSequenceGuard(state, event)
  }

  if (isWorktreeOrchestrationEvent(event)) return applyWorktreeEvent(state, event)
  if (event.type === 'terminal.lease-updated') return state
  return applyProjectEvent(state, event)
}

function isSessionOrchestrationEvent(
  event: OrchestrationEvent,
): event is SessionOrchestrationEvent {
  return event.type.startsWith('session.')
}

function shouldApplyShellSnapshot(
  state: ChatProjectionSlice,
  snapshot: OrchestrationShellSnapshot,
) {
  if (snapshot.snapshotSequence > state.lastAppliedShellSequence) return true
  if (snapshot.snapshotSequence < state.lastAppliedShellSequence) return false

  const previousUpdatedAt = state.lastAppliedShellUpdatedAt ?? ''

  return snapshot.updatedAt > previousUpdatedAt
}

function shouldApplyShellSequence(state: ChatProjectionSlice, sequence: number, key: string) {
  if (sequence > state.lastAppliedShellSequence) return true
  if (sequence < state.lastAppliedShellSequence) return false
  return state.lastShellItemKeys !== null && !state.lastShellItemKeys.includes(key)
}

function shouldApplySessionSequence(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  sequence: number,
) {
  return sequence > (state.sessionDetailSequenceById[sessionId] ?? 0)
}

function shouldApplySessionDetailSnapshot(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  sequence: number,
) {
  const currentSequence = state.sessionDetailSequenceById[sessionId] ?? 0
  if (sequence > currentSequence) return true

  return sequence === currentSequence
}

function markShellSequence(state: ChatProjectionSlice, sequence: number): ChatProjectionSlice {
  if (sequence <= state.lastAppliedShellSequence) return state

  return {
    ...state,
    lastAppliedShellSequence: sequence,
  }
}

function markSessionSequence(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  sequence: number,
): ChatProjectionSlice {
  if (!shouldApplySessionSequence(state, sessionId, sequence)) return state

  return {
    ...state,
    sessionDetailSequenceById: {
      ...state.sessionDetailSequenceById,
      [sessionId]: sequence,
    },
  }
}

function applyFreshShellStreamItem(
  state: ChatProjectionSlice,
  item: Exclude<OrchestrationShellStreamItem, { kind: 'snapshot' }>,
): ChatProjectionSlice {
  switch (item.kind) {
    case 'project-upserted':
      return writeProject(state, item.project)
    case 'project-removed':
      return removeProject(state, item.projectId)
    case 'worktree-upserted':
      return writeWorktree(state, item.worktree, item.sequence)
    case 'worktree-removed':
      return removeWorktree(state, item.worktreeId)
    case 'session-upserted':
      return writeSessionFromShell(state, item.session)
    case 'session-removed':
      return removeSessionState(state, item.sessionId)
  }
}

function applyProjectEvent(
  state: ChatProjectionSlice,
  event: ProjectOrchestrationEvent,
): ChatProjectionSlice {
  switch (event.type) {
    case 'project.revived':
    case 'project.created':
      return writeProject(state, {
        createdAt: event.payload.createdAt,
        defaultModelSelection: event.payload.defaultModelSelection,
        id: event.payload.projectId,
        // A project is never born arranged: it sorts oldest-first at the tail
        // until the user drags it, and only `project.reordered` writes a key.
        orderKey: null,
        scripts: [],
        title: event.payload.title,
        updatedAt: event.payload.updatedAt,
        repositoryKey: event.payload.repositoryKey,
        repositoryKind: event.payload.repositoryKind,
        repositoryIdentity: event.payload.repositoryIdentity,
      })
    case 'project.meta-updated':
      return patchProject(state, event.payload.projectId, {
        defaultModelSelection: event.payload.defaultModelSelection,
        scripts: event.payload.scripts,
        title: event.payload.title,
        updatedAt: event.payload.updatedAt,
      })
    case 'project.reordered':
      return patchProject(state, event.payload.projectId, { orderKey: event.payload.orderKey })
    case 'project.deleted':
      return removeProject(state, event.payload.projectId)
    default:
      return state
  }
}

function applySessionEventWithSequenceGuard(
  state: ChatProjectionSlice,
  event: SessionOrchestrationEvent,
): ChatProjectionSlice {
  const sessionId = event.payload.sessionId
  if (!shouldApplySessionSequence(state, sessionId, event.sequence)) return state

  const nextState = applyFreshSessionEvent(state, event)

  return markSessionSequence(nextState, sessionId, event.sequence)
}

function applyFreshSessionEvent(
  state: ChatProjectionSlice,
  event: SessionOrchestrationEvent,
): ChatProjectionSlice {
  switch (event.type) {
    case 'session.created':
      return writeCreatedSession(state, event)
    case 'session.deleted':
      return removeSessionState(state, event.payload.sessionId)
    case 'session.lifecycle-restored':
      return patchSession(state, event.payload.sessionId, {
        ...event.payload.state,
        updatedAt: event.payload.updatedAt,
      })
    case 'session.archived':
      return patchSession(state, event.payload.sessionId, {
        archivedAt: event.payload.archivedAt,
        updatedAt: event.payload.updatedAt,
      })
    case 'session.unarchived':
      return patchSession(state, event.payload.sessionId, {
        archivedAt: null,
        updatedAt: event.payload.updatedAt,
      })
    case 'session.meta-updated':
      return applySessionMetaUpdatedEvent(state, event)
    case 'session.runtime-mode-set':
      return patchSession(state, event.payload.sessionId, {
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
      })
    case 'session.interaction-mode-set':
      return patchSession(state, event.payload.sessionId, {
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
      })
    case 'session.turn-start-requested':
      return applySessionTurnStartRequestedEvent(state, event)
    case 'session.turn-provider-started':
      return applySessionTurnProviderStartedEvent(state, event)
    case 'session.turn-interrupt-requested':
      return applySessionTurnInterruptRequestedEvent(state, event)
    case 'session.runtime-stop-requested':
      return applySessionRuntimeStopRequestedEvent(state, event)
    case 'session.runtime-set':
      return applySessionRuntimeSetEvent(state, event)
    case 'session.message-sent':
      return applySessionMessageSentEvent(state, event)
    case 'session.activity-appended':
      return applySessionActivityAppendedEvent(state, event)
    case 'session.proposed-plan-implemented':
      return applySessionProposedPlanImplemented(state, event)
    case 'session.proposed-plan-upserted':
      return applySessionProposedPlanUpsertedEvent(state, event)
    case 'session.turn-diff-completed':
      return applySessionTurnDiffCompletedEvent(state, event)
    case 'session.checkpoint-revert-requested':
      return state
    case 'session.reverted':
      return markSessionHistorySequence(
        applySessionRevertedEvent(state, event),
        event.payload.sessionId,
        event.sequence,
      )
    case 'session.history-imported':
      return markSessionHistorySequence(state, event.payload.sessionId, event.sequence)
    case 'session.approval-response-requested':
    case 'session.user-input-response-requested':
      return state
    case 'session.pinned':
      return writeSessionPinOrderKey(
        state,
        event.payload.sessionId,
        event.payload.pinOrderKey ?? null,
      )
    case 'session.unpinned':
      return writeSessionPinOrderKey(state, event.payload.sessionId, null)
    case 'session.pin-reordered':
      return writeSessionPinOrderKey(state, event.payload.sessionId, event.payload.orderKey)
    // Lifecycle snapshots are authoritative across the separate shell/detail streams.
    case 'session.active-reordered':
    case 'session.settled':
    case 'session.unsettled':
    case 'session.snoozed':
    case 'session.unsnoozed':
      return state
    default:
      return state
  }
}

function writeSessionPinOrderKey(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  pinOrderKey: string | null,
): ChatProjectionSlice {
  const session = state.sessionById[sessionId]
  if (!session) return state
  if (session.pinOrderKey === pinOrderKey) return state

  return {
    ...state,
    sessionById: {
      ...state.sessionById,
      [sessionId]: { ...session, pinOrderKey },
    },
  }
}

function writeProject(
  state: ChatProjectionSlice,
  project: OrchestrationProjectShell,
): ChatProjectionSlice {
  return {
    ...state,
    projectById: {
      ...state.projectById,
      [project.id]: project,
    },
    projectIds: appendId(state.projectIds, project.id),
  }
}

function patchProject(
  state: ChatProjectionSlice,
  projectId: ProjectId,
  patch: Partial<OrchestrationProjectShell>,
): ChatProjectionSlice {
  const project = state.projectById[projectId]
  if (!project) return state

  return {
    ...state,
    projectById: {
      ...state.projectById,
      [projectId]: compactUpdate(project, patch),
    },
  }
}

function removeProject(state: ChatProjectionSlice, projectId: ProjectId): ChatProjectionSlice {
  if (!state.projectById[projectId]) return state

  return {
    ...state,
    projectById: removeRecordKey(state.projectById, projectId),
    projectIds: removeId(state.projectIds, projectId),
  }
}

function writeSessionFromShell(
  state: ChatProjectionSlice,
  session: OrchestrationSessionShell,
): ChatProjectionSlice {
  const previous = state.sessionById[session.id]
  const nextState = ensureSessionRegistered(state, session.id)

  return {
    ...nextState,
    sessionById: {
      ...nextState.sessionById,
      [session.id]: sessionFromShell(session, previous),
    },
  }
}

/**
 * The shell is the whole truth for everything it publishes. The three client-only
 * facts have no shell producer, so they are carried across explicitly — a resnapshot
 * that dropped them would lose the arranged pin slot and the plan banner.
 */
function sessionFromShell(
  session: OrchestrationSessionShell,
  previous: ProjectionSession | undefined,
): ProjectionSession {
  const latestTurn = replaceEqualDeep(previous?.latestTurn, session.latestTurn)
  return {
    ...session,
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    detailSynced: previous?.detailSynced ?? false,
    pendingMessageQuestions: previous?.pendingMessageQuestions,
    turns: retainedTurns(previous, latestTurn),
    hasActionableProposedPlan: session.hasActionableProposedPlan,
    id: session.id,
    interactionMode: session.interactionMode,
    latestTurn,
    latestUserMessageAt: session.latestUserMessageAt,
    liveTurn: latestTurn,
    metaSource: 'shell',
    modelSelection: session.modelSelection,
    pendingApprovalCount: session.pendingApprovalCount,
    pendingSourceProposedPlan: carriedPendingSourcePlan(previous, session.latestTurn),
    pendingUserInputCount: session.pendingUserInputCount,
    pinOrderKey: session.pinOrderKey ?? null,
    planProgress: replaceEqualDeep(previous?.planProgress, session.planProgress),
    worktreeId: session.worktreeId,
    runtimeMode: session.runtimeMode,
    runtime: replaceEqualDeep(previous?.runtime, session.runtime),
    runtimeKnown: true,
    title: session.title,
    updatedAt: session.updatedAt,
  }
}

/**
 * Detail slices only. The shell records this used to write are shell-authoritative,
 * and the two subscriptions are independent, so a detail cached before a reconnect
 * could otherwise revert a newer branch/worktree/title/runtime. Plans and checkpoints
 * are replaced rather than merged: a snapshot is the whole truth for them, and a plan
 * resolved while disconnected leaves no event behind to remove it.
 */
function writeSessionDetailState(
  state: ChatProjectionSlice,
  snapshot: OrchestrationSessionDetailSnapshot,
  mode: 'replace' | 'reconcile',
): ChatProjectionSlice {
  const session = snapshot.session
  const hadEarlier = state.sessionHasEarlierById[session.id] ?? true
  const activities = snapshotRows({
    incoming: session.activities,
    held: mode === 'reconcile' ? selectActivities(state, session.id) : [],
    getKey: activityKey,
    hadEarlier,
    limit: CHAT_ACTIVITY_CACHE_LIMIT,
  })
  const messages = snapshotRows({
    incoming: session.messages,
    held: mode === 'reconcile' ? selectMessages(state, session.id) : [],
    getKey: messageKey,
    hadEarlier,
    limit: CHAT_MESSAGE_CACHE_LIMIT,
  })
  const activitySlice = buildActivitySlice(activities.rows)
  const messageSlice = buildMessageSlice(messages.rows)
  const planSlice = buildProposedPlanSlice(snapshot.proposedPlans)
  const turnDiffSlice = buildTurnDiffSlice(session.id, snapshot.checkpoints)

  return writeSessionHasEarlier(
    {
      ...state,
      activityBySessionId: {
        ...state.activityBySessionId,
        [session.id]: activitySlice.byId,
      },
      activityIdsBySessionId: {
        ...state.activityIdsBySessionId,
        [session.id]: activitySlice.ids,
      },
      messageBySessionId: {
        ...state.messageBySessionId,
        [session.id]: messageSlice.byId,
      },
      messageIdsBySessionId: {
        ...state.messageIdsBySessionId,
        [session.id]: messageSlice.ids,
      },
      proposedPlanBySessionId: {
        ...state.proposedPlanBySessionId,
        [session.id]: planSlice.byId,
      },
      proposedPlanIdsBySessionId: {
        ...state.proposedPlanIdsBySessionId,
        [session.id]: planSlice.ids,
      },
      sessionById: {
        ...state.sessionById,
        [session.id]: sessionFromDetail(session, state.sessionById[session.id]),
      },
      turnDiffIdsBySessionId: {
        ...state.turnDiffIdsBySessionId,
        [session.id]: turnDiffSlice.ids,
      },
      turnDiffSummaryBySessionId: {
        ...state.turnDiffSummaryBySessionId,
        [session.id]: turnDiffSlice.byId,
      },
    },
    session.id,
    activities.hasEarlier || messages.hasEarlier,
  )
}

function snapshotRows<TValue, TKey extends string>({
  incoming,
  held,
  getKey,
  hadEarlier,
  limit,
}: {
  incoming: readonly TValue[]
  held: readonly TValue[]
  getKey: (value: TValue) => TKey
  hadEarlier: boolean
  limit: number
}) {
  const first = incoming[0]
  if (!first || incoming.length < ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
    return { rows: incoming, hasEarlier: false }
  const start = held.findIndex((row) => getKey(row) === getKey(first))
  // Overlap proves continuity; without it, keeping old pages would hide a gap.
  const rows = start < 0 ? incoming : [...held.slice(0, start), ...incoming]
  const max = Math.max(limit, held.length)
  return {
    rows: rows.length > max ? rows.slice(-max) : rows,
    hasEarlier: start < 0 || hadEarlier || rows.length > max,
  }
}

/**
 * Creation is a shell fact — the session joins the rail and the project index here.
 * It arrives ahead of the shell stream on the post-dispatch replay path, which is the
 * only reason a brand new session is visible before its first shell snapshot.
 */
function writeCreatedSession(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.created' }>,
): ChatProjectionSlice {
  return writeSessionFromShell(state, {
    archivedAt: null,
    origin: event.payload.origin,
    attentionState: 'settled',
    attentionReason: null,
    hasError: false,
    acknowledgedFailureThroughSequence: null,
    settledOverride: null,
    snoozedUntil: null,
    pinnedAt: null,
    pinOrderKey: null,
    createdAt: event.payload.createdAt,
    hasActionableProposedPlan: false,
    id: event.payload.sessionId,
    interactionMode: event.payload.interactionMode ?? DEFAULT_INTERACTION_MODE,
    latestTurn: null,
    latestUserMessageAt: null,
    modelSelection: event.payload.modelSelection,
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    worktreeId: event.payload.worktreeId,
    runtimeMode: event.payload.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    runtime: null,
    title: event.payload.title,
    updatedAt: event.payload.updatedAt,
  })
}

function applySessionMetaUpdatedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.meta-updated' }>,
): ChatProjectionSlice {
  return patchSession(state, event.payload.sessionId, {
    modelSelection: event.payload.modelSelection,
    title: event.payload.title,
    titleState: event.payload.titleState,
    titleRegeneration: event.payload.titleRegeneration,
    titleGenerationError: event.payload.titleGenerationError,
    updatedAt: event.payload.updatedAt,
  })
}

function applySessionTurnStartRequestedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.turn-start-requested' }>,
): ChatProjectionSlice {
  const latestTurn: OrchestrationLatestTurn = {
    ...turnRuntimeMetadata(null),
    providerStartSequence: event.sequence,
    providerStartState:
      state.worktreeById[state.sessionById[event.payload.sessionId]?.worktreeId ?? '']?.lifecycle
        .state === 'provisioning'
        ? 'blocked-on-worktree'
        : 'queued',
    assistantMessageId: null,
    completedAt: null,
    endReason: null,
    requestedAt: event.payload.createdAt,
    sourceProposedPlan: event.payload.sourceProposedPlan,
    startedAt: null,
    state: 'running',
    turnId: event.payload.turnId,
  }

  const stamped = stampTurnModelSelection(state, event)
  const nextState = patchSession(stamped, event.payload.sessionId, {
    interactionMode: event.payload.interactionMode,
    modelSelection: event.payload.modelSelection,
    runtimeMode: event.payload.runtimeMode,
    updatedAt: event.payload.createdAt,
  })

  return writeSessionTurn(nextState, event.payload.sessionId, {
    liveTurn: latestTurn,
    pendingSourceProposedPlan: event.payload.sourceProposedPlan,
  })
}

function applySessionTurnProviderStartedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.turn-provider-started' }>,
): ChatProjectionSlice {
  const latestTurn: OrchestrationLatestTurn = {
    providerStartState: 'adopted',
    providerStartGeneration: 0,
    providerStartSequence: event.sequence,
    runtimeEpoch: event.payload.runtimeEpoch,
    assistantMessageId: null,
    completedAt: null,
    endReason: null,
    requestedAt: event.payload.createdAt,
    startedAt: event.payload.createdAt,
    state: 'running',
    turnId: event.payload.turnId,
  }

  return writeSessionTurn(state, event.payload.sessionId, {
    liveTurn: latestTurn,
    pendingSourceProposedPlan: undefined,
  })
}

/** The user message records the selection its turn ran with; absent, the session's. */
function stampTurnModelSelection(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.turn-start-requested' }>,
): ChatProjectionSlice {
  const { messageId, sessionId } = event.payload
  const messages = state.messageBySessionId[sessionId]
  const message = messages?.[messageId]
  const modelSelection =
    event.payload.modelSelection ?? state.sessionById[sessionId]?.modelSelection
  if (!messages || !message || !modelSelection) return state

  return {
    ...state,
    messageBySessionId: {
      ...state.messageBySessionId,
      [sessionId]: { ...messages, [messageId]: { ...message, modelSelection } },
    },
  }
}

function applySessionTurnInterruptRequestedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.turn-interrupt-requested' }>,
): ChatProjectionSlice {
  const session = state.sessionById[event.payload.sessionId]
  if (!event.payload.turnId || !session?.liveTurn) return state
  if (session.liveTurn.turnId !== event.payload.turnId) return state

  return writeSessionTurn(state, event.payload.sessionId, {
    liveTurn: {
      ...session.liveTurn,
      completedAt: session.liveTurn.completedAt ?? event.payload.createdAt,
      endReason: session.liveTurn.endReason ?? 'user-stop',
      startedAt: session.liveTurn.startedAt ?? event.payload.createdAt,
      state: 'interrupted',
      providerStartState: 'interrupted',
    },
    pendingSourceProposedPlan: session.pendingSourceProposedPlan,
  })
}

function applySessionRuntimeStopRequestedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.runtime-stop-requested' }>,
): ChatProjectionSlice {
  return writeSessionRuntime(state, event.payload.sessionId, null)
}

function applySessionRuntimeSetEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.runtime-set' }>,
): ChatProjectionSlice {
  const nextState = writeSessionRuntime(state, event.payload.sessionId, event.payload.runtime)

  const status = event.payload.runtime.status
  if (status !== 'running' && status !== 'waiting') return nextState
  if (event.payload.runtime.activeTurnId === null) return nextState

  const currentTurn = nextState.sessionById[event.payload.sessionId]?.liveTurn
  const activeTurnId = event.payload.runtime.activeTurnId

  return writeSessionTurn(nextState, event.payload.sessionId, {
    liveTurn: {
      ...turnRuntimeMetadata(state.sessionById[event.payload.sessionId]?.liveTurn),
      assistantMessageId:
        currentTurn?.turnId === activeTurnId ? currentTurn.assistantMessageId : null,
      completedAt: null,
      endReason: null,
      requestedAt:
        currentTurn?.turnId === activeTurnId
          ? currentTurn.requestedAt
          : event.payload.runtime.updatedAt,
      sourceProposedPlan:
        currentTurn?.turnId === activeTurnId ? currentTurn.sourceProposedPlan : undefined,
      startedAt:
        currentTurn?.turnId === activeTurnId
          ? (currentTurn.startedAt ?? event.payload.runtime.updatedAt)
          : event.payload.runtime.updatedAt,
      state: 'running',
      turnId: activeTurnId,
    },
    pendingSourceProposedPlan: undefined,
  })
}

function applySessionMessageSentEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
): ChatProjectionSlice {
  const sessionId = event.payload.sessionId
  const message = messageFromEvent(event)
  const currentIds = state.messageIdsBySessionId[sessionId] ?? []
  const currentById = state.messageBySessionId[sessionId] ?? {}
  const heldMessage = currentById[message.id]
  const nextMessage = mergeMessage(heldMessage, message)
  // The id list and the by-id record are written together by every writer in
  // this file, so record membership *is* the id-list membership test. A streamed
  // delta re-sends an id that is already held, and this runs once per token: a
  // linear `includes` over the retained transcript is the wrong instrument.
  const appendedIds = heldMessage ? currentIds : [...currentIds, message.id]
  const nextIds = boundedTail(appendedIds, CHAT_MESSAGE_CACHE_LIMIT, currentIds.length)
  const grownById = {
    ...currentById,
    [message.id]: nextMessage,
  }
  // Only a trim can drop keys, and the steady-state delta never trims — so the
  // record rebuild is paid on the rare append that crosses the cap, not per token.
  const nextById =
    nextIds.length === appendedIds.length
      ? grownById
      : retainRecordKeys(grownById, new Set(nextIds))

  const nextState = patchSession(
    markTrimmedFront(
      {
        ...state,
        messageBySessionId: {
          ...state.messageBySessionId,
          [sessionId]: nextById,
        },
        messageIdsBySessionId: {
          ...state.messageIdsBySessionId,
          [sessionId]: nextIds,
        },
      },
      sessionId,
      appendedIds.length - nextIds.length,
    ),
    sessionId,
    messageSessionPatch(event),
  )

  return writeAssistantMessageTurnState(nextState, event)
}

function messageSessionPatch(
  event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
): Partial<ProjectionSession> {
  if (event.payload.role !== 'user') return { updatedAt: event.payload.updatedAt }

  return {
    latestUserMessageAt: event.payload.createdAt,
    updatedAt: event.payload.updatedAt,
  }
}

function applySessionActivityAppendedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.activity-appended' }>,
): ChatProjectionSlice {
  const activity = {
    ...event.payload.activity,
    sequence: event.payload.activity.sequence ?? event.sequence,
  }
  const sessionId = event.payload.sessionId
  const currentIds = state.activityIdsBySessionId[sessionId] ?? []
  const currentById = state.activityBySessionId[sessionId] ?? {}
  const appended = appendActivity(currentIds, currentById, activity)
  const nextIds = boundedTail(appended.ids, CHAT_ACTIVITY_CACHE_LIMIT, currentIds.length)
  const nextById =
    nextIds.length === appended.ids.length
      ? appended.byId
      : retainRecordKeys(appended.byId, new Set(nextIds))

  return writeTurnFailureState(
    markTrimmedFront(
      {
        ...patchSession(state, sessionId, {
          updatedAt: activity.createdAt,
          pendingMessageQuestions: retainPendingMessageQuestions(
            state.sessionById[sessionId]?.pendingMessageQuestions ?? [],
            [activity],
          ),
        }),
        activityBySessionId: {
          ...state.activityBySessionId,
          [sessionId]: nextById,
        },
        activityIdsBySessionId: {
          ...state.activityIdsBySessionId,
          [sessionId]: nextIds,
        },
      },
      sessionId,
      appended.ids.length - nextIds.length,
    ),
    activity,
  )
}

/**
 * Activities arrive in `sequence` order, so the append is a tail push. The full
 * rebuild-and-sort is kept for the cases that are not a tail push — an id already
 * held (a revision), an out-of-order replay, or a snapshot row carrying no
 * `sequence` (which `compareActivities` sorts last) — so as long as the held
 * slice is already sorted, the order this produces is identical to sorting every
 * time. The slice is sorted by construction: every writer that builds it either
 * sorts or takes the server's order.
 */
function appendActivity(
  ids: readonly EventId[],
  byId: Record<EventId, OrchestrationSessionActivity>,
  activity: OrchestrationSessionActivity,
): { byId: Record<EventId, OrchestrationSessionActivity>; ids: EventId[] } {
  const lastId = ids.at(-1)
  const last = lastId ? byId[lastId] : undefined
  const isTailAppend =
    byId[activity.id] === undefined && (!last || compareActivities(last, activity) < 0)
  if (isTailAppend) {
    return {
      byId: { ...byId, [activity.id]: activity },
      ids: [...ids, activity.id],
    }
  }

  const ordered = recordValues<OrchestrationSessionActivity>({
    ...byId,
    [activity.id]: activity,
  }).sort(compareActivities)

  return {
    byId: recordById(ordered, activityKey),
    ids: ordered.map(activityKey),
  }
}

function applySessionProposedPlanUpsertedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.proposed-plan-upserted' }>,
): ChatProjectionSlice {
  const sessionId = event.payload.sessionId
  const currentById = state.proposedPlanBySessionId[sessionId] ?? {}
  const plans = recordValues<OrchestrationProposedPlan>({
    ...currentById,
    [event.payload.proposedPlan.id]: event.payload.proposedPlan,
  })
    .toSorted(compareProposedPlans)
    .slice(-CHAT_PROPOSED_PLAN_CACHE_LIMIT)

  return {
    ...patchSession(state, sessionId, {
      updatedAt: event.payload.proposedPlan.updatedAt,
    }),
    proposedPlanBySessionId: {
      ...state.proposedPlanBySessionId,
      [sessionId]: recordById(plans, (entry) => entry.id),
    },
    proposedPlanIdsBySessionId: {
      ...state.proposedPlanIdsBySessionId,
      [sessionId]: plans.map((entry) => entry.id),
    },
  }
}

function applySessionTurnDiffCompletedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.turn-diff-completed' }>,
): ChatProjectionSlice {
  const summary: ChatTurnDiffSummary = {
    assistantMessageId: event.payload.assistantMessageId,
    checkpointRef: event.payload.checkpointRef,
    checkpointTurnCount: event.payload.checkpointTurnCount,
    completedAt: event.payload.completedAt,
    files: event.payload.files,
    status: event.payload.status,
    sessionId: event.payload.sessionId,
    turnId: event.payload.turnId,
  }
  const sessionId = event.payload.sessionId
  const currentById = state.turnDiffSummaryBySessionId[sessionId] ?? {}
  const summaries = recordValues<ChatTurnDiffSummary>({
    ...currentById,
    [summary.turnId]: summary,
  })
    .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
    .slice(-CHAT_CHECKPOINT_CACHE_LIMIT)
  const nextState = {
    ...patchSession(state, sessionId, { updatedAt: event.payload.completedAt }),
    turnDiffIdsBySessionId: {
      ...state.turnDiffIdsBySessionId,
      [sessionId]: summaries.map((entry) => entry.turnId),
    },
    turnDiffSummaryBySessionId: {
      ...state.turnDiffSummaryBySessionId,
      [sessionId]: recordById(summaries, (entry) => entry.turnId),
    },
  }

  return writeSessionTurn(nextState, sessionId, {
    liveTurn: {
      ...turnRuntimeMetadata(state.sessionById[event.payload.sessionId]?.liveTurn),
      assistantMessageId: event.payload.assistantMessageId,
      completedAt: event.payload.completedAt,
      requestedAt: state.sessionById[sessionId]?.liveTurn?.requestedAt ?? event.payload.completedAt,
      startedAt: state.sessionById[sessionId]?.liveTurn?.startedAt ?? event.payload.completedAt,
      endReason: sameTurnEndReason(state.sessionById[sessionId]?.liveTurn, event.payload.turnId),
      state: checkpointStatusToLatestTurnState(event.payload.status),
      turnId: event.payload.turnId,
    },
    pendingSourceProposedPlan: undefined,
  })
}

function applySessionRevertedEvent(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.reverted' }>,
): ChatProjectionSlice {
  const sessionId = event.payload.sessionId
  const summaries = selectTurnDiffSummaries(state, sessionId)
    .filter((summary) => summary.checkpointTurnCount <= event.payload.turnCount)
    .slice(-CHAT_CHECKPOINT_CACHE_LIMIT)
  const retainedTurnIds = new Set(summaries.map((summary) => summary.turnId))
  const messages = selectMessages(state, sessionId).filter((message) =>
    shouldRetainAfterRevert(message.turnId, retainedTurnIds),
  )
  const activities = selectActivities(state, sessionId).filter((activity) =>
    shouldRetainAfterRevert(activity.turnId, retainedTurnIds),
  )
  const plans = selectProposedPlans(state, sessionId).filter((plan) =>
    shouldRetainAfterRevert(plan.turnId, retainedTurnIds),
  )
  const latestSummary = summaries.at(-1)

  return writeSessionTurn(
    {
      ...patchSession(state, sessionId, {
        updatedAt: event.payload.revertedAt,
        turns: Object.fromEntries(
          Object.entries(state.sessionById[sessionId]?.turns ?? {}).filter(([id]) =>
            retainedTurnIds.has(id as TurnId),
          ),
        ),
      }),
      activityBySessionId: {
        ...state.activityBySessionId,
        [sessionId]: recordById(activities, (entry) => entry.id),
      },
      activityIdsBySessionId: {
        ...state.activityIdsBySessionId,
        [sessionId]: activities.map((activity) => activity.id),
      },
      messageBySessionId: {
        ...state.messageBySessionId,
        [sessionId]: recordById(messages, (entry) => entry.id),
      },
      messageIdsBySessionId: {
        ...state.messageIdsBySessionId,
        [sessionId]: messages.map((message) => message.id),
      },
      proposedPlanBySessionId: {
        ...state.proposedPlanBySessionId,
        [sessionId]: recordById(plans, (entry) => entry.id),
      },
      proposedPlanIdsBySessionId: {
        ...state.proposedPlanIdsBySessionId,
        [sessionId]: plans.map((plan) => plan.id),
      },
      turnDiffIdsBySessionId: {
        ...state.turnDiffIdsBySessionId,
        [sessionId]: summaries.map((summary) => summary.turnId),
      },
      turnDiffSummaryBySessionId: {
        ...state.turnDiffSummaryBySessionId,
        [sessionId]: recordById(summaries, (summary) => summary.turnId),
      },
    },
    sessionId,
    {
      liveTurn: latestSummary ? latestTurnFromSummary(latestSummary) : null,
      pendingSourceProposedPlan: undefined,
    },
  )
}

function latestTurnFromSummary(summary: ChatTurnDiffSummary): OrchestrationLatestTurn {
  return {
    ...turnRuntimeMetadata(null),
    providerStartState: 'settled',
    assistantMessageId: summary.assistantMessageId,
    completedAt: summary.completedAt,
    endReason: null,
    requestedAt: summary.completedAt,
    startedAt: summary.completedAt,
    state: checkpointStatusToLatestTurnState(summary.status),
    turnId: summary.turnId,
  }
}

function writeSessionRuntime(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  runtime: SessionRuntimeState | null,
): ChatProjectionSlice {
  const session = state.sessionById[sessionId]
  // A runtime for a session the projection has never seen had no reader before either:
  // `selectChatSessionById` resolves nothing without a session record. Dropping it keeps
  // every record complete instead of half-born.
  if (!session) return state

  return {
    ...state,
    sessionById: {
      ...state.sessionById,
      [sessionId]: { ...session, runtime, runtimeKnown: true },
    },
  }
}

function carriedPendingSourcePlan(
  previous: ProjectionSession | undefined,
  latestTurn: OrchestrationLatestTurn | null,
) {
  if (latestTurn?.sourceProposedPlan) return latestTurn.sourceProposedPlan
  if (!previous?.pendingSourceProposedPlan) return undefined
  // Only the turn the plan was implemented by carries it. A newer turn drops it, or a
  // resolved plan would pin the session's detail subscription against eviction forever.
  if (previous.liveTurn?.turnId !== latestTurn?.turnId) return undefined

  return previous.pendingSourceProposedPlan
}

/**
 * Both fields are required on purpose. The old turn-state record was *replaced*
 * wholesale by every writer, so omitting `pendingSourceProposedPlan` cleared it and
 * nothing said so. Spreading onto one record would silently preserve it instead, so
 * the type forces each caller to state which it means.
 */
type SessionTurnWrite = {
  liveTurn: OrchestrationLatestTurn | null
  pendingSourceProposedPlan: OrchestrationLatestTurn['sourceProposedPlan'] | undefined
}

function retainedTurns(
  session: ProjectionSession | undefined,
  latest: OrchestrationLatestTurn | null,
) {
  const turns = { ...session?.turns }
  if (latest) turns[latest.turnId] = latest
  return turns
}

function writeSessionTurn(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  turn: SessionTurnWrite,
): ChatProjectionSlice {
  const session = state.sessionById[sessionId]
  if (!session) return state

  return {
    ...state,
    sessionById: {
      ...state.sessionById,
      [sessionId]: { ...session, ...turn, turns: retainedTurns(session, turn.liveTurn) },
    },
  }
}

function writeTurnFailureState(
  state: ChatProjectionSlice,
  activity: OrchestrationSessionActivity,
): ChatProjectionSlice {
  if (!isProviderTurnFailureActivity(activity.kind)) return state
  if (!activity.turnId) return state

  const session = state.sessionById[activity.sessionId]
  const latestTurn = session?.liveTurn
  if (!latestTurn) return state
  if (latestTurn.turnId !== activity.turnId) return state

  return writeSessionTurn(state, activity.sessionId, {
    liveTurn: {
      ...latestTurn,
      completedAt: latestTurn.completedAt ?? activity.createdAt,
      startedAt: latestTurn.startedAt ?? activity.createdAt,
      state: 'error',
    },
    pendingSourceProposedPlan: session.pendingSourceProposedPlan,
  })
}

function writeAssistantMessageTurnState(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
): ChatProjectionSlice {
  if (event.payload.role !== 'assistant') return state
  if (!event.payload.turnId) return state

  const sessionId = event.payload.sessionId
  const current = state.sessionById[sessionId]
  const latestTurn = current?.liveTurn
  if (latestTurn?.turnId && latestTurn.turnId !== event.payload.turnId) return state

  return writeSessionTurn(state, sessionId, {
    liveTurn: {
      ...turnRuntimeMetadata(state.sessionById[event.payload.sessionId]?.liveTurn),
      assistantMessageId: event.payload.messageId,
      completedAt: event.payload.streaming
        ? (latestTurn?.completedAt ?? null)
        : (latestTurn?.completedAt ?? event.payload.updatedAt),
      endReason: sameTurnEndReason(latestTurn, event.payload.turnId),
      requestedAt: latestTurn?.requestedAt ?? event.payload.createdAt,
      sourceProposedPlan: latestTurn?.sourceProposedPlan,
      startedAt: latestTurn?.startedAt ?? event.payload.createdAt,
      state: assistantTurnState(latestTurn?.state, !event.payload.streaming),
      turnId: event.payload.turnId,
    },
    pendingSourceProposedPlan: current?.pendingSourceProposedPlan,
  })
}

function patchSession(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  patch: Partial<ProjectionSession>,
): ChatProjectionSlice {
  const session = state.sessionById[sessionId]
  if (!session) return state

  const nextSession = compactUpdate(session, patch)
  if (nextSession === session) return state

  return {
    ...state,
    sessionById: {
      ...state.sessionById,
      [sessionId]: nextSession,
    },
  }
}

function ensureSessionRegistered(
  state: ChatProjectionSlice,
  sessionId: SessionId,
): ChatProjectionSlice {
  if (state.sessionIds.includes(sessionId)) return state
  return { ...state, sessionIds: [...state.sessionIds, sessionId] }
}

function removeSessionState(state: ChatProjectionSlice, sessionId: SessionId): ChatProjectionSlice {
  return {
    ...state,
    activityBySessionId: removeRecordKey(state.activityBySessionId, sessionId),
    activityIdsBySessionId: removeRecordKey(state.activityIdsBySessionId, sessionId),
    messageBySessionId: removeRecordKey(state.messageBySessionId, sessionId),
    messageIdsBySessionId: removeRecordKey(state.messageIdsBySessionId, sessionId),
    proposedPlanBySessionId: removeRecordKey(state.proposedPlanBySessionId, sessionId),
    proposedPlanIdsBySessionId: removeRecordKey(state.proposedPlanIdsBySessionId, sessionId),
    sessionById: removeRecordKey(state.sessionById, sessionId),
    sessionDetailSequenceById: removeRecordKey(state.sessionDetailSequenceById, sessionId),
    sessionHasEarlierById: removeRecordKey(state.sessionHasEarlierById, sessionId),
    sessionHistorySequenceById: removeRecordKey(state.sessionHistorySequenceById, sessionId),
    sessionIds: removeId(state.sessionIds, sessionId),
    turnDiffIdsBySessionId: removeRecordKey(state.turnDiffIdsBySessionId, sessionId),
    turnDiffSummaryBySessionId: removeRecordKey(state.turnDiffSummaryBySessionId, sessionId),
  }
}

function projectStateFromShell(projects: ReadonlyArray<OrchestrationProjectShell>) {
  return {
    projectById: recordById(projects, (project) => project.id),
    projectIds: projects.map((project) => project.id),
  }
}

/**
 * The detail subscription is the weaker producer. Both subscriptions run
 * independently, so a detail snapshot cached before a reconnect can land after a
 * newer shell one — it therefore fills in only what nothing authoritative has
 * published yet. `metaSource` decides the meta group all-or-nothing (never per
 * field: the shell publishes them as one row and mixing halves of two rows is how
 * a stale branch ends up next to a fresh worktree), and `runtimeKnown` decides the
 * runtime by presence, because `null` is a real runtime value.
 *
 * The session is deliberately *not* registered in `sessionIds` here: a session the
 * shell has not delivered is resolvable by id but is not a rail row.
 */
function sessionFromDetail(
  session: OrchestrationSession,
  previous: ProjectionSession | undefined,
): ProjectionSession {
  if (previous?.metaSource === 'shell') {
    return {
      ...previous,
      pendingMessageQuestions: session.pendingMessageQuestions,
      turns: session.turns,
      detailSynced: true,
      liveTurn: session.latestTurn,
      pendingSourceProposedPlan: carriedPendingSourcePlan(previous, session.latestTurn),
    }
  }

  const {
    activities: _activities,
    messages: _messages,
    deletedAt: _deletedAt,
    deletion: _deletion,
    ...shell
  } = session
  return {
    ...shell,
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    detailSynced: true,
    // Shell-only counters: nothing authoritative has published this session, so they
    // stand at their zero values and `selectChatSessionById` derives the plan flag
    // from the plans it holds instead.
    hasActionableProposedPlan: false,
    id: session.id,
    interactionMode: session.interactionMode ?? DEFAULT_INTERACTION_MODE,
    latestTurn: session.latestTurn,
    latestUserMessageAt: null,
    liveTurn: session.latestTurn,
    metaSource: 'detail',
    modelSelection: session.modelSelection,
    pendingApprovalCount: 0,
    pendingSourceProposedPlan: carriedPendingSourcePlan(previous, session.latestTurn),
    pendingUserInputCount: 0,
    pinOrderKey: session.pinOrderKey ?? null,
    planProgress: null,
    worktreeId: session.worktreeId,
    runtimeMode: session.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    runtime: previous?.runtimeKnown ? previous.runtime : session.runtime,
    runtimeKnown: previous?.runtimeKnown ?? false,
    title: session.title,
    updatedAt: session.updatedAt,
  }
}

function buildMessageSlice(messages: readonly OrchestrationMessage[]) {
  return {
    byId: recordById(messages, (message) => message.id),
    ids: messages.map((message) => message.id),
  }
}

function buildActivitySlice(activities: readonly OrchestrationSessionActivity[]) {
  return {
    byId: recordById(activities, (activity) => activity.id),
    ids: activities.map((activity) => activity.id),
  }
}

function buildProposedPlanSlice(plans: OrchestrationProposedPlan[]) {
  const orderedPlans = plans.toSorted(compareProposedPlans).slice(-CHAT_PROPOSED_PLAN_CACHE_LIMIT)

  return {
    byId: recordById(orderedPlans, (plan) => plan.id),
    ids: orderedPlans.map((plan) => plan.id),
  }
}

function buildTurnDiffSlice(sessionId: SessionId, checkpoints: OrchestrationCheckpointSummary[]) {
  const summaries = checkpoints
    .map((checkpoint): ChatTurnDiffSummary => ({ ...checkpoint, sessionId }))
    .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
    .slice(-CHAT_CHECKPOINT_CACHE_LIMIT)

  return {
    byId: recordById(summaries, (summary) => summary.turnId),
    ids: summaries.map((summary) => summary.turnId),
  }
}

function messageFromEvent(
  event: Extract<OrchestrationEvent, { type: 'session.message-sent' }>,
): OrchestrationMessage {
  return {
    attachments: event.payload.attachments,
    createdAt: event.payload.createdAt,
    id: event.payload.messageId,
    role: event.payload.role,
    streaming: event.payload.streaming,
    text: event.payload.text,
    sessionId: event.payload.sessionId,
    turnId: event.payload.turnId,
    updatedAt: event.payload.updatedAt,
  }
}

function mergeMessage(
  previous: OrchestrationMessage | undefined,
  next: OrchestrationMessage,
): OrchestrationMessage {
  if (!previous) return next

  return {
    ...previous,
    attachments: next.attachments.length > 0 ? next.attachments : previous.attachments,
    streaming: next.streaming,
    text: next.text ? `${previous.text}${next.text}` : previous.text,
    turnId: next.turnId,
    updatedAt: next.updatedAt,
  }
}

function selectMessages(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(state.messageIdsBySessionId[sessionId], state.messageBySessionId[sessionId])
}

function selectActivities(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(state.activityIdsBySessionId[sessionId], state.activityBySessionId[sessionId])
}

function selectProposedPlans(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(
    state.proposedPlanIdsBySessionId[sessionId],
    state.proposedPlanBySessionId[sessionId],
  )
}

function selectTurnDiffSummaries(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(
    state.turnDiffIdsBySessionId[sessionId],
    state.turnDiffSummaryBySessionId[sessionId],
  )
}

function collectByIds<TKey extends string, TValue>(
  ids: readonly TKey[] | undefined,
  byId: Record<TKey, TValue> | undefined,
): TValue[] {
  if (!ids || !byId) return []

  return ids.flatMap((id) => {
    const value = byId[id]
    return value ? [value] : []
  })
}

function appendId<T extends string>(ids: readonly T[], id: T): T[] {
  if (ids.includes(id)) return ids as T[]

  return [...ids, id]
}

function removeId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.filter((value) => value !== id)
}

function retainSessionScopedRecord<T>(
  record: Record<SessionId, T>,
  sessionIds: ReadonlySet<SessionId>,
): Record<SessionId, T> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([sessionId, value]) =>
      sessionIds.has(sessionId as SessionId) ? [[sessionId, value] as const] : [],
    ),
  ) as Record<SessionId, T>
}

function retainRecordKeys<TKey extends string, TValue>(
  record: Record<TKey, TValue>,
  keys: ReadonlySet<TKey>,
): Record<TKey, TValue> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) =>
      keys.has(key as TKey) ? [[key, value] as const] : [],
    ),
  ) as Record<TKey, TValue>
}

function recordValues<TValue>(record: object): TValue[] {
  return Object.values(record) as TValue[]
}

function removeRecordKey<TKey extends string, TValue>(
  record: Record<TKey, TValue>,
  key: TKey,
): Record<TKey, TValue> {
  if (!(key in record)) return record

  const nextRecord = { ...record }
  delete nextRecord[key]

  return nextRecord
}

function recordById<TValue, TKey extends string>(
  values: readonly TValue[],
  getKey: (value: TValue) => TKey,
): Record<TKey, TValue> {
  return Object.fromEntries(values.map((value) => [getKey(value), value] as const)) as Record<
    TKey,
    TValue
  >
}

function compactUpdate<T extends object>(value: T, patch: Partial<T>): T {
  const entries = Object.entries(patch).filter(([, candidate]) => candidate !== undefined)
  if (entries.length === 0) return value

  return Object.assign({ ...value }, Object.fromEntries(entries)) as T
}

function compareActivities(
  left: OrchestrationSessionActivity,
  right: OrchestrationSessionActivity,
) {
  const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER
  const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER

  return (
    leftSequence - rightSequence ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  )
}

function compareProposedPlans(left: OrchestrationProposedPlan, right: OrchestrationProposedPlan) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function checkpointStatusToLatestTurnState(status: ChatTurnDiffSummary['status']) {
  if (status === 'error') return 'error'
  if (status === 'missing') return 'interrupted'

  return 'completed'
}

function isWorktreeOrchestrationEvent(
  event: OrchestrationEvent,
): event is WorktreeOrchestrationEvent {
  return event.type.startsWith('worktree.')
}

function writeWorktree(
  state: ChatProjectionSlice,
  worktree: OrchestrationWorktreeShell,
  sequence: number,
): ChatProjectionSlice {
  return {
    ...state,
    worktreeById: { ...state.worktreeById, [worktree.id]: worktree },
    worktreeSequenceById: { ...state.worktreeSequenceById, [worktree.id]: sequence },
    worktreeIds: appendId(state.worktreeIds, worktree.id),
  }
}

function removeWorktree(state: ChatProjectionSlice, worktreeId: WorktreeId): ChatProjectionSlice {
  return {
    ...state,
    worktreeById: removeRecordKey(state.worktreeById, worktreeId),
    worktreeIds: removeId(state.worktreeIds, worktreeId),
  }
}

function applyWorktreeEvent(
  state: ChatProjectionSlice,
  event: WorktreeOrchestrationEvent,
): ChatProjectionSlice {
  if (event.sequence <= (state.worktreeSequenceById[event.payload.worktreeId] ?? 0)) return state
  const held = state.worktreeById[event.payload.worktreeId]
  const projectId = 'projectId' in event.payload ? event.payload.projectId : held?.projectId
  const kind = projectId ? state.projectById[projectId]?.repositoryKind : undefined
  if (!kind) return state
  const worktree = projectWorktreeEvent(held, event, kind)
  return worktree ? writeWorktree(state, worktree, event.sequence) : state
}

function applySessionProposedPlanImplemented(
  state: ChatProjectionSlice,
  event: Extract<OrchestrationEvent, { type: 'session.proposed-plan-implemented' }>,
): ChatProjectionSlice {
  const { sessionId, planId, implementationSessionId, implementedAt, updatedAt } = event.payload
  const plans = state.proposedPlanBySessionId[sessionId]
  const plan = plans?.[planId]
  if (!plan) return state
  return {
    ...state,
    proposedPlanBySessionId: {
      ...state.proposedPlanBySessionId,
      [sessionId]: {
        ...plans,
        [planId]: { ...plan, implementationSessionId, implementedAt, updatedAt },
      },
    },
  }
}

/** The server decides end reasons; the client only keeps one it already has for the same turn. */
function sameTurnEndReason(turn: OrchestrationLatestTurn | null | undefined, turnId: TurnId) {
  if (turn?.turnId !== turnId) return null

  return turn.endReason ?? null
}

function turnRuntimeMetadata(
  turn: OrchestrationLatestTurn | null | undefined,
): Pick<
  OrchestrationLatestTurn,
  'providerStartState' | 'providerStartGeneration' | 'providerStartSequence' | 'runtimeEpoch'
> {
  return {
    providerStartState: turn?.providerStartState ?? 'queued',
    providerStartGeneration: turn?.providerStartGeneration ?? 0,
    providerStartSequence: turn?.providerStartSequence ?? 0,
    runtimeEpoch: turn?.runtimeEpoch ?? null,
  }
}
