import { Fragment, type ReactNode } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { minimumGroupSize } from '@/lib/documents/utils/group-layout'
import type { EditorGroup, GroupId, GroupNode } from '@/lib/documents/utils/group-types'

export function EditorGroupsLayout({
  activeGroupId,
  node,
  renderGroup,
}: {
  readonly activeGroupId: GroupId
  readonly node: GroupNode
  readonly renderGroup: (group: EditorGroup, active: boolean) => ReactNode
}) {
  const commands = useEditorCommands()
  if (node.kind === 'group') return renderGroup(node, node.id === activeGroupId)

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
                node={child}
                renderGroup={renderGroup}
              />
            </ResizablePanel>
          </Fragment>
        )
      })}
    </ResizablePanelGroup>
  )
}
