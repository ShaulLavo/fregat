import type {
  EnvironmentId,
  ScopedSessionRef,
  SessionId,
  SettingsValues,
} from '@workspace/contracts'
import { sessionRailStatus } from './rail/status'
import type { ProjectionSession } from './types'

export type NotificationMode = SettingsValues['chat.notificationMode']
export type NotificationSession = Pick<
  ProjectionSession,
  | 'id'
  | 'title'
  | 'archivedAt'
  | 'pendingApprovalCount'
  | 'pendingUserInputCount'
  | 'runtime'
  | 'backgroundLiveness'
> & {
  latestTurn: Pick<
    NonNullable<ProjectionSession['latestTurn']>,
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
  if (status === 'ready' && session.latestTurn?.state === 'error') status = 'failed'
  let attention: string | null = null
  if (status === 'input' || status === 'approval' || status === 'failed')
    attention = `${session.latestTurn?.turnId ?? ''}:${status}`
  const completedAt = Date.parse(session.latestTurn?.completedAt ?? '')
  let completion = prior?.completion ?? null
  if (
    status === 'ready' &&
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

export function noticeTitle(
  kind: SessionNotice['kind'],
  status: ReturnType<typeof sessionRailStatus>,
) {
  if (kind === 'completion') return 'Session completed'
  if (status === 'approval') return 'Approval needed'
  if (status === 'failed') return 'Session failed'
  return 'Input needed'
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
        if (!transition.kind) continue
        notices.push({
          ref: { environmentId, sessionId: session.id },
          kind: transition.kind,
          title: noticeTitle(transition.kind, transition.status),
          body: session.title,
          failed: transition.status === 'failed',
        })
      }
      owners.set(environmentId, next)
      return notices
    },
  }
}
