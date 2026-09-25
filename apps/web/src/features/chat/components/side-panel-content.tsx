import { useChatInputDraftStore } from '../state/chat-input-draft-store'
import { useSidebarSelectionStore } from '../state/sidebar-selection-store'
import { useNavigation } from '@/hooks/use-navigation'
import { LoadingState } from '@workspace/ui/components/loading-state'
import type { SessionId, WorktreeId } from '@workspace/contracts'
import { selectChatSessionById, selectCurrentWorktree } from '@workspace/client-core/chat/selectors'
import { useSessionRailItem } from '@/hooks/use-session-rail-item'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { memo, useEffect, useRef, useState } from 'react'

import { useActiveChatSessionId } from '../hooks/use-active-chat-session-id'
import { useChatShellSubscription } from '../hooks/use-chat-shell-subscription'
import { useWorkspaceChatProject } from '../hooks/use-workspace-chat-project'
import { compareChatSidebarSessions } from '@/features/chat/utils/formatters'
import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { selectChatSidebarSessionsForProject } from '@workspace/client-core/chat/selectors'
import { ChatPanelHeader } from './chat-panel-header'
import { ChatPanelStatus } from './chat-panel-status'
import { ChatDraftView } from './chat-draft-view'
import { ChatView } from './chat-view'

export const ChatSidePanelContent = memo(({ rootPath }: { rootPath: string }) => {
  const transport = useChatTransport()
  const shell = useChatShellSubscription(transport)
  const projectState = useWorkspaceChatProject({ transport, rootPath })
  const projectId = projectState.project?.id
  const sidebarSessions = useActiveChatProjection((state) =>
    selectChatSidebarSessionsForProject(state, projectId),
  )
  const sessions = sidebarSessions.toSorted(compareChatSidebarSessions)
  const sessionIds = sessions.map((session) => session.id)
  const { activeSessionId, selectDraftSession, setActiveSessionId, promoteDraftSession } =
    useActiveChatSessionId({ sessionIds, environmentId: transport.environmentId, projectId })
  const selection = useSidebarSelectionStore((state) => state.selection)
  const activeSummary = useActiveChatProjection(
    (state) => selectChatSessionById(state, activeSessionId) ?? null,
  )
  const activeRailItem = useSessionRailItem(activeSummary, transport.environmentId)
  const restoredDraft = useChatInputDraftStore((state) =>
    selection.kind === 'draft' && selection.draftId
      ? Object.entries(state.draftsByKey).find(
          ([key, draft]) =>
            key.startsWith(`${transport.environmentId}:`) &&
            draft.identity?.id === selection.draftId,
        )?.[1]
      : undefined,
  )
  const [draftBaseId, setDraftBaseId] = useState<WorktreeId | null>(null)
  const [draftGeneration, setDraftGeneration] = useState(0)
  const currentDraftGeneration = useRef(0)
  const draftBase = useActiveChatProjection((state) => {
    if (!projectId) return undefined
    const baseId = restoredDraft?.identity?.baseWorktreeId ?? draftBaseId
    const source = baseId ? state.worktreeById[baseId] : undefined
    if (baseId) return source?.projectId === projectId ? source : undefined
    return selectCurrentWorktree(state, projectId)
  })
  const navigation = useNavigation()
  const draftId =
    selection.kind === 'draft' &&
    selection.environmentId === transport.environmentId &&
    selection.projectId === projectId
      ? selection.draftId
      : null
  useEffect(() => {
    if (activeSessionId || draftId || !projectId || !draftBase) return
    void navigation.openChat({
      environmentId: transport.environmentId,
      projectId,
      sessionId: null,
      surface: 'sidebar',
      newDraft: true,
      replace: true,
    })
  }, [activeSessionId, draftId, projectId, draftBase, navigation, transport.environmentId])
  const disabled = !projectState.project || projectState.status !== 'ready'

  const handleNewChat = () => {
    const source = sessions.find((session) => session.id === activeSessionId)
    setDraftBaseId(source?.worktreeId ?? null)
    currentDraftGeneration.current += 1
    setDraftGeneration(currentDraftGeneration.current)
    selectDraftSession()
  }

  function handleSessionCreated(sessionId: SessionId) {
    if (draftGeneration !== currentDraftGeneration.current) return
    promoteDraftSession(sessionId)
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <ChatPanelHeader
        activeSessionId={activeSessionId}
        creating={false}
        disabled={disabled}
        sessions={sessions}
        onNewChat={handleNewChat}
        onSelectSession={setActiveSessionId}
        session={activeRailItem}
      />
      {activeSessionId ? (
        <ChatView
          key={activeSessionId}
          activeSessionId={activeSessionId}
          transport={transport}
          rootPath={rootPath}
          onSessionCreated={handleSessionCreated}
        />
      ) : draftId ? (
        <ChatDraftView
          disabled={disabled}
          draftId={draftId}
          transport={transport}
          project={projectState.project}
          key={`${transport.environmentId}:${draftId}`}
          worktree={draftBase ?? null}
          rootPath={restoredDraft?.identity?.rootPath ?? draftBase?.path ?? rootPath}
          onSessionCreated={handleSessionCreated}
        />
      ) : (
        <LoadingState label='Opening draft'>{null}</LoadingState>
      )}
      <ChatPanelStatus
        createError={null}
        projectError={projectState.error}
        shellError={shell.error}
      />
    </div>
  )
})
