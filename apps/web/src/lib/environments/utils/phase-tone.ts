import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import type { StatusDotTone } from '@workspace/ui/components/status-dot'

export function phaseTone(phase: EnvironmentPhase): StatusDotTone {
  if (phase === 'live') return 'success'
  if (phase === 'offline') return 'warning'
  if (phase === 'blocked' || phase === 'identity-drift') return 'destructive'

  return 'neutral'
}
