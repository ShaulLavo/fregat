import type { ScopedProjectRef } from '@workspace/contracts'
import { createProjectDeleteCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { selectChatSessionsForProject } from '@workspace/client-core/chat/selectors'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import {
  useProjectDeleteRequestStore,
  type ProjectDeleteRequest,
} from '@/features/chat-mode/state/project-delete-request-store'
import { clearSessionMultiSelect } from '@/features/chat-mode/state/session-commands'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import type { SessionRailProject } from '@workspace/client-core/chat/rail/model'
export function useProjectActions() {
  const sessionActions = useSessionActions()
  const releaseSession = useSessionSelectionStore((state) => state.releaseSession)
  const requestDelete = useProjectDeleteRequestStore((state) => state.requestDelete)
  const dismissDelete = useProjectDeleteRequestStore((state) => state.dismissDelete)
  return {
    archiveAllSessions(ref: ScopedProjectRef) {
      sessionActions.archiveSessions(
        projectSessions(ref)
          .filter((session) => !session.archivedAt)
          .map((session) => ({ environmentId: ref.environmentId, sessionId: session.id })),
      )
    },
    cancelDelete() {
      dismissDelete()
    },
    async confirmDelete(request: ProjectDeleteRequest) {
      const state = useProjectDeleteRequestStore.getState()
      if (state.pending) return
      state.beginDelete()
      const outcome = await dispatchChatCommand({
        action: 'chat.project.delete',
        command: createProjectDeleteCommand({ projectId: request.ref.projectId }),
        dispatchCommand: (command) =>
          dispatchCommandForEnvironment(request.ref.environmentId, command),
      })
      if (!outcome.ok) {
        state.failDelete(outcome.message)
        return
      }
      dismissDelete()
      for (const session of projectSessions(request.ref))
        releaseSession({ environmentId: request.ref.environmentId, sessionId: session.id }, [])
      clearSessionMultiSelect()
    },
    deleteProject(project: SessionRailProject) {
      requestDelete({
        ref: project.ref,
        sessionCount: projectSessions(project.ref).length,
        title: project.title,
      })
    },
  }
}
function projectSessions(ref: ScopedProjectRef) {
  return selectChatSessionsForProject(
    selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId),
    ref.projectId,
  )
}
