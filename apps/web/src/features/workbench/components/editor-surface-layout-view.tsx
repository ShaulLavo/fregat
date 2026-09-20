import type { FilesystemPath } from '@/lib/documents/utils/types'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { EMPTY_GIT_FILES } from '@/features/workspace/utils/tab-model'
import { useEditorConflictState } from '@/features/editor/state/conflict-state'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useStatus } from '@/features/git/hooks/use-status'
import { WorkbenchLayout } from '@/features/workbench/components/layout'

export function EditorSurfaceLayoutView({ rootPath }: { readonly rootPath: FilesystemPath }) {
  const conflicts = useEditorConflictState((state) => state.conflicts)
  const gitStatus = useStatus(rootPath)
  const gitFiles = gitStatus.data?.files ?? EMPTY_GIT_FILES
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const layout = useEditorWorkspaceState((state) => state.workbenchLayout)
  const setWorkbenchLayout = useEditorWorkspaceState((state) => state.setWorkbenchLayout)

  return (
    <WorkbenchLayout
      conflicts={conflicts}
      gitFiles={gitFiles}
      layout={layout}
      panels={panels}
      rootPath={filesystemPath(rootPath)}
      onLayoutChange={setWorkbenchLayout}
    />
  )
}
