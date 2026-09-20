import type { GitFileStatus } from '@workspace/contracts'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { minimumGroupSize } from '@/lib/documents/utils/group-layout'
import { EMPTY_GIT_FILES } from '@/features/workspace/utils/tab-model'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'
import { EditorGroupsLayout } from '@/features/workbench/components/editor-groups-layout'
import { EditorGroupsDragProvider } from '@/features/workbench/providers/editor-groups-drag-provider'

export function CodePanel({
  conflicts,
  gitFiles = EMPTY_GIT_FILES,
  panels,
  rootPath,
}: {
  readonly conflicts: EditorTabConflictMap
  readonly gitFiles?: readonly GitFileStatus[]
  readonly panels: WorkbenchPanels
  readonly rootPath: FilesystemPath
}) {
  const minimum = minimumGroupSize(panels.editorGroups.root)

  return (
    <EditorGroupsDragProvider key={rootPath}>
      <div className='h-full min-h-0 min-w-0 overflow-auto' data-editor-groups=''>
        <div
          className='h-full min-h-full min-w-full'
          style={{ minWidth: minimum.width, minHeight: minimum.height }}
        >
          <EditorGroupsLayout
            activeGroupId={panels.editorGroups.activeGroupId}
            conflicts={conflicts}
            gitFiles={gitFiles}
            node={panels.editorGroups.root}
            rootPath={rootPath}
          />
        </div>
      </div>
    </EditorGroupsDragProvider>
  )
}
