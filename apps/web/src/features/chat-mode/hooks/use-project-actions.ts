import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { projectSessions, removedProjectRoot } from '@/features/chat-mode/state/removal'
import type { ScopedProjectRef } from '@workspace/contracts'
import { createProjectDeleteCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import {
  useProjectDeleteRequestStore,
  type ProjectDeleteRequest,
} from '@/features/chat-mode/state/project-delete-request-store'
import { clearSessionMultiSelect } from '@/features/chat-mode/state/session-commands'
import { useNavigation } from '@/hooks/use-navigation'
import type { SessionRailProject } from '@workspace/client-core/chat/rail/model'
export function useProjectActions() {
  const sessionActions = useSessionActions()
  const navigation = useNavigation()
  const application = useApplicationRuntime()
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
      const rootPath = removedProjectRoot(
        request.ref,
        application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path,
      )
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
      await navigation.removeProject({ ...request.ref, rootPath })
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
