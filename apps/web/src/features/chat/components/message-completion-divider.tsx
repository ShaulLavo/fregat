import { CaretRightIcon } from '@phosphor-icons/react'
import { TimelineAction } from '@/features/chat/components/timeline-action'
import { cn } from '@workspace/ui/lib/utils'
import { TurnStatusFrame } from '@/features/chat/components/turn-status-frame'
import { turnStatusLabel } from '@/features/chat/utils/turn-status-label'

export function MessageCompletionDivider({
  completionSummary,
  expanded = false,
  hiddenCount = 0,
  onToggle,
}: {
  completionSummary: string | null
  expanded?: boolean
  hiddenCount?: number
  onToggle?: () => void
}) {
  const label = turnStatusLabel({
    summary: completionSummary,
    expanded,
    hiddenCount,
    foldable: onToggle !== undefined,
  })

  return (
    <TurnStatusFrame>
      {onToggle ? (
        <TimelineAction
          aria-expanded={expanded}
          className='text-muted-foreground h-auto max-w-full justify-start gap-1.5 py-1 text-xs font-normal'
          data-scroll-anchor-ignore
          variant='ghost'
          onClick={onToggle}
        >
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'size-(--icon-size-sm) shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className='truncate'>{label}</span>
        </TimelineAction>
      ) : (
        <p className='px-1' role='status'>
          {label}
        </p>
      )}
    </TurnStatusFrame>
  )
}
