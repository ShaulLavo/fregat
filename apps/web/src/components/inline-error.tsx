import { cn } from '@workspace/ui/lib/utils'

import { FixWithAgentButton } from '@/components/fix-with-agent-button'

/** An error sentence in a form or dialog, with the hand-off to an agent under it. */
export function InlineError({
  className,
  id,
  message,
  onHandOff,
  title,
}: {
  readonly className?: string
  readonly id?: string
  readonly message: string
  readonly onHandOff?: () => void
  /** What failed, for the agent: the dialog or action the message belongs to. */
  readonly title?: string
}) {
  return (
    <div className='flex flex-col items-start gap-(--density-gap-tight)' role='alert'>
      <p className={cn('text-destructive text-xs wrap-anywhere', className)} id={id}>
        {message}
      </p>
      <FixWithAgentButton error={{ message, title }} onHandOff={onHandOff} />
    </div>
  )
}
