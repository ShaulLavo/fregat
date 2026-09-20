import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { projectSessions, removedProjectRoot } from '@/features/chat-mode/state/removal'
import { useMutation } from '@tanstack/react-query'
import { createProjectDeleteCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import {
  useProjectDeleteRequestStore,
  type ProjectDeleteRequest,
} from '@/features/chat-mode/state/project-delete-request-store'
import { clearSessionMultiSelect } from '@/features/chat-mode/state/session-commands'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { useNavigation } from '@/hooks/use-navigation'
import type { SessionRailProject } from '@workspace/client-core/chat/rail/model'
export function useProjectActions() {
  const sessionActions = useSessionActions()
  const navigation = useNavigation()
  const application = useApplicationRuntime()
  const requestDelete = useProjectDeleteRequestStore((state) => state.requestDelete)
  const dismissDelete = useProjectDeleteRequestStore((state) => state.dismissDelete)
  const failDelete = useProjectDeleteRequestStore((state) => state.failDelete)
  const remove = useMutation({
    mutationFn: async (request: ProjectDeleteRequest) => {
      for (const member of request.members) {
        const rootPath = removedProjectRoot(
          member.ref,
          application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path,
        )
        const outcome = await dispatchChatCommand({
          action: 'chat.project.delete',
          command: createProjectDeleteCommand({ projectId: member.ref.projectId }),
          dispatchCommand: (command) =>
            dispatchCommandForEnvironment(member.ref.environmentId, command),
        })
        if (!outcome.ok) throw outcome.error
        await navigation.removeProject({ ...member.ref, rootPath })
        useProjectDeleteRequestStore.setState((state) => {
          if (!state.request) return {}
          const members = state.request.members.filter(
            (pending) => pending.physicalKey !== member.physicalKey,
          )
          return {
            request: {
              ...state.request,
              members,
              sessionCount: members.reduce((sum, pending) => sum + pending.sessionCount, 0),
            },
          }
        })
      }
    },
    mutationKey: chatModeMutationKeys.projectDelete(),
    scope: { id: 'chat-project-delete' },
    onError: (error) => failDelete(error instanceof Error ? error.message : String(error)),
    onSuccess: () => {
      dismissDelete()
      clearSessionMultiSelect()
    },
  })
  return {
    archiveAllSessions(project: SessionRailProject) {
      sessionActions.archiveSessions(project.sessionRefs)
    },
    cancelDelete() {
      dismissDelete()
    },
    confirmDelete(request: ProjectDeleteRequest) {
      if (remove.isPending) return
      const unavailable = request.members.filter((member) => !member.available)
      if (unavailable.length) {
        failDelete(
          `Unavailable machines: ${unavailable.map((member) => member.label).join(', ')}. Reconnect and reopen this confirmation.`,
        )
        return
      }
      void remove.mutateAsync(request).catch(() => undefined)
    },
    deleteProject(project: SessionRailProject) {
      requestDelete({
        members: project.members.map((member) => ({
          ...member,
          sessionCount: projectSessions(member.ref).length,
        })),
        sessionCount: project.members.reduce(
          (sum, member) => sum + projectSessions(member.ref).length,
          0,
        ),
        title: project.title,
      })
    },
  }
}
