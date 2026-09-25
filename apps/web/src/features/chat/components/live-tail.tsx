import { ActivitySummary } from '@/features/chat/components/activity-summary'
import { liveTailLabel } from '@/features/chat/utils/live-activity'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

/**
 * A fixed three-row window, measured once when the first call lands and never again
 * while calls stream, so the rows above it stay put.
 */
export function LiveTail({ entries }: { entries: readonly ChatWorkLogEntry[] }) {
  return (
    <div
      aria-label='Latest tool calls'
      className='ml-2 flex h-[calc(var(--density-row-height)*3)] flex-col justify-end overflow-hidden mask-t-from-60% pl-2'
      data-live-tail
      role='list'
    >
      {entries.map((entry) => (
        <div
          className='text-muted-foreground flex h-(--density-row-height) min-w-0 shrink-0 items-center gap-2 px-1 text-xs'
          data-work-log-entry-id={entry.id}
          key={entry.id}
          role='listitem'
        >
          <ActivitySummary activity={entry} label={liveTailLabel(entry)} />
        </div>
      ))}
    </div>
  )
}
