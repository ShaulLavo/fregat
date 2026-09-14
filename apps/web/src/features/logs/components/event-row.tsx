import { forwardRef, memo, useCallback, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { LogEventDetail, LogEventSummary } from '@workspace/contracts'
import { Accordion, AccordionContent, AccordionItem } from '@workspace/ui/components/accordion'

import {
  formatDuration,
  formatLogPrimary,
  formatLogSecondary,
  formatLogTime,
  logLevelClass,
  logLevelDotClass,
} from '@/features/logs/utils/formatters'
import {
  logRowPointerStart,
  shouldToggleLogRow,
  shouldToggleLogRowKey,
  type LogRowPointerStart,
} from '@/features/logs/utils/row-interactions'
import { logRowCollapsedHeightPx } from '@/features/logs/utils/row-layout'
import { LogsEventInlineDetail } from '@/features/logs/components/event-inline-detail'
import { LogsRowChevron } from '@/features/logs/components/row-chevron'
import { cn } from '@workspace/ui/lib/utils'

// The virtualizer estimates every collapsed row at this height, so the markup
// reads the same constant instead of restating the number.
const collapsedRowStyle = { minHeight: logRowCollapsedHeightPx }

type LogsEventRowProps = {
  detail: LogEventDetail | null
  event: LogEventSummary
  expanded: boolean
  index: number
  start: number
  onInspectEvent: (eventId: string | null) => void
}

export const LogsEventRow = memo(
  forwardRef<HTMLDivElement, LogsEventRowProps>(function LogsEventRow(
    { detail, event, expanded, index, start, onInspectEvent },
    ref,
  ) {
    const pointerStartRef = useRef<LogRowPointerStart>(null)
    const value = expanded ? [event.id] : []
    const toggleRow = useCallback(() => {
      onInspectEvent(expanded ? null : event.id)
    }, [event.id, expanded, onInspectEvent])
    const handleRowPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
      pointerStartRef.current = logRowPointerStart(event)
    }, [])
    const handleRowClick = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        if (!shouldToggleLogRow(event, pointerStartRef.current)) return

        toggleRow()
      },
      [toggleRow],
    )
    const handleRowKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (!shouldToggleLogRowKey(event.key)) return

        event.preventDefault()
        toggleRow()
      },
      [toggleRow],
    )

    return (
      <div
        className='absolute left-0 w-full border-b select-text'
        data-index={index}
        ref={ref}
        style={{ transform: `translateY(${start}px)` }}
      >
        <Accordion className='block' value={value}>
          <AccordionItem className='border-b-0' value={event.id}>
            <div
              className='hover:bg-row-hover grid w-full cursor-pointer grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 px-(--density-row-padding-x) py-2 transition-colors'
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse log event' : 'Expand log event'}
              data-log-row-summary=''
              role='button'
              style={collapsedRowStyle}
              tabIndex={0}
              title={`${formatLogPrimary(event)} — ${formatLogSecondary(event)}`}
              onClick={handleRowClick}
              onKeyDown={handleRowKeyDown}
              onPointerDown={handleRowPointerDown}
            >
              <span className='text-muted-foreground text-3xs flex min-w-0 items-center gap-1.5 font-mono tabular-nums'>
                <span
                  className={cn('size-1.5 shrink-0 rounded-full', logLevelDotClass(event.level))}
                />
                {formatLogTime(event.timestamp)}
              </span>
              <span className='min-w-0'>
                <span className='text-2xs block truncate font-medium'>
                  {formatLogPrimary(event)}
                </span>
                <span className='text-muted-foreground text-3xs block truncate'>
                  {formatLogSecondary(event)}
                </span>
              </span>
              <div className='flex min-w-0 items-center gap-1.5'>
                {event.durationMs !== null ? (
                  <span className='text-muted-foreground text-3xs font-mono tabular-nums'>
                    {formatDuration(event.durationMs)}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'rounded-md border px-1.5 py-0.5 font-mono text-3xs uppercase leading-3',
                    logLevelClass(event.level),
                  )}
                >
                  {event.level}
                </span>
                <LogsRowChevron expanded={expanded} />
              </div>
            </div>
            <AccordionContent className='border-t px-(--density-row-padding-x) py-2'>
              <LogsEventInlineDetail detail={detail} event={event} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    )
  }),
)
