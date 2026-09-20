import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { forwardActiveRowKey } from '@/lib/list-keyboard'
import { useListbox } from '@workspace/ui/patterns/use-listbox'

import { TerminalListRow } from '@/features/workbench/components/terminal-list-row'
import { useTabStripSensors } from '@/features/workbench/hooks/use-tab-strip-sensors'
import { useTerminalTabActions } from '@/features/workbench/hooks/use-terminal-tab-actions'
import { tabReorderIntent } from '@/features/workbench/utils/tab-dnd'
import type { TerminalTabRecord } from '@/features/workbench/utils/terminal-tabs'
import { log } from '@/lib/client-logging'

const TERMINAL_LIST_DND_MODIFIERS = [restrictToVerticalAxis]

export function TerminalList({
  activeTabId,
  rootPath,
  tabs,
}: {
  readonly activeTabId: string | null
  readonly rootPath: string
  readonly tabs: readonly TerminalTabRecord[]
}) {
  const { closeTab, renameTab, reorderTab, selectTab, activateTab } =
    useTerminalTabActions(rootPath)
  const sensors = useTabStripSensors()

  const list = useListbox({
    role: 'tablist',
    items: tabs.map((tab) => ({ id: tab.id })),
    activeId: activeTabId,
    onActiveChange: selectTab,
    onCommit: activateTab,
    onActiveKeyDown(event) {
      if (
        ['F2', 'Delete', ' ', 'ContextMenu'].includes(event.key) ||
        (event.shiftKey && event.key === 'F10')
      )
        forwardActiveRowKey(event)
    },
  })

  function finishDrag(event: DragEndEvent, cancelled: boolean) {
    const intent = cancelled ? null : tabReorderIntent(tabs, event.active.id, event.over?.id)
    log.info({
      area: 'terminal',
      action: 'tabs.reorder',
      tabId: event.active.id,
      overId: event.over?.id ?? null,
      input: event.activatorEvent.type,
      cancelled,
      changed: intent !== null,
      targetIndex: intent?.targetIndex,
    })
    if (event.activatorEvent instanceof KeyboardEvent) list.containerProps.ref.current?.focus()
    if (!intent) return

    reorderTab(intent.tabId, intent.targetIndex)
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      modifiers={TERMINAL_LIST_DND_MODIFIERS}
      sensors={sensors}
      accessibility={{ restoreFocus: false }}
      onDragEnd={(event) => finishDrag(event, false)}
      onDragCancel={(event) => finishDrag(event, true)}
    >
      <SortableContext items={tabs.map((tab) => tab.id)} strategy={verticalListSortingStrategy}>
        <div
          {...list.containerProps}
          aria-label='Open terminals'
          aria-orientation='vertical'
          className='focus-ring-inset bg-background flex h-full flex-col overflow-y-auto py-(--density-section-gap)'
        >
          {tabs.map((tab) => (
            <TerminalListRow
              active={tab.id === activeTabId}
              rowProps={list.rowProps(tab.id)}
              key={tab.id}
              tab={tab}
              onActivate={activateTab}
              onClose={closeTab}
              onRename={renameTab}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
