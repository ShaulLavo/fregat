import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import { useProjectActions } from '@/features/chat-mode/hooks/use-project-actions'
import { startSessionDraft } from '@/features/chat-mode/state/session-commands'
import { useProjectRenameRequestStore } from '@/features/chat-mode/state/project-rename-request-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { projectMenu } from '@/features/chat-mode/utils/project-menu'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useOpenProjectSettings } from '@/features/chat-mode/hooks/use-open-project-settings'

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
  const openProjectSettings = useOpenProjectSettings()
  const { project } = group
  return projectMenu({
    ownerLabel:
      project.members.length > 1
        ? project.members.find((member) => member.physicalKey === project.key)?.label
        : undefined,
    archiveAllSessions: () => actions.archiveAllSessions(project),
    canArchiveSessions: project.sessionRefs.length > 0,
    collapsed: group.collapsed,
    copyPath: () => void copyTextToClipboard(project.workspaceRoot, 'path'),
    deleteProject: () => actions.deleteProject(project),
    newSession: () => startSessionDraft(project.ref),
    manageWorktrees: () => useWorktreeManagerStore.getState().openManager(project.ref),
    openSettings: () => openProjectSettings({ ref: project.ref, title: project.title }),
    renameProject: () =>
      useProjectRenameRequestStore
        .getState()
        .requestRename({ ref: project.ref, title: project.title }),
    scopedToProject: scope === project.groupKey,
    scopeToProject: () => setScope(project.groupKey),
    toggleCollapsed: () =>
      toggleProjectCollapsed(project.members.map((member) => member.physicalKey)),
  })
}
