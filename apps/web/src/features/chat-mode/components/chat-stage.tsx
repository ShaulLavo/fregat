import { useSessionRailItem } from '@/hooks/use-session-rail-item'
import { EMPTY_ACTIVITIES } from '@/lib/empty-activities'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { useNavigation } from '@/hooks/use-navigation'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type { SessionId } from '@workspace/contracts'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { contextUsageForActivities } from '@workspace/client-core/chat/context-usage'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { StageBody } from '@/features/chat-mode/components/stage-body'
import { StageHeader } from '@/features/chat-mode/components/stage-header'
import { useMarkSessionSeen } from '@/features/chat-mode/hooks/use-mark-session-seen'
import { useChatModeSession } from '@/features/chat-mode/providers/session-context'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { isDraftFor } from '@/features/chat-mode/utils/active-session'
import { sessionVisitAt } from '@workspace/client-core/chat/rail/unread'

export function ChatStage() {
  const navigation = useNavigation()
  const application = useApplicationRuntime()
  const draftGeneration = useSessionSelectionStore((state) => state.draftGeneration)
  const { activeSession, transport, error, project, worktree, ready, rootPath } =
    useChatModeSession()
  // Read by id rather than from the provider's list: the archive browser can put a
  // filed-away session on the stage, and that list deliberately excludes them.
  const summary = useActiveChatProjection(
    (state) => selectChatSessionById(state, activeSession.sessionId) ?? null,
  )
  // Activities carry the provider's context-window snapshots, and only the detail
  // projection has them — the sidebar summary stops at the turn state.
  const activities = useActiveChatProjection(
    (state) =>
      selectChatSessionById(state, activeSession.sessionId)?.activities ?? EMPTY_ACTIVITIES,
  )
  const session = useSessionRailItem(summary, transport.environmentId)

  useMarkSessionSeen(summary?.id ?? null, summary ? sessionVisitAt(summary) : null)

  function handleSessionCreated(sessionId: SessionId) {
    if (!project) return
    const current = useSessionSelectionStore.getState()
    if (current.draftGeneration !== draftGeneration) return
    const draft = isDraftFor(current.selection, transport.environmentId, project.id)
    const empty =
      current.selection.kind === 'auto' &&
      activeSession.status === 'auto' &&
      activeSession.sessionId === null
    if (!draft && !empty) return
    const owner = application.getSnapshot()
    if (owner?.origin !== confirmedEnvironmentOrigin(transport.environmentId)) return
    if (owner.editor.workspaceStore.getState().rootFolder?.path !== rootPath) return

    void navigation.openChat({
      environmentId: transport.environmentId,
      projectId: project.id,
      sessionId,
      surface: 'main',
      replace: true,
    })
  }

  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <StageHeader
        contextUsage={contextUsageForActivities(activities)}
        projectTitle={project?.title ?? null}
        session={session}
      />
      <div className='mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden'>
        <RenderErrorBoundary
          label='This session'
          resetKeys={[activeSession.status, activeSession.sessionId]}
        >
          <StageBody
            activeSession={activeSession}
            transport={transport}
            project={project}
            worktree={worktree}
            ready={ready}
            rootPath={rootPath}
            onSessionCreated={handleSessionCreated}
          />
        </RenderErrorBoundary>
      </div>
      {error ? (
        <p className='text-destructive text-2xs shrink-0 px-(--density-section-padding) py-(--density-section-gap)'>
          {error}
        </p>
      ) : null}
    </section>
  )
}
