import { useDroppable } from '@dnd-kit/core'
import { use } from 'react'
import type { GroupId } from '@/lib/documents/utils/group-types'
import { EditorDragContext } from '@/features/workbench/providers/editor-drag-context'
import { dropLabel } from '@/features/workbench/utils/editor-drag'
import { cn } from '@workspace/ui/lib/utils'
import { Badge } from '@workspace/ui/components/badge'

export function EditorGroupDropOverlay({ groupId }: { readonly groupId: GroupId }) {
  const drag = use(EditorDragContext)
  const { setNodeRef } = useDroppable({ id: `drop:${groupId}`, data: { kind: 'group', groupId } })
  const preview = drag?.preview
  const target = preview?.target
  const visible = target?.groupId === groupId && target.kind !== 'strip'
  const edge = target?.kind === 'edge' ? target.edge : null

  return (
    <div className='pointer-events-none absolute inset-0 z-20' ref={setNodeRef}>
      {visible && preview ? (
        <div
          className={cn(
            'bg-info/15 absolute flex items-center justify-center',
            edge === 'left' && 'inset-y-0 left-0 w-1/2',
            edge === 'right' && 'inset-y-0 right-0 w-1/2',
            edge === 'top' && 'inset-x-0 top-0 h-1/2',
            edge === 'bottom' && 'inset-x-0 bottom-0 h-1/2',
            edge === null && 'inset-0',
          )}
          data-editor-drop-preview={edge ?? 'center'}
        >
          <Badge variant='outline' className='bg-popover-solid text-popover-foreground'>
            {dropLabel(preview)}
          </Badge>
        </div>
      ) : null}
    </div>
  )
}
