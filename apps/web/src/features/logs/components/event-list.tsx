import { useVirtualizer } from '@tanstack/react-virtual'
import type { LogEventDetailsById, LogEventSummary } from '@workspace/contracts'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useRef } from 'react'

import { logRowCollapsedHeightPx } from '@/features/logs/utils/row-layout'
import { LogsEventRow } from '@/features/logs/components/event-row'

type LogsEventListProps = {
  detailsById: LogEventDetailsById
  events: readonly LogEventSummary[]
  inspectedEventId: string | null
  pending: boolean
  onInspectEvent: (eventId: string | null) => void
}

export function LogsEventList({
  detailsById,
  events,
  inspectedEventId,
  onInspectEvent,
  pending,
}: LogsEventListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is the logs row virtualization layer.
  const virtualizer = useVirtualizer({
    count: events.length,
    estimateSize: () => logRowCollapsedHeightPx,
    getItemKey: (index) => events[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    measureElement:
      typeof ResizeObserver === 'undefined'
        ? undefined
        : (element) => element.getBoundingClientRect().height,
    overscan: 12,
  })
  // Read once here rather than as `ref={virtualizer.measureElement}` inside the row
  // loop. The React Compiler reads a member expression in a `ref` position as accessing
  // a ref value during render and fails the lint gate on it. Safe to hoist: virtual-core
  // assigns `measureElement` as an instance arrow function in its constructor, so it
  // carries its own binding and does not need the receiver.
  const measureElement = virtualizer.measureElement

  if (pending) {
    return (
      <LoadingState className='flex min-h-0 flex-1 flex-col gap-3 p-6' label='Loading logs'>
        <div className='bg-muted h-4 w-3/4 rounded' />
        <div className='bg-muted h-4 w-1/2 rounded' />
        <div className='bg-muted h-4 w-2/3 rounded' />
      </LoadingState>
    )
  }

  if (events.length === 0) {
    return <EmptyState className='flex-1 px-6' title='No logs match the current filters.' />
  }

  return (
    <div className='app-scrollbar-thin min-h-0 flex-1 overflow-auto' ref={parentRef}>
      <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const event = events[virtualRow.index]
          if (!event) return null

          return (
            <LogsEventRow
              detail={detailsById[event.id] ?? null}
              event={event}
              expanded={inspectedEventId === event.id}
              index={virtualRow.index}
              key={event.id}
              ref={measureElement}
              start={virtualRow.start}
              onInspectEvent={onInspectEvent}
            />
          )
        })}
      </div>
    </div>
  )
}
