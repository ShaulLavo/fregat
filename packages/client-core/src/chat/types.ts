import {
  type WorktreeId,
  type OrchestrationWorktreeShell,
  type EventId,
  type MessageId,
  type OrchestrationCheckpointFile,
  type OrchestrationCheckpointStatus,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationProposedPlan,
  type OrchestrationSessionActivity,
  type OrchestrationSessionShell,
  type ProjectId,
  type ProposedPlanId,
  type SessionId,
  type TurnId,
} from '@workspace/contracts'

export type ProjectionSession = OrchestrationSessionShell & {
  pendingMessageQuestions?: readonly OrchestrationSessionActivity[]
  pinOrderKey: string | null
  detailSynced: boolean
  liveTurn: OrchestrationLatestTurn | null
  metaSource: 'shell' | 'detail'
  pendingSourceProposedPlan?: OrchestrationLatestTurn['sourceProposedPlan']
  runtimeKnown: boolean
}

export type ChatTurnDiffSummary = {
  assistantMessageId: MessageId | null
  checkpointRef: string
  checkpointTurnCount: number
  completedAt: string
  files: OrchestrationCheckpointFile[]
  status: OrchestrationCheckpointStatus
  sessionId: SessionId
  turnId: TurnId
}

/**
 * A session with its timelines attached — what the transcript renders. `latestTurn`
 * here is the *live* turn corrected for the session's terminal states, not the
 * shell-published one; `liveTurn` is therefore omitted rather than shipped alongside.
 */
export type ChatSession = Omit<ProjectionSession, 'liveTurn'> & {
  project: OrchestrationProjectShell
  worktree: OrchestrationWorktreeShell
  activities: OrchestrationSessionActivity[]
  messages: OrchestrationMessage[]
  proposedPlans: OrchestrationProposedPlan[]
  turnDiffSummaries: ChatTurnDiffSummary[]
}

export type ChatProjectionSlice = {
  activityBySessionId: Record<SessionId, Record<EventId, OrchestrationSessionActivity>>
  activityIdsBySessionId: Record<SessionId, EventId[]>
  bootstrapComplete: boolean
  lastAppliedShellSequence: number
  lastShellItemKeys: readonly string[] | null
  lastAppliedShellUpdatedAt: string | null
  messageBySessionId: Record<SessionId, Record<MessageId, OrchestrationMessage>>
  messageIdsBySessionId: Record<SessionId, MessageId[]>
  projectById: Record<ProjectId, OrchestrationProjectShell>
  projectIds: ProjectId[]
  worktreeById: Record<WorktreeId, OrchestrationWorktreeShell>
  worktreeIds: WorktreeId[]
  worktreeSequenceById: Record<WorktreeId, number>
  proposedPlanBySessionId: Record<SessionId, Record<ProposedPlanId, OrchestrationProposedPlan>>
  proposedPlanIdsBySessionId: Record<SessionId, ProposedPlanId[]>
  sessionById: Record<SessionId, ProjectionSession>
  /**
   * Whether older rows exist behind the oldest one currently held. An absent
   * entry means "not asked yet" and reads as `true`: the server's answer to the
   * first page request is what settles it, and a cap that trims the front puts
   * it back to `true` so trimmed history never becomes unreachable.
   */
  sessionHasEarlierById: Record<SessionId, boolean>
  sessionDetailSequenceById: Record<SessionId, number>
  /** Pages must be at least as recent as the last snapshot or destructive history event. */
  sessionHistorySequenceById: Record<SessionId, number>
  sessionIds: SessionId[]
  turnDiffIdsBySessionId: Record<SessionId, TurnId[]>
  turnDiffSummaryBySessionId: Record<SessionId, Record<TurnId, ChatTurnDiffSummary>>
}

export function createInitialChatProjectionSlice(): ChatProjectionSlice {
  return {
    activityBySessionId: {},
    activityIdsBySessionId: {},
    bootstrapComplete: false,
    lastAppliedShellSequence: 0,
    lastShellItemKeys: null,
    lastAppliedShellUpdatedAt: null,
    messageBySessionId: {},
    messageIdsBySessionId: {},
    projectById: {},
    projectIds: [],
    worktreeById: {},
    worktreeIds: [],
    worktreeSequenceById: {},
    proposedPlanBySessionId: {},
    proposedPlanIdsBySessionId: {},
    sessionById: {},
    sessionDetailSequenceById: {},
    sessionHistorySequenceById: {},
    sessionHasEarlierById: {},
    sessionIds: [],
    turnDiffIdsBySessionId: {},
    turnDiffSummaryBySessionId: {},
  }
}
