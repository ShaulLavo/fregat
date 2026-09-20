import { CaretRightIcon, CheckIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { ActivityDetails } from '@/features/chat/components/activity-details'
import { ActivityIcon } from '@/features/chat/components/activity-icon'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { workLogEntryLabel } from '@/features/chat/utils/tool-label'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { isWorkLogFailure, workRowExpandable } from '@/features/chat/utils/work-row'

export function ActivityRow({ activity }: { activity: ChatWorkLogEntry }) {
  const expanded = useChatWorkLogExpansionStore(
    (state) => state.expandedRowIds[activity.id] ?? false,
  )
  const toggle = useChatWorkLogExpansionStore((state) => state.toggleRowExpanded)
  const failed = isWorkLogFailure(activity)
  const expandable = workRowExpandable(activity)
  const label = activity.command ?? workLogEntryLabel(activity, false)
  const severeFailure = failed && activity.tone === 'error'
  const summary = (
    <>
      <ActivityIcon icon={activity.icon} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          severeFailure && 'text-destructive',
          activity.command && 'font-mono',
        )}
        title={label}
      >
        {label}
      </span>
      {failed ? (
        <XIcon aria-label='Failed' className='text-destructive size-(--icon-size-sm)' />
      ) : null}
      {!failed && activity.outcome === 'succeeded' ? (
        <CheckIcon aria-label='Succeeded' className='text-success size-(--icon-size-sm)' />
      ) : null}
      {expandable ? (
        <CaretRightIcon
          aria-hidden='true'
          className={cn(
            'size-(--icon-size-sm) shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      ) : null}
    </>
  )

  return (
    <div className='min-w-0' data-work-log-entry-id={activity.id}>
      {expandable ? (
        <Button
          aria-expanded={expanded}
          aria-label={failed ? `${label}, tool call failed` : label}
          className='text-muted-foreground h-auto w-full min-w-0 justify-start gap-2 px-1 py-1 text-left text-xs font-normal'
          data-scroll-anchor-ignore
          variant='ghost'
          onClick={() => toggle(activity.id)}
        >
          {summary}
        </Button>
      ) : (
        <div className='text-muted-foreground flex min-w-0 items-center gap-2 px-1 py-1 text-xs'>
          {summary}
        </div>
      )}
      {expanded && expandable ? <ActivityDetails activity={activity} /> : null}
    </div>
  )
}
