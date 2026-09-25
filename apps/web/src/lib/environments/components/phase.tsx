import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

export function Phase({
  phase,
  label,
}: {
  readonly phase: EnvironmentPhase
  readonly label: string
}) {
  if (phase === 'launching' || phase === 'connecting' || phase === 'reconnecting') {
    return <Spinner size='xs' label={`${label} ${phase}`} />
  }
  // Same box as the loader, so swapping between them does not nudge the label.
  return (
    <span
      role='status'
      aria-label={`${label} ${phase}`}
      className='flex size-3 shrink-0 items-center justify-center'
    >
      <span
        className={cn(
          'size-2 rounded-full',
          phase === 'live' && 'bg-success',
          phase === 'idle' && 'bg-muted-foreground',
          phase === 'offline' && 'bg-warning',
          (phase === 'blocked' || phase === 'identity-drift') && 'bg-destructive',
        )}
      />
    </span>
  )
}
