import { use } from 'react'
import { EditorDragContext } from '@/features/workbench/providers/editor-drag-context'
import type { GroupId } from '@/lib/documents/utils/group-types'
import type { TabId } from '@/lib/documents/utils/types'

export function EditorTabInsertion({
  groupId,
  beforeTabId,
}: {
  readonly groupId: GroupId
  readonly beforeTabId: TabId | null
}) {
  const target = use(EditorDragContext)?.preview?.target
  if (target?.kind !== 'strip' || target.groupId !== groupId || target.beforeTabId !== beforeTabId)
    return null
  return (
    <div
      className='bg-info pointer-events-none absolute inset-y-0 left-0 z-20 w-0.5'
      data-editor-tab-insertion
    />
  )
}
