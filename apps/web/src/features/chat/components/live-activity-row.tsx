import { CaretRightIcon, HandPalmIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

import { ActivityHistory } from '@/features/chat/components/activity-history'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import type { ChatLiveActivity } from '@/features/chat/utils/live-activity'

export function LiveActivityRow({
  activity,
  groupId,
}: {
  activity: ChatLiveActivity
  groupId: string
}) {
  const historyId = activity.activities[0]?.id ?? groupId
  const expanded = useChatWorkLogExpansionStore(
    (state) => state.expandedGroupIds[historyId] ?? false,
  )
  const toggle = useChatWorkLogExpansionStore((state) => state.toggleGroupExpanded)
  const expandable = activity.activities.length > 0
  const label = (
    <>
      {activity.active ? (
        <Spinner size='xs' aria-hidden='true' />
      ) : (
        <HandPalmIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
      )}
      <span className='min-w-0 truncate' role='status'>
        {activity.label}
      </span>
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
    <section className='min-w-0' data-live-activity>
      {expandable ? (
        <Button
          aria-expanded={expanded}
          className='text-muted-foreground h-7 max-w-full justify-start gap-2 px-1 text-xs font-normal'
          data-scroll-anchor-ignore
          title={activity.label}
          variant='ghost'
          onClick={() => toggle(historyId)}
        >
          {label}
        </Button>
      ) : (
        <div
          className='text-muted-foreground flex h-7 items-center gap-2 px-1 text-xs'
          title={activity.label}
        >
          {label}
        </div>
      )}
      {expanded && expandable ? (
        <ActivityHistory
          activities={activity.activities}
          streamingEntryId={activity.active && activity.entry?.reasoning ? activity.entry.id : null}
        />
      ) : null}
    </section>
  )
}
