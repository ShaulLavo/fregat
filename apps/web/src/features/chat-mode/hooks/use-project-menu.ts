import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { selectChatSidebarSessionsForProject } from '@workspace/client-core/chat/selectors'
import { useProjectActions } from '@/features/chat-mode/hooks/use-project-actions'
import { startSessionDraft } from '@/features/chat-mode/state/session-commands'
import { useProjectRenameRequestStore } from '@/features/chat-mode/state/project-rename-request-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { projectMenu } from '@/features/chat-mode/utils/project-menu'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'
import { copyTextToClipboard } from '@/lib/clipboard'

/**
 * Built from the group rather than the raw store so the collapse item mirrors what
 * the header is actually showing — a search forces every group open, and offering
 * "Expand" over a visibly open list would be the menu disagreeing with the rail.
 */
export function useProjectMenu(group: SessionRailGroup) {
  const actions = useProjectActions()
  const scope = useSessionRailStore((state) => state.scope)
  const setScope = useSessionRailStore((state) => state.setScope)
  const toggleProjectCollapsed = useSessionRailStore((state) => state.toggleProjectCollapsed)
  const { project } = group
  // Counted across the whole project, not the group: in the archive view the band
  // lists filed sessions, but the ones "Archive All" would act on live in the inbox.
  const archivableCount = useChatProjectionStore(
    (state) =>
      selectChatSidebarSessionsForProject(
        selectChatProjectionSlice(state, project.ref.environmentId),
        project.id,
      ).length,
  )

  return projectMenu({
    archiveAllSessions: () => actions.archiveAllSessions(project.ref),
    canArchiveSessions: archivableCount > 0,
    collapsed: group.collapsed,
    copyPath: () => void copyTextToClipboard(project.workspaceRoot, 'path'),
    deleteProject: () => actions.deleteProject(project),
    newSession: () => startSessionDraft(project.ref),
    manageWorktrees: () => useWorktreeManagerStore.getState().openManager(project.ref),
    renameProject: () =>
      useProjectRenameRequestStore
        .getState()
        .requestRename({ ref: project.ref, title: project.title }),
    scopedToProject: scope === project.id,
    scopeToProject: () => setScope(project.id),
    toggleCollapsed: () => toggleProjectCollapsed(project.id),
  })
}
