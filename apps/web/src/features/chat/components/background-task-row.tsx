import { StopCircleIcon } from '@phosphor-icons/react'
import type { ProviderBackgroundTask } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ListRow } from '@workspace/ui/patterns/list-row'

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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`Stop ${task.description || task.taskId}`}
                disabled={stopping}
                focusableWhenDisabled
                size='icon-xs'
                type='button'
                variant='ghost'
                onClick={onStop}
              >
                {stopping ? <Spinner /> : <StopCircleIcon className='size-(--icon-size-sm)' />}
              </Button>
            }
          />
          <TooltipContent>{'Stop task'}</TooltipContent>
        </Tooltip>
      ) : null}
    </ListRow>
  )
}
