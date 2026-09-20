import { selectChatSessionsForProject } from '@workspace/client-core/chat/selectors'
import { compareSessionsForRail } from '@workspace/client-core/chat/rail/session-order'
import type { EnvironmentId, ProjectId, SessionId } from '@workspace/contracts'

export type SessionSelection =
  | { readonly kind: 'auto' }
  | { readonly kind: 'draft'; readonly environmentId: EnvironmentId; readonly projectId: ProjectId }
  | {
      readonly kind: 'session'
      readonly environmentId: EnvironmentId
      readonly projectId: ProjectId
      readonly sessionId: SessionId
    }

export type ActiveSession =
  /** No session picked yet: show the newest one, or the composer when there are none. */
  | { readonly status: 'auto'; readonly sessionId: SessionId | null }
  /** Explicit "new session": always the composer, even when sessions exist. */
  | { readonly status: 'draft'; readonly sessionId: null }
  /** The pick names a session the projection has not caught up to yet. */
  | { readonly status: 'resolving'; readonly sessionId: null }
  /** A remembered pick whose session is gone — deleted here, or never on this machine. */
  | { readonly status: 'missing'; readonly sessionId: null }
  | { readonly status: 'ready'; readonly sessionId: SessionId }

const NO_SESSION_IDS: readonly SessionId[] = []

/**
 * Resolves a pick against what the projection actually holds. A pick that names no
 * known session has two very different meanings and each needs its own screen:
 * `resolving` while a session this session just created makes its way through the event
 * stream, and `missing` when the pick came off disk and points at nothing. Collapsing
 * them into one spinner is what makes a deleted session look like an app that hung.
 */
export function activeSession({
  archivedSessionIds = NO_SESSION_IDS,
  environmentId,
  projectId,
  restored = false,
  selection,
  sessionIds,
}: {
  /**
   * The project's filed-away sessions. They are pickable but never auto-picked: the
   * archive browser can hand one to the stage, while an archived newest session must
   * not become the session a cold start opens onto.
   */
  readonly archivedSessionIds?: readonly SessionId[]
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId | null
  /** True while the pick is the restored one — nothing in this session has chosen yet. */
  readonly restored?: boolean
  readonly selection: SessionSelection
  readonly sessionIds: readonly SessionId[]
}): ActiveSession {
  const newest: ActiveSession = { status: 'auto', sessionId: sessionIds[0] ?? null }
  if (selection.kind === 'auto') return newest
  // Both remaining picks name a project. Nothing is loaded yet, so the pick is not
  // wrong — it is early, and dropping to the newest session here would flash a
  // conversation the user did not ask for on every cold start.
  if (!projectId) return { status: 'resolving', sessionId: null }
  // Activation is synchronous, so a pick aimed at some other project means the user has
  // since gone elsewhere — show that project's newest session instead.
  if (selection.environmentId !== environmentId || selection.projectId !== projectId) return newest
  if (selection.kind === 'draft') return { status: 'draft', sessionId: null }

  const known =
    sessionIds.includes(selection.sessionId) || archivedSessionIds.includes(selection.sessionId)
  if (known) return { status: 'ready', sessionId: selection.sessionId }
  if (restored) return { status: 'missing', sessionId: null }

  return { status: 'resolving', sessionId: null }
}

export function isDraftFor(
  selection: SessionSelection,
  environmentId: EnvironmentId,
  projectId: ProjectId,
) {
  if (selection.kind !== 'draft') return false

  return selection.environmentId === environmentId && selection.projectId === projectId
}

export function activeSessionShowsComposer(session: ActiveSession) {
  if (session.status === 'draft') return true

  return session.status === 'auto' && session.sessionId === null
}

export function activeProjectSession({
  slice,
  ...options
}: Omit<Parameters<typeof activeSession>[0], 'sessionIds' | 'archivedSessionIds' | 'projectId'> & {
  readonly slice: Parameters<typeof selectChatSessionsForProject>[0]
  readonly projectId: ProjectId
}): ActiveSession {
  const sessions = selectChatSessionsForProject(slice, options.projectId).toSorted(
    compareSessionsForRail,
  )
  return activeSession({
    ...options,
    sessionIds: sessions.filter((session) => !session.archivedAt).map((session) => session.id),
    archivedSessionIds: sessions
      .filter((session) => session.archivedAt)
      .map((session) => session.id),
  })
}
