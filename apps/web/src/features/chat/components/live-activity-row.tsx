import { CaretRightIcon, HandPalmIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

import { ActivityRow } from '@/features/chat/components/activity-row'
import { LiveTail } from '@/features/chat/components/live-tail'
import { useWorkLogScroll } from '@/features/chat/hooks/use-work-log-scroll'
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
  const scrollRef = useWorkLogScroll(`group:${historyId}`, activity.activities.length)
  const label = (
    <>
      {activity.active ? (
        <Spinner size='xs' aria-hidden='true' />
      ) : (
        <HandPalmIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
      )}
      {activity.active ? <span className='text-foreground shrink-0'>Working…</span> : null}
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
      {!expanded && activity.tail.length > 0 ? <LiveTail entries={activity.tail} /> : null}
      {expanded && expandable ? (
        <div
          className='ml-2 max-h-[min(18rem,50dvh)] overflow-auto pl-2'
          aria-label='Tool calls'
          role='region'
          tabIndex={0}
          data-tool-group-scroll
          ref={scrollRef}
        >
          {activity.activities.map((entry) => (
            <ActivityRow activity={entry} key={entry.id} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
