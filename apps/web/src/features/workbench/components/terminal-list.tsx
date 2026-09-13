import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useEffect, useRef, type KeyboardEvent } from 'react'

import { TerminalListRow } from '@/features/workbench/components/terminal-list-row'
import { useTabStripSensors } from '@/features/workbench/hooks/use-tab-strip-sensors'
import { useTerminalTabActions } from '@/features/workbench/hooks/use-terminal-tab-actions'
import { tabReorderIntent } from '@/features/workbench/utils/tab-dnd'
import type { TerminalTabRecord } from '@/features/workbench/utils/terminal-tabs'

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
  const { closeTab, renameTab, reorderTab, selectAdjacentTab, selectTab } =
    useTerminalTabActions(rootPath)
  const listRef = useRef<HTMLDivElement>(null)
  const sensors = useTabStripSensors()

  useEffect(() => {
    if (!activeTabId) return

    rowElement(listRef.current, activeTabId)?.scrollIntoView({
      block: 'nearest',
    })
  }, [activeTabId])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    // A picked-up row (Space) is being moved by the keyboard sensor, not walked.
    if (isPickedUpRow(event.target)) return

    event.preventDefault()
    const next = selectAdjacentTabForKey(event.key)
    if (!next) return

    rowElement(listRef.current, next)?.focus()
  }

  function selectAdjacentTabForKey(key: 'ArrowDown' | 'ArrowUp') {
    return selectAdjacentTab(key === 'ArrowDown' ? 'next' : 'previous')
  }

  function handleDragEnd(event: DragEndEvent) {
    const intent = tabReorderIntent(tabs, event.active.id, event.over?.id)
    if (!intent) return

    reorderTab(intent.tabId, intent.targetIndex)
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      modifiers={TERMINAL_LIST_DND_MODIFIERS}
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={tabs.map((tab) => tab.id)} strategy={verticalListSortingStrategy}>
        <div
          aria-label='Open terminals'
          aria-orientation='vertical'
          className='border-border bg-background flex w-40 shrink-0 flex-col overflow-y-auto border-l py-(--density-section-gap)'
          ref={listRef}
          role='tablist'
          onKeyDown={handleKeyDown}
        >
          {tabs.map((tab) => (
            <TerminalListRow
              active={tab.id === activeTabId}
              key={tab.id}
              tab={tab}
              onClose={closeTab}
              onRename={renameTab}
              onSelect={selectTab}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function rowElement(list: HTMLElement | null, tabId: string) {
  return list?.querySelector<HTMLElement>(`[data-terminal-tab-id="${CSS.escape(tabId)}"]`) ?? null
}

function isPickedUpRow(target: EventTarget) {
  return target instanceof HTMLElement && target.getAttribute('aria-pressed') === 'true'
}
