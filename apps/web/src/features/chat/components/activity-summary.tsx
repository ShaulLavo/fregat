import { CheckIcon, XIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'

import { ActivityIcon } from '@/features/chat/components/activity-icon'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { isWorkLogFailure } from '@/features/chat/utils/work-row'

/** Icon, label and outcome mark of one work-log row; the caller owns the row around it. */
export function ActivitySummary({
  activity,
  label,
}: {
  activity: ChatWorkLogEntry
  label: string
}) {
  const failed = isWorkLogFailure(activity)
  const severeFailure = failed && activity.tone === 'error'

  return (
    <>
      <ActivityIcon icon={activity.icon} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          severeFailure && 'text-destructive',
          activity.command && 'font-mono',
        )}
        title={label}
      >
        {label}
      </span>
      {failed ? (
        <XIcon aria-label='Failed' className='text-destructive size-(--icon-size-sm)' />
      ) : null}
      {!failed && activity.outcome === 'succeeded' ? (
        <CheckIcon aria-label='Succeeded' className='text-success size-(--icon-size-sm)' />
      ) : null}
    </>
  )
}
