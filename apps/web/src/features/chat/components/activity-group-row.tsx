import { CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { ActivityRow } from '@/features/chat/components/activity-row'
import { useWorkLogScroll } from '@/features/chat/hooks/use-work-log-scroll'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import {
  activityGroupSummary,
  isPinnedWorkLogEntry,
} from '@/features/chat/utils/activity-visibility'

export function ActivityGroupRow({ activities }: { activities: readonly ChatWorkLogEntry[] }) {
  const groupId = activities[0]?.id ?? ''
  const expanded = useChatWorkLogExpansionStore((state) => state.expandedGroupIds[groupId] ?? false)
  const toggle = useChatWorkLogExpansionStore((state) => state.toggleGroupExpanded)
  const scrollRef = useWorkLogScroll(`group:${groupId}`, activities.length)
  const visible = expanded ? activities : activities.filter(isPinnedWorkLogEntry)
  const hiddenCount = activities.length - visible.length
  const summary = activityGroupSummary(activities)

  if (activities.length === 1 && activities[0]) return <ActivityRow activity={activities[0]} />

  return (
    <section className='min-w-0 space-y-0.5'>
      {expanded || hiddenCount > 0 ? (
        <Button
          aria-expanded={expanded}
          className='text-muted-foreground h-auto max-w-full justify-start gap-2 px-1 py-1 text-xs font-normal tabular-nums'
          data-scroll-anchor-ignore
          variant='ghost'
          onClick={() => toggle(groupId)}
        >
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'size-(--icon-size-sm) shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className='truncate'>{summary}</span>
        </Button>
      ) : null}
      <div
        className={
          expanded
            ? 'ml-2 max-h-[min(18rem,50dvh)] overflow-auto overscroll-contain pl-2'
            : undefined
        }
        aria-label={expanded ? 'Tool calls' : undefined}
        role={expanded ? 'region' : undefined}
        tabIndex={expanded ? 0 : undefined}
        data-tool-group-scroll={expanded || undefined}
        ref={expanded ? scrollRef : undefined}
      >
        {visible.map((activity) => (
          <ActivityRow activity={activity} key={activity.id} />
        ))}
      </div>
    </section>
  )
}
