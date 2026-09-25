import {
  sessionNotice,
  sessionNotificationTransition,
  type EnvironmentId,
  type NotificationCursor,
  type OrchestrationShellStreamFrame,
  type SessionId,
  type SessionNotice,
  type WorktreeId,
} from '@workspace/contracts'

export type FedNotice = { readonly notice: SessionNotice; readonly worktreeId: WorktreeId }

/**
 * Reads one shell stream the way the tab does: the snapshot and any catch-up before
 * `synchronized` set the baseline silently, and only live changes announce.
 */
export function createSessionNoticeFeed(environmentId: EnvironmentId) {
  const cursors = new Map<SessionId, NotificationCursor>()
  let live = false

  return {
    accept(frame: OrchestrationShellStreamFrame): FedNotice | null {
      if (frame.kind === 'synchronized') {
        live = true
        return null
      }
      if (frame.kind === 'snapshot') {
        cursors.clear()
        for (const session of frame.snapshot.sessions)
          cursors.set(session.id, sessionNotificationTransition(session).cursor)
        return null
      }
      if (frame.kind === 'session-removed') {
        cursors.delete(frame.sessionId)
        return null
      }
      if (frame.kind !== 'session-upserted') return null

      const { session } = frame
      const transition = sessionNotificationTransition(session, cursors.get(session.id))
      cursors.set(session.id, transition.cursor)
      const notice = live ? sessionNotice(environmentId, session, transition) : null
      return notice ? { notice, worktreeId: session.worktreeId } : null
    },
  }
}
