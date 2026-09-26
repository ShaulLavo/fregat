import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { ScheduleRow } from '@/features/chat/components/schedule-row'
import type { useSessionSchedules } from '@/features/chat/hooks/use-session-schedules'
import { errorMessage } from '@/lib/error-message'

export function ScheduleList({
  nowMs,
  schedules,
}: {
  readonly nowMs: number
  readonly schedules: ReturnType<typeof useSessionSchedules>
}) {
  if (schedules.isPending)
    return (
      <LoadingState label='Loading schedules' className='p-(--density-row-padding-x)'>
        <div aria-hidden='true' className='skeleton-sweep h-3 w-40 rounded-md' />
      </LoadingState>
    )
  if (schedules.isError)
    return (
      <EmptyState
        align='start'
        title={errorMessage(schedules.error, 'The schedules could not be read.')}
        tone='error'
      />
    )
  if (schedules.data.schedules.length === 0)
    return <EmptyState align='start' title='No schedules' />

  return (
    <div>
      {schedules.data.heldByBackgroundWork ? (
        <p className='text-muted-foreground text-2xs px-(--density-row-padding-x) pb-1'>
          Wake-ups wait until the background work finishes.
        </p>
      ) : null}
      {schedules.data.schedules.map((schedule) => (
        <ScheduleRow key={schedule.id} nowMs={nowMs} schedule={schedule} />
      ))}
    </div>
  )
}
