import { timestampMs as stampMs } from './timestamp'
import type { ProjectionSession } from '@workspace/client-core/chat/types'

/** The completion stamp each session was last read at, keyed by session. */
export type SessionSeenStamps = Readonly<Record<string, string>>

type SessionCompletionSource = Pick<ProjectionSession, 'latestTurn'>

/** When the agent last stopped working on this session; null while it never has. */
export function sessionCompletedAt(session: SessionCompletionSource) {
  return session.latestTurn?.completedAt ?? null
}

/**
 * Unread means "finished while you were looking somewhere else" — the one thing the
 * four live statuses cannot say, because a session that finished an hour ago and one
 * you just read both read as idle.
 *
 * What gets stored is the completion the user actually saw, not the clock at the
 * moment they saw it: the completion comes from the server, and comparing it against
 * a client `now` turns clock skew into rows that are either permanently unread or
 * never unread at all.
 */
export function isSessionUnread(completedAt: string | null, seenAt: string | undefined) {
  if (!completedAt) return false
  if (!seenAt) return true

  return stampMs(completedAt) > stampMs(seenAt)
}
