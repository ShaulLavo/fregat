import { Fragment } from 'react'
import type { GitFileStatus } from '@workspace/contracts'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { EditorGroup } from '@/features/workbench/components/editor-group'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import { minimumGroupSize } from '@/lib/documents/utils/group-layout'
import type { GroupId, GroupNode } from '@/lib/documents/utils/group-types'
import type { FilesystemPath } from '@/lib/documents/utils/types'

export function EditorGroupsLayout({
  activeGroupId,
  conflicts,
  gitFiles,
  node,
  rootPath,
}: {
  readonly activeGroupId: GroupId
  readonly conflicts: EditorTabConflictMap
  readonly gitFiles: readonly GitFileStatus[]
  readonly node: GroupNode
  readonly rootPath: FilesystemPath
}) {
  const commands = useEditorCommands()
  if (node.kind === 'group') {
    return (
      <EditorGroup
        active={node.id === activeGroupId}
        conflicts={conflicts}
        gitFiles={gitFiles}
        group={node}
        rootPath={rootPath}
      />
    )
  }

  const childIds = node.children.map(({ node: child }) => child.id)
  const layout = Object.fromEntries(node.children.map(({ node: child, size }) => [child.id, size]))

  return (
    <ResizablePanelGroup
      key={`${node.id}:${childIds.join(',')}`}
      defaultLayout={layout}
      id={node.id}
      orientation={node.axis}
      onLayoutChanged={(sizes, meta) => {
        if (!meta.isUserInteraction) return
        void commands.resizeEditorSplit({
          splitId: node.id,
          children: childIds.map((id) => ({ id, size: sizes[id] ?? 0 })),
        })
      }}
    >
      {node.children.map(({ node: child, size }, index) => {
        const minimum = minimumGroupSize(child)
        return (
          <Fragment key={child.id}>
            {index > 0 ? <ResizableHandle id={`${node.id}-${child.id}`} withHandle /> : null}
            <ResizablePanel
              className='min-h-0 min-w-0 overflow-hidden'
              defaultSize={`${size}%`}
              id={child.id}
              minSize={node.axis === 'horizontal' ? minimum.width : minimum.height}
            >
              <EditorGroupsLayout
                activeGroupId={activeGroupId}
                conflicts={conflicts}
                gitFiles={gitFiles}
                node={child}
                rootPath={rootPath}
              />
            </ResizablePanel>
          </Fragment>
        )
      })}
    </ResizablePanelGroup>
  )
}
