import { scopedSessionKey } from '@workspace/contracts'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type { SessionId } from '@workspace/contracts'

import { contextUsageForActivities } from '@workspace/client-core/chat/context-usage'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { StageBody } from '@/features/chat-mode/components/stage-body'
import { StageHeader } from '@/features/chat-mode/components/stage-header'
import { useMarkSessionSeen } from '@/features/chat-mode/hooks/use-mark-session-seen'
import { useChatModeSession } from '@/features/chat-mode/providers/session-context'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { isDraftFor } from '@/features/chat-mode/utils/active-session'
import { sessionRailItem } from '@workspace/client-core/chat/rail/model'
import { sessionCompletedAt } from '@workspace/client-core/chat/rail/unread'

const EMPTY_ACTIVITIES: readonly [] = []

export function ChatStage() {
  const { activeSession, transport, error, project, worktree, ready, rootPath, selectSession } =
    useChatModeSession()
  // Read by id rather than from the provider's list: the archive browser can put a
  // filed-away session on the stage, and that list deliberately excludes them.
  const summary = useActiveChatProjection(
    (state) => selectChatSessionById(state, activeSession.sessionId) ?? null,
  )
  const seenBySessionKey = useSessionReadStore((state) => state.seenBySessionKey)
  // Activities carry the provider's context-window snapshots, and only the detail
  // projection has them — the sidebar summary stops at the turn state.
  const activities = useActiveChatProjection(
    (state) =>
      selectChatSessionById(state, activeSession.sessionId)?.activities ?? EMPTY_ACTIVITIES,
  )
  const session = summary
    ? sessionRailItem(
        { ...summary, activityAt: summary.updatedAt },
        transport.environmentId,
        null,
        seenBySessionKey[
          scopedSessionKey({ environmentId: transport.environmentId, sessionId: summary.id })
        ],
      )
    : null

  useMarkSessionSeen(summary?.id ?? null, summary ? sessionCompletedAt(summary) : null)

  function handleSessionCreated(sessionId: SessionId) {
    if (!project) return
    // The dispatch may ack after the user has already picked something else; the
    // draft that started it is stale by then and must not win.
    if (
      !isDraftFor(
        useSessionSelectionStore.getState().selection,
        transport.environmentId,
        project.id,
      )
    )
      return

    selectSession(project.id, sessionId)
  }

  return (
    <section className='bg-background backdrop-material flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <StageHeader
        contextUsage={contextUsageForActivities(activities)}
        projectTitle={project?.title ?? null}
        session={session}
      />
      <div className='mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden'>
        <StageBody
          activeSession={activeSession}
          transport={transport}
          project={project}
          worktree={worktree}
          ready={ready}
          rootPath={rootPath}
          onSessionCreated={handleSessionCreated}
        />
      </div>
      {error ? (
        <p className='text-destructive border-border compact:px-3 compact:py-1.5 shrink-0 border-t px-4 py-2 text-[11px]'>
          {error}
        </p>
      ) : null}
    </section>
  )
}
