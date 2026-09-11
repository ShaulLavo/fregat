import type { SessionId, WorktreeId } from '@workspace/contracts'
import { selectCurrentWorktree } from '@workspace/client-core/chat/selectors'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { memo, useCallback, useMemo, useRef, useState } from 'react'

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
  const sessions = useMemo(
    () => sidebarSessions.toSorted(compareChatSidebarSessions),
    [sidebarSessions],
  )
  const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions])
  const { activeSessionId, selectDraftSession, setActiveSessionId, promoteDraftSession } =
    useActiveChatSessionId({ sessionIds, environmentId: transport.environmentId, projectId })
  const [draftBaseId, setDraftBaseId] = useState<WorktreeId | null>(null)
  const [draftGeneration, setDraftGeneration] = useState(0)
  const currentDraftGeneration = useRef(0)
  const draftBase = useActiveChatProjection((state) => {
    if (!projectId) return undefined
    const source = draftBaseId ? state.worktreeById[draftBaseId] : undefined
    if (source?.projectId === projectId) return source
    return selectCurrentWorktree(state, projectId)
  })
  const disabled = !projectState.project || projectState.status !== 'ready'

  const handleNewChat = useCallback(() => {
    const source = sessions.find((session) => session.id === activeSessionId)
    setDraftBaseId(source?.worktreeId ?? null)
    currentDraftGeneration.current += 1
    setDraftGeneration(currentDraftGeneration.current)
    selectDraftSession()
  }, [selectDraftSession, activeSessionId, sessions])

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
      />
      {activeSessionId ? (
        <ChatView
          key={activeSessionId}
          activeSessionId={activeSessionId}
          transport={transport}
          rootPath={rootPath}
          onSessionCreated={handleSessionCreated}
        />
      ) : (
        <ChatDraftView
          disabled={disabled}
          transport={transport}
          project={projectState.project}
          key={`${transport.environmentId}:${draftBase?.id}:${draftGeneration}`}
          worktree={draftBase ?? null}
          rootPath={draftBase?.path ?? rootPath}
          onSessionCreated={handleSessionCreated}
        />
      )}
      <ChatPanelStatus
        createError={null}
        projectError={projectState.error}
        shellError={shell.error}
      />
    </div>
  )
})
