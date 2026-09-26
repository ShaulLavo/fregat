import { StopCircleIcon } from '@phosphor-icons/react'
import type { ProviderBackgroundTask } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'

import { RowIconAction } from '@/features/chat/components/row-icon-action'

export function BackgroundTaskRow({
  canStop,
  onStop,
  stopping,
  task,
}: {
  readonly canStop: boolean
  readonly onStop: () => void
  readonly stopping: boolean
  readonly task: ProviderBackgroundTask
}) {
  return (
    <ListRow
      className='gap-(--density-control-gap)'
      interactive={false}
      title={`${task.description} · ${task.taskType}`}
    >
      <span className='min-w-0 flex-1 truncate'>{task.description || task.taskId}</span>
      <span className='text-muted-foreground text-2xs shrink-0 font-mono'>{task.taskType}</span>
      {canStop ? (
        <RowIconAction
          busy={stopping}
          label={`Stop ${task.description || task.taskId}`}
          onClick={onStop}
        >
          <StopCircleIcon className='size-(--icon-size-sm)' />
        </RowIconAction>
      ) : null}
    </ListRow>
  )
}
