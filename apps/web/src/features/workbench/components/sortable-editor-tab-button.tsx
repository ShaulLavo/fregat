import { useSortable } from '@dnd-kit/sortable'

import type { EditorTabCloseTarget } from '@/features/workspace/utils/tab-close-targets'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { EditorTabButton } from '@/features/workbench/components/editor-tab-button'
import type { GroupId } from '@/lib/documents/utils/group-types'

export function SortableEditorTabButton({
  groupId,
  closeTargets,
  dirty,
  loading,
  tab,
}: {
  readonly groupId: GroupId
  readonly closeTargets: readonly EditorTabCloseTarget[]
  readonly dirty: boolean
  readonly loading: boolean
  readonly tab: EditorTabModel
}) {
  const { attributes, isDragging, listeners, setNodeRef } = useSortable({
    attributes: {
      role: 'tab',
      roleDescription: 'sortable editor tab',
    },
    id: tab.id,
    data: { kind: 'tab', groupId, tabId: tab.id },
  })

  return (
    <EditorTabButton
      closeTargets={closeTargets}
      dragAttributes={attributes}
      dragListeners={listeners}
      dirty={dirty}
      dragging={isDragging}
      dragNodeRef={setNodeRef}
      loading={loading}
      tab={tab}
    />
  )
}
