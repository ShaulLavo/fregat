import { settledSessionTimestamp, sessionSortTimestamp } from './rail/session-order'
import type {
  OrchestrationLatestTurn,
  OrchestrationSessionActivity,
  OrchestrationSessionDetailAnchor,
  OrchestrationWsSessionDetailPageInput,
  OrchestrationProjectShell,
  SessionRuntimeState,
  ProjectId,
  SessionId,
  OrchestrationWorktreeShell,
  WorktreeId,
} from '@workspace/contracts'

import type { ChatProjectionSlice, ChatSession, ProjectionSession } from './types'

const EMPTY_MESSAGES: ChatSession['messages'] = []
const EMPTY_ACTIVITIES: OrchestrationSessionActivity[] = []
const EMPTY_PROJECTS: OrchestrationProjectShell[] = []
const EMPTY_WORKTREES: OrchestrationWorktreeShell[] = []
const EMPTY_PROPOSED_PLANS: ChatSession['proposedPlans'] = []
const EMPTY_SESSION_LIST: ChatSessionListProjection[] = []
const EMPTY_TURN_DIFF_SUMMARIES: ChatSession['turnDiffSummaries'] = []

const collectedByIdsCache = new WeakMap<readonly string[], WeakMap<object, readonly unknown[]>>()
const sessionCache = new WeakMap<
  ProjectionSession,
  {
    activities: ChatSession['activities']
    messages: ChatSession['messages']
    proposedPlans: ChatSession['proposedPlans']
    session: ChatSession
    turnDiffSummaries: ChatSession['turnDiffSummaries']
  }
>()

/**
 * The fields a list surface can observe from a canonical session. `liveTurn` and raw
 * `updatedAt` deliberately stay out: message deltas update both for every streamed
 * token, while the rail reads the shell-published turn and a stable activity stamp.
 */
export type ChatSessionListProjection = Pick<
  ProjectionSession,
  | 'backgroundLiveness'
  | 'archivedAt'
  | 'createdAt'
  | 'hasActionableProposedPlan'
  | 'id'
  | 'latestTurn'
  | 'latestUserMessageAt'
  | 'pendingApprovalCount'
  | 'pendingUserInputCount'
  | 'pinOrderKey'
  | 'activeOrderKey'
  | 'unsettledAt'
  | 'planProgress'
  | 'runtime'
  | 'title'
  | 'titleState'
  | 'titleRegeneration'
  | 'titleGenerationError'
  | 'worktreeId'
  | 'origin'
  | 'attentionState'
  | 'attentionReason'
  | 'hasError'
  | 'settledOverride'
  | 'settledAt'
  | 'pinnedAt'
  | 'snoozedAt'
  | 'snoozedUntil'
> & {
  readonly createdSortAt: number
  readonly updatedSortAt: number
  readonly settledOrderAt: string | null
  readonly activityAt: string
  readonly project: OrchestrationProjectShell
  readonly worktree: OrchestrationWorktreeShell
}

type ChatSessionListSelector = (state: ChatProjectionSlice) => ChatSessionListProjection[]

const sidebarSelectors = new WeakMap<ChatProjectionSlice['worktreeById'], ChatSessionListSelector>()
const allSessionSelectors = new WeakMap<
  ChatProjectionSlice['worktreeById'],
  ChatSessionListSelector
>()
const projectSidebarSelectors = new WeakMap<
  ChatProjectionSlice['worktreeById'],
  Map<ProjectId, ChatSessionListSelector>
>()
const projectSessionSelectors = new WeakMap<
  ChatProjectionSlice['worktreeById'],
  Map<ProjectId, ChatSessionListSelector>
>()

export function selectChatProjects(state: ChatProjectionSlice) {
  return collectByIds(state.projectIds, state.projectById, EMPTY_PROJECTS)
}

export function selectChatSidebarSessions(state: ChatProjectionSlice): ChatSessionListProjection[] {
  return ownerSessionListSelector(sidebarSelectors, state, false)(state)
}

export function selectChatSidebarSessionsForProject(
  state: ChatProjectionSlice,
  projectId: ProjectId | null | undefined,
): ChatSessionListProjection[] {
  if (!projectId) return EMPTY_SESSION_LIST

  return projectSessionListSelector(
    projectSidebarSelectors,
    state.worktreeById,
    projectId,
    false,
  )(state)
}

/** Every registered session, including archived rows, for the rail and command palette. */
export function selectChatSessions(state: ChatProjectionSlice): ChatSessionListProjection[] {
  return ownerSessionListSelector(allSessionSelectors, state, true)(state)
}

export function selectChatSessionsForProject(
  state: ChatProjectionSlice,
  projectId: ProjectId | null | undefined,
): ChatSessionListProjection[] {
  if (!projectId) return EMPTY_SESSION_LIST

  return projectSessionListSelector(
    projectSessionSelectors,
    state.worktreeById,
    projectId,
    true,
  )(state)
}

/**
 * Creates a selector whose result changes only when a field a list can render changes.
 * The canonical record remains the sole owner; this is a memoized read projection, not
 * another store or synchronization path.
 */
export function createChatSessionListSelector({
  includeArchived,
  projectId,
}: {
  readonly includeArchived: boolean
  readonly projectId?: ProjectId
}): ChatSessionListSelector {
  let previous = EMPTY_SESSION_LIST

  return (state) => {
    const sessionIds = state.sessionIds
    const previousById = new Map(previous.map((session) => [session.id, session]))
    const next = (sessionIds ?? []).flatMap((sessionId) => {
      const session = state.sessionById[sessionId]
      if (!session) return []
      if (!includeArchived && session.archivedAt) return []
      const worktree = state.worktreeById[session.worktreeId]
      const project = worktree && state.projectById[worktree.projectId]
      if (!worktree || !project) return []
      if (projectId && project.id !== projectId) return []
      return [sessionListProjection(session, worktree, project, previousById.get(sessionId))]
    })

    if (sameItems(previous, next)) return previous

    previous = next
    return next
  }
}

function projectSessionListSelector(
  owners: WeakMap<ChatProjectionSlice['worktreeById'], Map<ProjectId, ChatSessionListSelector>>,
  worktrees: ChatProjectionSlice['worktreeById'],
  projectId: ProjectId,
  includeArchived: boolean,
) {
  const selectors = owners.get(worktrees) ?? new Map<ProjectId, ChatSessionListSelector>()
  owners.set(worktrees, selectors)
  const held = selectors.get(projectId)
  if (held) return held

  const created = createChatSessionListSelector({ includeArchived, projectId })
  selectors.set(projectId, created)

  return created
}

function sessionListProjection(
  session: ProjectionSession,
  worktree: OrchestrationWorktreeShell,
  project: OrchestrationProjectShell,
  previous: ChatSessionListProjection | undefined,
): ChatSessionListProjection {
  const activityAt = sessionListActivityAt(session)
  if (
    previous &&
    previous.project === project &&
    previous.worktree === worktree &&
    listProjectionMatches(previous, session, activityAt)
  )
    return previous

  return {
    activityAt,
    settledOrderAt: settledSessionTimestamp(session),
    createdSortAt: sessionSortTimestamp(session, 'created_at'),
    updatedSortAt: sessionSortTimestamp(session, 'updated_at'),
    project,
    worktree,
    worktreeId: session.worktreeId,
    origin: session.origin,
    attentionState: session.attentionState,
    attentionReason: session.attentionReason,
    hasError: session.hasError,
    settledOverride: session.settledOverride,
    settledAt: session.settledAt,
    pinnedAt: session.pinnedAt,
    activeOrderKey: session.activeOrderKey,
    unsettledAt: session.unsettledAt,
    snoozedAt: session.snoozedAt,
    snoozedUntil: session.snoozedUntil,
    backgroundLiveness: session.backgroundLiveness ?? null,
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    hasActionableProposedPlan: session.hasActionableProposedPlan,
    id: session.id,
    latestTurn: session.latestTurn,
    latestUserMessageAt: session.latestUserMessageAt,
    pendingApprovalCount: session.pendingApprovalCount,
    pendingUserInputCount: session.pendingUserInputCount,
    pinOrderKey: session.pinOrderKey,
    planProgress: session.planProgress,
    runtime: session.runtime,
    title: session.title,
    titleState: session.titleState,
    titleRegeneration: session.titleRegeneration,
    titleGenerationError: session.titleGenerationError,
  }
}

function listProjectionMatches(
  previous: ChatSessionListProjection,
  session: ProjectionSession,
  activityAt: string,
) {
  return (
    previous.activityAt === activityAt &&
    previous.settledOrderAt === settledSessionTimestamp(session) &&
    previous.createdSortAt === sessionSortTimestamp(session, 'created_at') &&
    previous.updatedSortAt === sessionSortTimestamp(session, 'updated_at') &&
    previous.backgroundLiveness === (session.backgroundLiveness ?? null) &&
    previous.archivedAt === session.archivedAt &&
    previous.createdAt === session.createdAt &&
    previous.hasActionableProposedPlan === session.hasActionableProposedPlan &&
    previous.id === session.id &&
    previous.latestTurn === session.latestTurn &&
    previous.latestUserMessageAt === session.latestUserMessageAt &&
    previous.pendingApprovalCount === session.pendingApprovalCount &&
    previous.pendingUserInputCount === session.pendingUserInputCount &&
    previous.pinOrderKey === session.pinOrderKey &&
    previous.planProgress === session.planProgress &&
    previous.runtime === session.runtime &&
    previous.title === session.title &&
    previous.titleState === session.titleState &&
    previous.titleRegeneration === session.titleRegeneration &&
    previous.titleGenerationError === session.titleGenerationError &&
    previous.worktreeId === session.worktreeId &&
    previous.origin === session.origin &&
    previous.attentionState === session.attentionState &&
    previous.attentionReason === session.attentionReason &&
    previous.hasError === session.hasError &&
    previous.settledAt === session.settledAt &&
    previous.pinnedAt === session.pinnedAt &&
    previous.activeOrderKey === session.activeOrderKey &&
    previous.unsettledAt === session.unsettledAt &&
    previous.snoozedAt === session.snoozedAt &&
    previous.settledOverride === session.settledOverride &&
    previous.snoozedUntil === session.snoozedUntil
  )
}

function sessionListActivityAt(session: ProjectionSession) {
  return (
    session.latestUserMessageAt ??
    session.latestTurn?.completedAt ??
    session.latestTurn?.requestedAt ??
    session.updatedAt ??
    session.createdAt
  )
}

function sameItems(
  previous: readonly ChatSessionListProjection[],
  next: readonly ChatSessionListProjection[],
) {
  if (previous.length !== next.length) return false

  return previous.every((session, index) => session === next[index])
}

/**
 * A session with its timelines attached. The shell-versus-detail merge that used to
 * happen here now happens once, in `sessionFromDetail` — this only has to attach the
 * list slices and correct the live turn for a runtime that ended without one.
 *
 * Cached on the record's identity: this feeds zustand selectors, and a fresh object
 * per read is a re-render loop.
 */
export function selectChatSessionById(
  state: ChatProjectionSlice,
  sessionId: SessionId | null | undefined,
): ChatSession | undefined {
  if (!sessionId) return undefined

  const projected = state.sessionById[sessionId]
  if (!projected) return undefined
  const worktree = state.worktreeById[projected.worktreeId]
  const project = worktree && state.projectById[worktree.projectId]
  if (!worktree || !project) return undefined

  const messages = selectChatMessagesForSession(state, sessionId)
  const activities = selectChatActivitiesForSession(state, sessionId)
  const proposedPlans = selectChatProposedPlansForSession(state, sessionId)
  const turnDiffSummaries = selectChatTurnDiffSummariesForSession(state, sessionId)
  const cached = sessionCache.get(projected)

  if (
    cached &&
    cached.session.worktree === worktree &&
    cached.session.project === project &&
    cached.activities === activities &&
    cached.messages === messages &&
    cached.proposedPlans === proposedPlans &&
    cached.turnDiffSummaries === turnDiffSummaries
  ) {
    return cached.session
  }

  const { liveTurn, ...rest } = projected
  const session: ChatSession = {
    ...rest,
    project,
    worktree,
    activities,
    // Nothing authoritative has published the flag for a detail-only session, so the
    // plans it holds are the best answer available.
    hasActionableProposedPlan:
      projected.metaSource === 'shell'
        ? projected.hasActionableProposedPlan
        : hasOpenPlan(proposedPlans),
    latestTurn: latestTurnForSession(liveTurn, projected.runtime),
    messages,
    proposedPlans,
    turnDiffSummaries,
  }

  sessionCache.set(projected, {
    activities,
    messages,
    proposedPlans,
    session,
    turnDiffSummaries,
  })

  return session
}

function hasOpenPlan(proposedPlans: ChatSession['proposedPlans']) {
  return proposedPlans.some((plan) => !plan.implementedAt)
}

function latestTurnForSession(
  latestTurn: OrchestrationLatestTurn | null,
  runtime: SessionRuntimeState | null,
) {
  if (!latestTurn) return null
  if (latestTurn.state !== 'running') return latestTurn
  if (!runtime) return latestTurn
  if (runtime.activeTurnId && runtime.activeTurnId !== latestTurn.turnId) return latestTurn
  if (runtime.status === 'error') return terminalLatestTurn(latestTurn, runtime.updatedAt, 'error')
  if (runtime.status === 'interrupted' || runtime.status === 'stopped') {
    return terminalLatestTurn(latestTurn, runtime.updatedAt, 'interrupted')
  }

  return latestTurn
}

function terminalLatestTurn(
  latestTurn: OrchestrationLatestTurn,
  completedAt: string,
  state: 'error' | 'interrupted',
): OrchestrationLatestTurn {
  return {
    ...latestTurn,
    completedAt: latestTurn.completedAt ?? completedAt,
    startedAt: latestTurn.startedAt ?? completedAt,
    state,
  }
}

function selectChatMessagesForSession(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(
    state.messageIdsBySessionId[sessionId],
    state.messageBySessionId[sessionId],
    EMPTY_MESSAGES,
  )
}

function selectChatActivitiesForSession(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(
    state.activityIdsBySessionId[sessionId],
    state.activityBySessionId[sessionId],
    EMPTY_ACTIVITIES,
  )
}

function selectChatProposedPlansForSession(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(
    state.proposedPlanIdsBySessionId[sessionId],
    state.proposedPlanBySessionId[sessionId],
    EMPTY_PROPOSED_PLANS,
  )
}

function selectChatTurnDiffSummariesForSession(state: ChatProjectionSlice, sessionId: SessionId) {
  return collectByIds(
    state.turnDiffIdsBySessionId[sessionId],
    state.turnDiffSummaryBySessionId[sessionId],
    EMPTY_TURN_DIFF_SUMMARIES,
  )
}

/**
 * Whether a "load earlier" affordance is worth offering. An unknown session reads
 * as `true` rather than `false`: nothing held is indistinguishable from a window
 * that has not arrived yet, and offering a page that turns out to be empty is
 * recoverable where hiding reachable history is not.
 */
export function selectChatSessionHasEarlier(
  state: ChatProjectionSlice,
  sessionId: SessionId | null | undefined,
): boolean {
  if (!sessionId) return false

  return state.sessionHasEarlierById[sessionId] ?? true
}

/**
 * Builds the backwards page request from the oldest rows the store still holds,
 * so the boundary is always the caller's own edge of the timeline — a trimmed
 * cache or a replaced window re-derives it instead of stranding history behind a
 * stale server-minted cursor.
 *
 * Imperative on purpose: it mints a fresh object, so read it through
 * `getState()` when the request is made rather than subscribing to it.
 */
export function chatSessionEarlierPageInput(
  state: ChatProjectionSlice,
  sessionId: SessionId,
  // The wire type, not the schema's `InferInput`: the latter widens `sessionId`
  // back to a plain string and the transport would reject the branded id.
): OrchestrationWsSessionDetailPageInput {
  return {
    beforeActivity: anchorFrom(selectChatActivitiesForSession(state, sessionId)[0]),
    beforeMessage: anchorFrom(selectChatMessagesForSession(state, sessionId)[0]),
    sessionId,
  }
}

function anchorFrom(
  row: { createdAt: string; id: string } | undefined,
): OrchestrationSessionDetailAnchor | null {
  if (!row) return null

  return { createdAt: row.createdAt, id: row.id }
}

export function createChatSessionSelector(sessionId: SessionId | null | undefined) {
  let previousState: ChatProjectionSlice | undefined
  let previousSession: ChatSession | undefined

  return (state: ChatProjectionSlice) => {
    if (previousState === state) return previousSession

    previousState = state
    previousSession = selectChatSessionById(state, sessionId)

    return previousSession
  }
}

function collectByIds<TKey extends string, TValue>(
  ids: readonly TKey[] | undefined,
  byId: Record<TKey, TValue> | undefined,
  emptyValue: TValue[],
): TValue[] {
  if (!ids || ids.length === 0 || !byId) return emptyValue

  const cachedByRecord = collectedByIdsCache.get(ids)
  const cached = cachedByRecord?.get(byId)
  if (cached) return cached as TValue[]

  const values = ids.flatMap((id) => {
    const value = byId[id]
    return value ? [value] : []
  })
  const nextCachedByRecord = cachedByRecord ?? new WeakMap<object, readonly unknown[]>()
  nextCachedByRecord.set(byId, values)

  if (!cachedByRecord) {
    collectedByIdsCache.set(ids, nextCachedByRecord)
  }

  return values
}

export function selectChatWorktrees(
  state: ChatProjectionSlice,
): readonly OrchestrationWorktreeShell[] {
  return collectByIds(state.worktreeIds, state.worktreeById, EMPTY_WORKTREES)
}

export function selectCurrentWorktree(
  state: ChatProjectionSlice,
  projectId: ProjectId,
): OrchestrationWorktreeShell | undefined {
  return state.worktreeIds
    .map((id) => state.worktreeById[id])
    .find((worktree) => worktree?.projectId === projectId && worktree.kind === 'current')
}

export function selectWorktreeAtPath(
  state: ChatProjectionSlice,
  path: string,
): OrchestrationWorktreeShell | undefined {
  return state.worktreeIds
    .map((id) => state.worktreeById[id])
    .find((worktree) => worktree?.path === path || worktree?.canonicalPath === path)
}

export function selectSessionOwnership(state: ChatProjectionSlice, sessionId: SessionId) {
  const session = state.sessionById[sessionId]
  if (!session) return undefined
  return selectWorktreeOwnership(state, session.worktreeId)
}

export function selectWorktreeOwnership(state: ChatProjectionSlice, worktreeId: WorktreeId) {
  const worktree = state.worktreeById[worktreeId]
  const project = worktree && state.projectById[worktree.projectId]
  if (!worktree || !project) return undefined
  return { worktree, project }
}

function ownerSessionListSelector(
  cache: WeakMap<ChatProjectionSlice['worktreeById'], ChatSessionListSelector>,
  state: ChatProjectionSlice,
  includeArchived: boolean,
): ChatSessionListSelector {
  const existing = cache.get(state.worktreeById)
  if (existing) return existing
  const selector = createChatSessionListSelector({ includeArchived })
  cache.set(state.worktreeById, selector)
  return selector
}
