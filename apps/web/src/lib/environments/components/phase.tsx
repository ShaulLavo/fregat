import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'

export function Phase({
  phase,
  label,
}: {
  readonly phase: EnvironmentPhase
  readonly label: string
}) {
  if (phase === 'launching' || phase === 'connecting' || phase === 'reconnecting') {
    return <OrbitLoader className='size-3' label={`${label} ${phase}`} />
  }
  return (
    <span
      role='status'
      aria-label={`${label} ${phase}`}
      className={cn(
        'size-2 shrink-0 rounded-full',
        phase === 'live' && 'bg-success',
        phase === 'idle' && 'bg-muted-foreground',
        phase === 'offline' && 'bg-warning',
        (phase === 'blocked' || phase === 'identity-drift') && 'bg-destructive',
      )}
    />
  )
}
