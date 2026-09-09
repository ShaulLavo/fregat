import { CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'

import { ActivityRow } from '@/features/chat/components/activity-row'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import {
  activeActivityGroupEntry,
  activityGroupSummary,
  visibleActivityGroupRows,
} from '@/features/chat/utils/activity-visibility'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export function ActivityGroupRow({
  activities,
  activeTurnId,
}: {
  activities: readonly ChatWorkLogEntry[]
  activeTurnId: ChatWorkLogEntry['turnId']
}) {
  const groupId = activities[0]?.id ?? ''
  const expanded = useChatWorkLogExpansionStore((state) => state.expandedGroupIds[groupId] ?? false)
  const toggleGroupExpanded = useChatWorkLogExpansionStore((state) => state.toggleGroupExpanded)
  const onlyTools = activities.every((activity) => activity.tone === 'tool')
  const collapsedRows = onlyTools
    ? activities.filter((activity) => activity.outcome === 'failed')
    : visibleActivityGroupRows(activities, 1)
  const visibleRows = expanded ? activities : collapsedRows
  const hiddenCount = activities.length - collapsedRows.length
  const running = onlyTools ? activeActivityGroupEntry(activities, activeTurnId) : undefined
  const failed = onlyTools && activities.some((activity) => activity.outcome === 'failed')
  const summary = onlyTools ? activityGroupSummary(activities) : `Show ${hiddenCount} more`
  const label = running ? (running.command ?? running.title) : summary

  return (
    <section className='space-y-0.5'>
      {hiddenCount > 0 ? (
        <Button
          aria-expanded={expanded}
          className={cn(
            'text-muted-foreground h-auto max-w-full justify-start gap-2 px-1 py-1 text-xs font-normal tabular-nums',
            failed && 'text-destructive',
          )}
          variant='ghost'
          onClick={() => toggleGroupExpanded(groupId)}
        >
          {running ? (
            <OrbitLoader className='size-3 shrink-0' label='Tool running' />
          ) : (
            <CaretRightIcon
              className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')}
            />
          )}
          <span className='truncate'>{expanded && !onlyTools ? 'Show less' : label}</span>
          {failed ? <span className='sr-only'>A tool call failed</span> : null}
        </Button>
      ) : null}
      <div className={expanded ? 'border-border ml-2 border-l pl-2' : undefined}>
        {visibleRows.map((activity) => (
          <ActivityRow activity={activity} key={activity.id} />
        ))}
      </div>
    </section>
  )
}
