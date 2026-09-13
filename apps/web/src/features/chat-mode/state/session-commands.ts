import {
  scopedSessionKey,
  type ProjectId,
  type ScopedProjectRef,
  type ScopedWorktreeRef,
} from '@workspace/contracts'
import {
  selectCurrentWorktree,
  selectChatSessionsForProject,
  selectWorktreeAtPath,
} from '@workspace/client-core/chat/selectors'
import { activeChatProjection } from '@/features/chat/state/active-projection'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { railOrderOverrides } from '@/features/chat-mode/state/rail-order-intents'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import type { SessionClickIntent } from '@workspace/client-core/chat/rail/multi-select'
import { activeSession } from '@/features/chat-mode/utils/active-session'
import { activeWorktree } from '@/features/chat-mode/utils/active-worktree'
import { compareSessionsForRail } from '@workspace/client-core/chat/rail/session-order'
import { sessionRailModel, type SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { useActiveProjectStore } from '@/features/workspace/state/active-project'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { getNavigation } from '@/state/navigation-binding'
export type SessionTraversalDirection = 'next' | 'previous'
export type SessionOpenOptions = {
  readonly baseWorktree?: ScopedWorktreeRef
}
export async function openSessionRow(session: SessionRailItem) {
  const result = await getNavigation().openChat({
    environmentId: session.environmentId,
    sessionId: session.id,
    surface: 'main',
  })
  return result.status === 'applied'
}
export function activateSessionRow(session: SessionRailItem, intent: SessionClickIntent) {
  const multi = useSessionMultiSelectStore.getState()
  if (intent === 'toggle') {
    multi.toggle(session.ref)
    return true
  }
  if (intent === 'extend') {
    multi.extendTo(
      session.ref,
      visibleSessions().map((item) => item.ref),
    )
    return true
  }
  multi.markOnly(session.ref)
  return openSessionRow(session)
}
export function clearSessionMultiSelect() {
  useSessionMultiSelectStore.getState().clear()
}
export async function startSessionDraft(ref: ScopedProjectRef, options: SessionOpenOptions = {}) {
  const base = options.baseWorktree
  if (base && base.environmentId !== ref.environmentId) return false
  const result = await getNavigation().startDraft(ref, base?.worktreeId)
  return result.status === 'applied'
}
export function startScopedSessionDraft() {
  const projectId = useSessionRailStore.getState().scope ?? activeProjectId()
  if (!projectId) return false
  const environmentId = activeEnvironmentId()
  const { selection, restored, draftWorktreeId } = useSessionSelectionStore.getState()
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  const sessions = selectChatSessionsForProject(slice, projectId).toSorted(compareSessionsForRail)
  const resolved = activeSession({
    environmentId,
    projectId,
    selection,
    restored,
    sessionIds: sessions.filter((session) => !session.archivedAt).map((session) => session.id),
    archivedSessionIds: sessions
      .filter((session) => session.archivedAt)
      .map((session) => session.id),
  })
  const selected = resolved.sessionId ? slice.sessionById[resolved.sessionId] : null
  const worktree = activeWorktree({
    environmentId,
    projectId,
    selection,
    sessionWorktree: selected ? slice.worktreeById[selected.worktreeId] : null,
    draftWorktree: draftWorktreeId ? slice.worktreeById[draftWorktreeId] : null,
    currentWorktree: selectCurrentWorktree(slice, projectId),
  })
  if (!worktree) return false
  return startSessionDraft(
    { environmentId, projectId },
    { baseWorktree: { environmentId, worktreeId: worktree.id } },
  )
}
export function selectAdjacentSession(direction: SessionTraversalDirection) {
  const sessions = visibleSessions()
  if (!sessions.length) return false
  const index = sessions.findIndex((session) => session.key === selectedSessionKey())
  if (index < 0) return openSessionAt(sessions, direction === 'next' ? 0 : sessions.length - 1)
  const step = direction === 'next' ? 1 : -1
  return openSessionAt(sessions, (index + step + sessions.length) % sessions.length)
}
export function jumpToSession(position: number) {
  return openSessionAt(visibleSessions(), position - 1)
}
function openSessionAt(sessions: readonly SessionRailItem[], index: number) {
  const session = sessions[index]
  if (!session) return false
  useSessionMultiSelectStore.getState().markOnly(session.ref)
  return openSessionRow(session)
}
function visibleSessions() {
  const rail = useSessionRailStore.getState()
  return sessionRailModel({
    environments: currentRailEnvironments(),
    orderOverrides: railOrderOverrides(),
    query: rail.query,
    scope: rail.scope,
    machineFilter: rail.machineFilter,
    searchMatches: useSessionSearchStore.getState().matchBySessionKey,
    seenBySessionKey: useSessionReadStore.getState().seenBySessionKey,
    view: rail.view,
  }).sessions
}
function selectedSessionKey() {
  const { selection } = useSessionSelectionStore.getState()
  return selection.kind === 'session' ? scopedSessionKey(selection) : null
}
function activeProjectId(): ProjectId | null {
  const workspaceRoot = useActiveProjectStore.getState().workspaceRoot
  return workspaceRoot !== null
    ? (selectWorktreeAtPath(activeChatProjection(), workspaceRoot)?.projectId ?? null)
    : null
}
