import { CopyIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { copyTextToClipboard } from '@/lib/clipboard'
import { logCopyValue } from '@/features/logs/utils/copy'
import { memo, useRef, type PointerEvent } from 'react'
import type { LogEventDetail, LogEventSummary } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'

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
  type LogRowPointerStart,
} from '@/features/logs/utils/row-interactions'
import { LogsEventInlineDetail } from '@/features/logs/components/event-inline-detail'
import { LogsRowChevron } from '@/features/logs/components/row-chevron'

// Profiling showed cursor moves rerendered all measured rows; only changed row state should render.
export const LogsEventRow = memo(function LogsEventRow({
  detail,
  event,
  expanded,
  rowBindings,
  selected,
  onInspectEvent,
}: {
  detail: LogEventDetail | null
  event: LogEventSummary
  expanded: boolean
  rowBindings: ReturnType<typeof useListbox<string>>['rowBindings']
  selected: boolean
  onInspectEvent: (eventId: string | null) => void
}) {
  const rowProps = rowBindings(event.id)
  const pointerStartRef = useRef<LogRowPointerStart>(null)
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerStartRef.current = logRowPointerStart(event)
  }

  return (
    <div className='w-full select-text' data-log-event-id={event.id}>
      <ListRow
        {...rowProps}
        role='option'
        selected={selected}
        className='cursor-pointer'
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse log event' : 'Expand log event'}
        data-log-row-summary=''
        title={`${formatLogPrimary(event)} · ${formatLogSecondary(event)}`}
        onClick={(pointer) => {
          if (!shouldToggleLogRow(pointer, pointerStartRef.current)) return
          rowProps.onClick(pointer)
          onInspectEvent(expanded ? null : event.id)
        }}
        onPointerDown={handlePointerDown}
      >
        <span className='text-muted-foreground text-3xs flex shrink-0 items-center gap-1.5 font-mono'>
          <span className={cn('size-1.5 shrink-0 rounded-full', logLevelDotClass(event.level))} />
          {formatLogTime(event.timestamp)}
        </span>
        <span className='min-w-0 flex-1 truncate'>
          <span className='font-medium'>{formatLogPrimary(event)}</span>
          <span className='text-muted-foreground ml-2'>{formatLogSecondary(event)}</span>
        </span>
        <span className='flex shrink-0 items-center gap-1.5'>
          {event.durationMs !== null ? (
            <span className='text-muted-foreground text-2xs font-mono'>
              {formatDuration(event.durationMs)}
            </span>
          ) : null}
          <span
            className={cn(
              'rounded-md px-1 font-mono text-3xs uppercase',
              logLevelClass(event.level),
            )}
          >
            {event.level}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label='Copy log event'
                  tabIndex={-1}
                  size='icon-xs'
                  variant='ghost'
                  onPointerDown={(pointer) => pointer.stopPropagation()}
                  onClick={(pointer) => {
                    pointer.stopPropagation()
                    void copyTextToClipboard(
                      JSON.stringify(logCopyValue(event, detail), null, 2),
                      'log event',
                    )
                  }}
                >
                  <CopyIcon className='size-(--icon-size-sm)' />
                </Button>
              }
            />
            <TooltipContent>Copy log event</TooltipContent>
          </Tooltip>
          <LogsRowChevron expanded={expanded} />
        </span>
      </ListRow>
      {expanded ? (
        <div className='px-(--density-row-padding-x) py-2'>
          <LogsEventInlineDetail detail={detail} event={event} />
        </div>
      ) : null}
    </div>
  )
})
