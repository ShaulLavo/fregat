import { useDroppable } from '@dnd-kit/core'
import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable'

import type { TabId } from '@/lib/documents/utils/types'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { useEditorDocumentState } from '@/features/editor/state/document-state'
import { editorTabCloseTargets } from '@/features/workbench/utils/editor-tab-close-targets'
import type { GroupId } from '@/lib/documents/utils/group-types'
import { EditorTabInsertion } from '@/features/workbench/components/editor-tab-insertion'
import { EditorTitleActions } from '@/features/workbench/components/editor-title-actions'
import { SortableEditorTabButton } from '@/features/workbench/components/sortable-editor-tab-button'
import { useActiveTabStripScroll } from '@/features/workbench/hooks/use-active-tab-strip-scroll'
import { BAR_TAB_FILLER_CLASS, BAR_TAB_STRIP_CLASS } from '@workspace/ui/patterns/bar-tabs'
import { cn } from '@workspace/ui/lib/utils'

export function EditorTabBar({
  groupId,
  loadingTabId = null,
  tabs,
}: {
  readonly groupId: GroupId
  readonly loadingTabId?: TabId | null
  readonly tabs: readonly EditorTabModel[]
}) {
  const dirtyDocumentKeys = useEditorDocumentState((state) => state.dirtyDocumentKeys)
  const closeTargets = editorTabCloseTargets(tabs, dirtyDocumentKeys)
  const activeTab = tabs.find((tab) => tab.active) ?? null
  const { setNodeRef } = useDroppable({ id: `strip:${groupId}`, data: { kind: 'strip', groupId } })
  const tabIds = tabs.map((tab) => tab.id)
  const setStripRef = useActiveTabStripScroll(activeTab?.id ?? null, tabIds, setNodeRef)

  return (
    <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
      <div
        aria-label='Editor tabs'
        className={cn(BAR_TAB_STRIP_CLASS, 'scroll-px-2')}
        data-editor-tab-strip={groupId}
        ref={setStripRef}
        role='tablist'
      >
        {tabs.map((tab) => {
          return (
            <div className='relative flex shrink-0' key={tab.id}>
              <EditorTabInsertion groupId={groupId} beforeTabId={tab.id} />
              <SortableEditorTabButton
                groupId={groupId}
                closeTargets={closeTargets}
                dirty={isEditorTabDirty(tab.content, dirtyDocumentKeys)}
                loading={tab.id === loadingTabId}
                tab={tab}
              />
            </div>
          )
        })}
        <div aria-hidden='true' className={cn(BAR_TAB_FILLER_CLASS, 'relative')}>
          <EditorTabInsertion groupId={groupId} beforeTabId={null} />
        </div>
        {activeTab ? <EditorTitleActions tab={activeTab} /> : null}
      </div>
    </SortableContext>
  )
}
