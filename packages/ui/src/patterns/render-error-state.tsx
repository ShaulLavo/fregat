import { ArrowsClockwiseIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'

export type RenderErrorStateProps = {
  /** What failed, as the user knows it: "Git", "This message". */
  label: string
  error: unknown
  align?: 'center' | 'start'
  onRetry: () => void
}

export function RenderErrorState({
  label,
  error,
  align = 'center',
  onRetry,
}: RenderErrorStateProps) {
  return (
    <EmptyState
      action={
        <Button size='xs' variant='outline' onClick={onRetry}>
          <ArrowsClockwiseIcon data-icon='inline-start' />
          Retry
        </Button>
      }
      align={align}
      className={align === 'center' ? 'h-full' : undefined}
      description={<span className='font-mono wrap-anywhere'>{renderErrorMessage(error)}</span>}
      icon={<WarningCircleIcon weight='fill' />}
      title={`${label} hit a render error`}
      tone='error'
    />
  )
}

function renderErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()

  return 'The details are in the log.'
}
