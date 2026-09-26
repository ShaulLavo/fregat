import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import { Spinner } from '@workspace/ui/components/spinner'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { phaseTone } from '@/lib/environments/utils/phase-tone'

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
      <StatusDot tone={phaseTone(phase)} />
    </span>
  )
}
