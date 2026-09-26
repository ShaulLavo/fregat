import type { EnvironmentId, ScopedSessionRef, SessionId } from './chat-ids'
import type { OrchestrationSessionShell } from './orchestration-snapshots'
import type { SettingsValues } from './settings/keys'

// One derivation for the tab's toasts and sounds and for the server's push notices.

export type SessionRailStatus =
  | 'approval'
  | 'input'
  | 'working'
  | 'monitoring'
  | 'sleeping'
  | 'failed'
  | 'ready'

export function sessionRailStatus(
  session: Pick<
    OrchestrationSessionShell,
    'pendingApprovalCount' | 'pendingUserInputCount' | 'runtime' | 'backgroundLiveness'
  > & { readonly sleepingUntil?: string | null },
): SessionRailStatus {
  if (session.pendingApprovalCount > 0) return 'approval'
  if (session.pendingUserInputCount > 0) return 'input'
  if (session.runtime?.status === 'running' || session.runtime?.status === 'starting')
    return 'working'
  if (session.backgroundLiveness) return session.backgroundLiveness
  if (session.runtime?.status === 'error') return 'failed'
  if (session.sleepingUntil) return 'sleeping'
  return 'ready'
}

export type NotificationMode = SettingsValues['chat.notificationMode']
export type NotificationSession = Pick<
  OrchestrationSessionShell,
  | 'id'
  | 'title'
  | 'archivedAt'
  | 'pendingApprovalCount'
  | 'pendingUserInputCount'
  | 'runtime'
  | 'backgroundLiveness'
  | 'sleepingUntil'
> & {
  latestTurn: Pick<
    NonNullable<OrchestrationSessionShell['latestTurn']>,
    'turnId' | 'state' | 'completedAt'
  > | null
}
export type SessionNotice = {
  ref: ScopedSessionRef
  kind: 'input' | 'completion'
  title: string
  body: string
  failed: boolean
}
export type NotificationCursor = { attention: string | null; completion: number | null }
type NotificationTransition = ReturnType<typeof sessionNotificationTransition>

export function hasNotificationSound(mode: NotificationMode) {
  return mode === 'sound' || mode === 'notifications-and-sound'
}
export function hasNativeNotifications(mode: NotificationMode) {
  return mode === 'notifications' || mode === 'notifications-and-sound'
}

export function sessionNotificationTransition(
  session: NotificationSession,
  prior?: NotificationCursor,
) {
  let status = sessionRailStatus(session)
  // A failed turn outranks a schedule the session still holds.
  if ((status === 'ready' || status === 'sleeping') && session.latestTurn?.state === 'error')
    status = 'failed'
  let attention: string | null = null
  if (status === 'input' || status === 'approval' || status === 'failed')
    attention = `${session.latestTurn?.turnId ?? ''}:${status}`
  const completedAt = Date.parse(session.latestTurn?.completedAt ?? '')
  let completion = prior?.completion ?? null
  // A session that scheduled a wake-up still finished this turn.
  if (
    (status === 'ready' || status === 'sleeping') &&
    session.latestTurn?.state === 'completed' &&
    Number.isFinite(completedAt)
  )
    completion = completedAt
  const cursor = { attention, completion }
  let kind: SessionNotice['kind'] | null = null
  if (prior && session.archivedAt === null) {
    if (attention && attention !== prior.attention) kind = 'input'
    else if (completion !== null && (prior.completion === null || completion > prior.completion))
      kind = 'completion'
  }
  return { cursor, kind, status }
}

function noticeTitle(kind: SessionNotice['kind'], status: SessionRailStatus) {
  if (kind === 'completion') return 'Session completed'
  if (status === 'approval') return 'Approval needed'
  if (status === 'failed') return 'Session failed'
  return 'Input needed'
}

/** The notice a transition announces, or null when it announces nothing. */
export function sessionNotice(
  environmentId: EnvironmentId,
  session: NotificationSession,
  transition: NotificationTransition,
): SessionNotice | null {
  if (!transition.kind) return null
  return {
    ref: { environmentId, sessionId: session.id },
    kind: transition.kind,
    title: noticeTitle(transition.kind, transition.status),
    body: session.title,
    failed: transition.status === 'failed',
  }
}

export function createSessionNotificationTracker() {
  const owners = new Map<EnvironmentId, Map<SessionId, NotificationCursor>>()
  return {
    retain(environmentIds: ReadonlySet<EnvironmentId>) {
      for (const id of owners.keys()) if (!environmentIds.has(id)) owners.delete(id)
    },
    update(
      environmentId: EnvironmentId,
      live: boolean,
      sessions: readonly NotificationSession[],
    ): SessionNotice[] {
      if (!live) {
        owners.delete(environmentId)
        return []
      }
      const previous = owners.get(environmentId)
      const next = new Map<SessionId, NotificationCursor>()
      const notices: SessionNotice[] = []
      for (const session of sessions) {
        const transition = sessionNotificationTransition(session, previous?.get(session.id))
        next.set(session.id, transition.cursor)
        const notice = sessionNotice(environmentId, session, transition)
        if (notice) notices.push(notice)
      }
      owners.set(environmentId, next)
      return notices
    },
  }
}
