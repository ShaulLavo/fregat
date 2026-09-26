import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { BackgroundTaskRow } from '@/features/chat/components/background-task-row'
import type { useBackgroundTasks } from '@/features/chat/hooks/use-background-tasks'
import { errorMessage } from '@/lib/error-message'

export function BackgroundTaskList({
  onStop,
  roster,
  stopping,
}: {
  readonly onStop: (taskId: string) => void
  readonly roster: ReturnType<typeof useBackgroundTasks>
  readonly stopping: readonly unknown[]
}) {
  if (roster.isPending)
    return (
      <LoadingState label='Loading background tasks' className='p-(--density-row-padding-x)'>
        <div aria-hidden='true' className='skeleton-sweep h-3 w-40 rounded-md' />
      </LoadingState>
    )
  if (roster.isError)
    return (
      <EmptyState
        align='start'
        title={errorMessage(roster.error, 'Background tasks could not be read.')}
        tone='error'
      />
    )
  if (roster.data.tasks.length === 0)
    return <EmptyState align='start' title='No background tasks' />

  return (
    <div className='pb-(--density-popover-padding)'>
      {roster.data.tasks.map((task) => (
        <BackgroundTaskRow
          canStop={roster.data.supported}
          key={task.taskId}
          onStop={() => onStop(task.taskId)}
          stopping={stopping.includes(task.taskId)}
          task={task}
        />
      ))}
    </div>
  )
}
