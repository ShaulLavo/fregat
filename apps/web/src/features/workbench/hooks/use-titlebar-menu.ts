import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { useQuery } from '@tanstack/react-query'

import { useTheme } from '@/features/settings/hooks/use-theme'
import { selectChatProjects, selectCurrentWorktree } from '@workspace/client-core/chat/selectors'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useProjectMenuEntries } from '@/features/workbench/hooks/use-project-menu-entries'
import { titlebarMenu } from '@/features/workbench/utils/titlebar-menu'
import { useOpenWorkspaceRoot } from '@/features/workspace/hooks/use-open-root'
import { copyTextToClipboard } from '@/lib/clipboard'
import { recentFoldersQueryOptions } from '@/lib/recent-folders-query'

const EMPTY_FOLDERS: readonly { name: string; path: string }[] = []

/**
 * `open` gates the recents fetch: they are a menu concern, not app state, and
 * the title bar renders for the whole life of the app.
 */
export function useTitlebarMenu(open: boolean) {
  const rootFolder = useEditorWorkspaceState((state) => state.rootFolder)
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const slice = useActiveChatProjection((state) => state)
  const projects = selectChatProjects(slice).flatMap((project) => {
    const worktree = selectCurrentWorktree(slice, project.id)
    return worktree
      ? [{ title: project.title, updatedAt: project.updatedAt, workspaceRoot: worktree.path }]
      : []
  })
  const openWorkspaceRoot = useOpenWorkspaceRoot()
  const { theme } = useTheme()
  const recentFolders = useQuery(recentFoldersQueryOptions({ enabled: open }))
  const workspacePath = rootFolder?.path ?? null
  const { entries } = useProjectMenuEntries({
    enabled: open,
    sourcesPending: recentFolders.isPending,
    activeRootPath: workspacePath,
    activeTitle: rootFolder?.name ?? '',
    projects,
    recentFolders: recentFolders.data ?? EMPTY_FOLDERS,
  })

  function selectProject(rootPath: string) {
    if (rootPath === workspacePath) return

    void openWorkspaceRoot(rootPath)
  }

  return titlebarMenu({
    colorMode: theme,
    copyWorkspacePath: () => void copyTextToClipboard(workspacePath ?? '', 'workspace path'),
    projects: entries,
    selectProject,
    uiMode,
    workspacePath,
  })
}
