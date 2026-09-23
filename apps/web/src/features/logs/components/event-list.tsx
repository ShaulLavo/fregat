import { CopyIcon, BroomIcon, XIcon } from '@phosphor-icons/react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@workspace/ui/components/context-menu'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { copyTextToClipboard } from '@/lib/clipboard'
import { logCopyValue } from '@/features/logs/utils/copy'
import type { LogEventDetailsById, LogEventSummary } from '@workspace/contracts'
import { useRef, useState } from 'react'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'

import { LogsEventRow } from '@/features/logs/components/event-row'

export function LogsEventList({
  detailsById,
  events,
  inspectedEventId,
  onInspectEvent,
  initialOffset,
  onScroll,
}: {
  initialOffset?: number
  onScroll?: (scrollTop: number) => void
  detailsById: LogEventDetailsById
  events: readonly LogEventSummary[]
  inspectedEventId: string | null
  onInspectEvent: (eventId: string | null) => void
}) {
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [contextId, setContextId] = useState<string | null>(null)
  const visibleEvents = events.filter((event) => !dismissedIds.has(event.id))
  const contextEvent = visibleEvents.find((event) => event.id === contextId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualList = useRef<VirtualListHandle>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Expanding a detail must not restart the cursor's scroll effect.
  const scrollToIndex = (index: number) => {
    virtualList.current?.scrollToIndex(index, { align: 'auto' })
  }
  const listbox = useListbox({
    role: 'listbox',
    items: visibleEvents.map((event) => ({ id: event.id })),
    activeId,
    onActiveChange: setActiveId,
    onSelect: setActiveId,
    onCommit: (id) => onInspectEvent(inspectedEventId === id ? null : id),
    containerRef: scrollRef,
    scrollToIndex,
  })

  function dismissEvents(ids: readonly string[]) {
    setDismissedIds((previous) => new Set([...previous, ...ids]))
    if (inspectedEventId && ids.includes(inspectedEventId)) onInspectEvent(null)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className='flex min-h-0 flex-1 flex-col select-text'
        onContextMenu={(event) => {
          const row =
            event.target instanceof Element ? event.target.closest('[data-log-event-id]') : null
          setContextId(row?.getAttribute('data-log-event-id') ?? activeId)
        }}
      >
        {visibleEvents.length === 0 ? (
          <EmptyState className='flex-1' title='Visible logs cleared.' />
        ) : null}
        <VirtualList
          {...listbox.containerProps}
          aria-label='Log events'
          initialOffset={initialOffset}
          onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
          scrollRef={scrollRef}
          handleRef={virtualList}
          activeIndex={listbox.activeIndex}
          className='app-scrollbar-thin focus-ring-inset min-h-0 flex-1 overflow-auto'
          items={visibleEvents}
          getKey={(event) => event.id}
          layout='flow'
          measureItems
          renderRow={(event) => (
            <LogsEventRow
              detail={detailsById[event.id] ?? null}
              event={event}
              expanded={inspectedEventId === event.id}
              rowBindings={listbox.rowBindings}
              selected={listbox.activeId === event.id}
              onInspectEvent={onInspectEvent}
            />
          )}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!contextEvent}
          onClick={() => {
            if (!contextEvent) return
            void copyTextToClipboard(
              JSON.stringify(
                logCopyValue(contextEvent, detailsById[contextEvent.id] ?? null),
                null,
                2,
              ),
              'log event',
            )
          }}
        >
          <CopyIcon className='size-(--icon-size)' /> Copy current log
        </ContextMenuItem>
        <ContextMenuItem
          disabled={visibleEvents.length === 0}
          onClick={() => {
            const text = visibleEvents
              .map((event) => JSON.stringify(logCopyValue(event, detailsById[event.id] ?? null)))
              .join('\n')
            void copyTextToClipboard(text, 'visible logs')
          }}
        >
          <CopyIcon className='size-(--icon-size)' /> Copy visible logs
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!contextEvent}
          onClick={() => {
            if (contextEvent) dismissEvents([contextEvent.id])
          }}
        >
          <XIcon className='size-(--icon-size)' /> Clear current log
        </ContextMenuItem>
        <ContextMenuItem
          disabled={visibleEvents.length === 0}
          onClick={() => dismissEvents(visibleEvents.map((event) => event.id))}
        >
          <BroomIcon className='size-(--icon-size)' /> Clear visible logs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
