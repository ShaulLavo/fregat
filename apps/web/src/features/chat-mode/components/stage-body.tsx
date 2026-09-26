import { useEffect, useSyncExternalStore } from 'react'
import { useNavigation } from '@/hooks/use-navigation'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import type { SessionId } from '@workspace/contracts'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { ChatDraftView } from '@/features/chat/components/chat-draft-view'
import { ChatView } from '@/features/chat/components/chat-view'
import { SessionMissingState } from '@/features/chat-mode/components/session-missing-state'
import { StageEmptyState } from '@/features/chat-mode/components/stage-empty-state'
import type { ChatModeSession } from '@/features/chat-mode/providers/session-context'
import { activeSessionShowsComposer } from '@/features/chat-mode/utils/active-session'
import { useDraftMachines } from '@/features/chat-mode/hooks/use-draft-machines'

export function StageBody({
  activeSession,
  transport,
  project,
  worktree,
  ready,
  rootPath,
  onSessionCreated,
}: Pick<ChatModeSession, 'activeSession' | 'transport' | 'project' | 'worktree' | 'ready'> & {
  readonly rootPath: string
  readonly onSessionCreated: (sessionId: SessionId) => void
}) {
  const selection = useSessionSelectionStore((state) => state.selection)
  const navigation = useNavigation()
  const navigating =
    useSyncExternalStore(navigation.subscribe, navigation.getSnapshot).status === 'pending'
  const machines = useDraftMachines(
    project ? { environmentId: transport.environmentId, projectId: project.id } : null,
  )
  const draftId =
    selection.kind === 'draft' &&
    selection.environmentId === transport.environmentId &&
    selection.projectId === project?.id
      ? selection.draftId
      : null
  // A pending navigation decides where chat lands; opening a draft now would supersede it,
  // and a superseded folder switch hands the project back, which re-runs this effect.
  useEffect(() => {
    if (navigating) return
    if (draftId || !ready || !project || !worktree || !activeSessionShowsComposer(activeSession))
      return
    void navigation.openChat({
      environmentId: transport.environmentId,
      projectId: project.id,
      worktreeId: worktree.id,
      sessionId: null,
      surface: 'main',
      newDraft: true,
      replace: true,
    })
  }, [
    navigating,
    draftId,
    ready,
    project,
    worktree,
    activeSession,
    navigation,
    transport.environmentId,
  ])
  // Before anything else: with no project there is no session to resolve, and a
  // composer that cannot send is the state this screen exists to replace.
  if (!ready) return <StageEmptyState />
  if (activeSession.status === 'resolving') {
    return (
      <div className='p-4'>
        <Spinner label='Opening session' />
      </div>
    )
  }
  if (activeSession.status === 'missing') return <SessionMissingState />
  if (activeSessionShowsComposer(activeSession)) {
    if (!draftId) return <LoadingState label='Opening draft'>{null}</LoadingState>
    return (
      <ChatDraftView
        // Never disabled here: reaching this line means the project is ready, and the
        // states that are not get their own screen above.
        disabled={false}
        draftId={draftId}
        transport={transport}
        project={project}
        key={`${transport.environmentId}:${draftId}`}
        worktree={worktree}
        rootPath={rootPath}
        machines={machines}
        onSessionCreated={onSessionCreated}
      />
    )
  }

  return (
    <ChatView
      activeSessionId={activeSession.sessionId}
      transport={transport}
      key={activeSession.sessionId}
      rootPath={rootPath}
      onSessionCreated={onSessionCreated}
    />
  )
}
