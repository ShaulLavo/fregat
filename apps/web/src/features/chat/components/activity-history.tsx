import { Fragment } from 'react'
import { ActivityRow } from '@/features/chat/components/activity-row'
import { ReasoningRow } from '@/features/chat/components/reasoning-row'
import { useWorkLogScroll } from '@/features/chat/hooks/use-work-log-scroll'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export function ActivityHistory({
  activities,
  streamingEntryId = null,
}: {
  activities: readonly ChatWorkLogEntry[]
  streamingEntryId?: string | null
}) {
  const groupId = activities[0]?.id ?? ''
  const { scrollRef, rowsRef } = useWorkLogScroll(`group:${groupId}`, activities.length, 'rows')
  const hasTools = activities.some((entry) => !entry.reasoning)

  return (
    <div
      className='ml-2 max-h-[min(18rem,50dvh)] overflow-auto overscroll-contain pl-2'
      aria-label='Activity history'
      role='region'
      tabIndex={0}
      data-tool-group-scroll
      ref={scrollRef}
    >
      <Fragment ref={rowsRef}>
        {activities.map((entry) =>
          entry.reasoning ? (
            <ReasoningRow
              entry={entry}
              key={entry.id}
              showHeader={hasTools}
              streaming={entry.id === streamingEntryId}
            />
          ) : (
            <ActivityRow activity={entry} key={entry.id} />
          ),
        )}
      </Fragment>
    </div>
  )
}
