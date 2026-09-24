import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { useWorkspaceChatProject } from '@/features/chat/hooks/use-workspace-chat-project'
import { selectChatSessionsForProject } from '@workspace/client-core/chat/selectors'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { ProjectDeleteDialog } from '@/features/chat-mode/components/project-delete-dialog'
import { ProjectRenameDialog } from '@/features/chat-mode/components/project-rename-dialog'
import { useProjectRetry } from '@/features/chat-mode/hooks/use-project-retry'
import { ChatRailOrderProvider } from '@/features/chat-mode/providers/rail-order-provider'
import {
  ChatModeSessionContext,
  type ChatModeSession,
} from '@/features/chat-mode/providers/session-context'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { activeSession } from '@/features/chat-mode/utils/active-session'
import { activeWorktree } from '@/features/chat-mode/utils/active-worktree'
import { comparePinnedSessions } from '@workspace/client-core/chat/rail/session-order'
import { useActiveProjectStore } from '@/features/workspace/state/active-project'

export function ChatModeSessionController({
  children,
  editorRootPath,
}: {
  readonly children: ReactNode
  /** Where the editor currently is. Chat follows it only until a project is activated. */
  readonly editorRootPath: string
}) {
  const transport = useChatTransport()
  const origin = originForQueryClient(useQueryClient())
  const shellError = useEnvironmentsStore((state) => state.entries[origin]?.lastError ?? null)
  const activeWorkspaceRoot = useActiveProjectStore((state) => state.workspaceRoot)
  const rootPath = activeWorkspaceRoot ?? editorRootPath
  const projectState = useWorkspaceChatProject({ transport, rootPath })
  const projectId = projectState.project?.id ?? null
  const projectSessions = useActiveChatProjection((state) =>
    selectChatSessionsForProject(state, projectId),
  )
  const sessions = projectSessions
    .filter((session) => !session.archivedAt)
    .toSorted(comparePinnedSessions)
  const sessionIds = sessions.map((session) => session.id)
  const archivedSessionIds = projectSessions
    .filter((session) => Boolean(session.archivedAt))
    .map((session) => session.id)
  const restored = useSessionSelectionStore((state) => state.restored)
  const selection = useSessionSelectionStore((state) => state.selection)
  const draftWorktreeId = useSessionSelectionStore((state) => state.draftWorktreeId)
  const draftWorktree = useActiveChatProjection((state) =>
    draftWorktreeId ? state.worktreeById[draftWorktreeId] : undefined,
  )
  const retry = useProjectRetry({ transport, rootPath })
  // Reuses the workspace picker already mounted by AppWorkspace: picking a folder
  // opens it, and useWorkspaceChatProject creates the project for it.
  const addProject = useEditorWorkspaceState((state) => state.openPicker)

  const resolvedSession = activeSession({
    environmentId: transport.environmentId,
    archivedSessionIds,
    projectId,
    restored,
    selection,
    sessionIds,
  })
  const selectedSession = projectSessions.find(
    (session) => session.id === resolvedSession.sessionId,
  )
  const selectedWorktree = activeWorktree({
    environmentId: transport.environmentId,
    projectId,
    selection,
    sessionWorktree: selectedSession?.worktree,
    draftWorktree,
    currentWorktree: projectState.worktree,
  })
  const value: ChatModeSession = {
    activeSession: resolvedSession,
    addProject,
    transport,
    error: chatModeError({
      hasProject: projectState.project !== null,
      projectError: projectState.error,
      retryError: retry.error,
      shellError,
    }),
    project: projectState.project,
    worktree: selectedWorktree,
    ready: projectState.status === 'ready',
    retrying: retry.retrying,
    retryProject: retry.retryProject,
    rootPath: selectedWorktree?.path ?? rootPath,
  }

  return (
    <ChatModeSessionContext value={value}>
      {/* Inside the session context, which is where the dispatching transport
          lives, and above the rail, which is the only surface that reorders. */}
      <ChatRailOrderProvider>{children}</ChatRailOrderProvider>
      <ProjectDeleteDialog />
      <ProjectRenameDialog />
    </ChatModeSessionContext>
  )
}

/**
 * A project that exists is the proof the setup failure is over, so its error stops being
 * reported — otherwise a successful retry leaves the banner from the attempt before it
 * sitting under a working chat.
 */
function chatModeError({
  hasProject,
  projectError,
  retryError,
  shellError,
}: {
  readonly hasProject: boolean
  readonly projectError: string | null
  readonly retryError: string | null
  readonly shellError: string | null
}) {
  if (hasProject) return shellError

  return retryError ?? projectError ?? shellError
}
