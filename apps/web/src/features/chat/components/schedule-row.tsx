import type { ProviderSessionSchedule } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'

import { formatWakeTime } from '@/features/chat/utils/formatters'

export function ScheduleRow({
  nowMs,
  schedule,
}: {
  readonly nowMs: number
  readonly schedule: ProviderSessionSchedule
}) {
  const when = schedule.nextFireAt ? formatWakeTime(schedule.nextFireAt, nowMs) : 'never'
  const kind = schedule.recurring ? 'Repeats' : 'Once'
  return (
    <ListRow
      className='gap-(--density-control-gap)'
      interactive={false}
      title={`${schedule.prompt} · ${schedule.schedule}`}
    >
      <span className='min-w-0 flex-1 truncate'>{schedule.prompt || schedule.id}</span>
      <span className='text-muted-foreground text-2xs shrink-0'>{kind}</span>
      <span className='text-muted-foreground text-2xs shrink-0 font-mono tabular-nums'>{when}</span>
    </ListRow>
  )
}
