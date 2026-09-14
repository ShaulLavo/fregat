import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core'
import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable'

import type { DocumentKey, TabId } from '@/lib/documents/utils/types'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { useEditorDocumentState } from '@/features/editor/state/document-state'
import type { EditorTabCloseTarget } from '@/features/workspace/utils/tab-close-targets'
import { useEditorTabActions } from '@/features/editor/hooks/use-editor-tab-actions'
import { MergeConflictNavigation } from '@/features/workbench/components/merge-conflict-navigation'
import { SortableEditorTabButton } from '@/features/workbench/components/sortable-editor-tab-button'
import { useActiveTabStripScroll } from '@/features/workbench/hooks/use-active-tab-strip-scroll'
import { useTabStripSensors } from '@/features/workbench/hooks/use-tab-strip-sensors'
import { BAR_TAB_FILLER_CLASS, BAR_TAB_STRIP_CLASS } from '@/features/workbench/utils/bar-tabs'
import { tabReorderIntent } from '@/features/workbench/utils/tab-dnd'
import { cn } from '@workspace/ui/lib/utils'

const EDITOR_TAB_DND_MODIFIERS = [restrictToHorizontalAxis]

export function EditorTabBar({
  loadingTabId = null,
  tabs,
}: {
  readonly loadingTabId?: TabId | null
  readonly tabs: readonly EditorTabModel[]
}) {
  const dirtyDocumentKeys = useEditorDocumentState((state) => state.dirtyDocumentKeys)
  const { reorderTab } = useEditorTabActions()
  const closeTargets = editorTabCloseTargets(tabs, dirtyDocumentKeys)
  const activeTab = tabs.find((tab) => tab.active) ?? null
  const stripRef = useActiveTabStripScroll(activeTab?.id ?? null)
  const sensors = useTabStripSensors()

  function handleDragEnd(event: DragEndEvent) {
    const intent = tabReorderIntent(tabs, event.active.id, event.over?.id)
    if (!intent) return

    reorderTab(intent.tabId, intent.targetIndex)
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      modifiers={EDITOR_TAB_DND_MODIFIERS}
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
        <div
          aria-label='Editor tabs'
          className={cn(BAR_TAB_STRIP_CLASS, 'bg-background')}
          ref={stripRef}
          role='tablist'
        >
          {tabs.map((tab) => {
            return (
              <SortableEditorTabButton
                closeTargets={closeTargets}
                dirty={isEditorTabDirty(tab.content, dirtyDocumentKeys)}
                key={tab.id}
                loading={tab.id === loadingTabId}
                tab={tab}
              />
            )
          })}
          <div aria-hidden='true' className={BAR_TAB_FILLER_CLASS} />
          {activeTab?.mergeConflicts ? <MergeConflictNavigation /> : null}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function editorTabCloseTargets(
  tabs: readonly EditorTabModel[],
  dirtyDocumentKeys: ReadonlySet<DocumentKey>,
): EditorTabCloseTarget[] {
  return tabs.map((tab) => ({
    dirty: isEditorTabDirty(tab.content, dirtyDocumentKeys),
    id: tab.id,
  }))
}
