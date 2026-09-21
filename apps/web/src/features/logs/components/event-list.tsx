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
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualList = useRef<VirtualListHandle>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Expanding a detail must not restart the cursor's scroll effect.
  const scrollToIndex = (index: number) => {
    virtualList.current?.scrollToIndex(index, { align: 'auto' })
  }
  const listbox = useListbox({
    role: 'listbox',
    items: events.map((event) => ({ id: event.id })),
    activeId,
    onActiveChange: setActiveId,
    onSelect: setActiveId,
    onCommit: (id) => onInspectEvent(inspectedEventId === id ? null : id),
    containerRef: scrollRef,
    scrollToIndex,
  })

  return (
    <VirtualList
      {...listbox.containerProps}
      aria-label='Log events'
      initialOffset={initialOffset}
      onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
      scrollRef={scrollRef}
      handleRef={virtualList}
      activeIndex={listbox.activeIndex}
      className='app-scrollbar-thin focus-ring-inset min-h-0 flex-1 overflow-auto'
      items={events}
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
  )
}
