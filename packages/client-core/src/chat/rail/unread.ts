import type { ProjectionSession } from '@workspace/client-core/chat/types'

/** Visit stamps belong to the scoped session, not the server's session identity alone. */
export type SessionSeenStamps = Readonly<Record<string, string>>

type SessionCompletionSource = Pick<ProjectionSession, 'latestTurn'>
type SessionWakeSource = Pick<
  ProjectionSession,
  | 'snoozedUntil'
  | 'snoozedAt'
  | 'latestTurn'
  | 'runtime'
  | 'pendingApprovalCount'
  | 'pendingUserInputCount'
  | 'settledOverride'
  | 'archivedAt'
>

export function sessionCompletedAt(session: SessionCompletionSource) {
  return session.latestTurn?.completedAt ?? null
}

export function sessionVisitAt(
  session: SessionCompletionSource & Pick<ProjectionSession, 'createdAt'>,
) {
  return sessionCompletedAt(session) ?? session.latestTurn?.requestedAt ?? session.createdAt
}

export function isSessionUnread(completedAt: string | null, seenAt: string | undefined) {
  if (!completedAt || !seenAt) return false
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(completed)) return false
  const visited = Date.parse(seenAt)
  return !Number.isFinite(visited) || completed > visited
}

export function advanceSessionVisit(previous: string | undefined, visitedAt: string) {
  const visited = Date.parse(visitedAt)
  if (!Number.isFinite(visited)) return previous
  if (previous && Date.parse(previous) >= visited) return previous
  return visitedAt
}

export function unreadSessionVisit(completedAt: string | null) {
  if (!completedAt) return null
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(completed) || completed <= -8_640_000_000_000_000) return null
  return new Date(completed - 1).toISOString()
}

export function sessionWokeAt(session: SessionWakeSource, nowMs: number): string | null {
  if (!session.snoozedUntil || !Number.isFinite(Date.parse(session.snoozedUntil))) return null
  const completedAt = sessionCompletedAt(session)
  const completedWhileSnoozed =
    session.snoozedAt != null &&
    session.latestTurn?.state === 'completed' &&
    completedAt != null &&
    Date.parse(completedAt) > Date.parse(session.snoozedAt)
  // Preserve the early trigger after the deadline so an acknowledged wake stays acknowledged.
  if (completedWhileSnoozed) return completedAt
  const failedWhileSnoozed =
    session.runtime?.status === 'error' &&
    (session.snoozedAt == null ||
      Date.parse(session.runtime.updatedAt) > Date.parse(session.snoozedAt))
  if (failedWhileSnoozed || session.pendingApprovalCount > 0 || session.pendingUserInputCount > 0) {
    return session.runtime?.updatedAt ?? session.snoozedAt ?? null
  }
  return Date.parse(session.snoozedUntil) <= nowMs ? session.snoozedUntil : null
}

export function unseenSessionWake(
  session: SessionWakeSource,
  seenAt: string | undefined,
  nowMs: number,
) {
  if (session.archivedAt || session.settledOverride === 'settled') return null
  const wokeAt = sessionWokeAt(session, nowMs)
  if (!wokeAt || !Number.isFinite(Date.parse(wokeAt))) return null
  if (seenAt && Date.parse(seenAt) >= Date.parse(wokeAt)) return null
  return wokeAt
}
