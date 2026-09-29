import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'

const PHASE_LABELS: Record<EnvironmentPhase, string> = {
  idle: 'Not connected',
  launching: 'Starting',
  connecting: 'Connecting',
  live: 'Connected',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  blocked: 'Could not connect',
  'identity-drift': 'Identity changed',
}

export function machinePhaseLabel(phase: EnvironmentPhase) {
  return PHASE_LABELS[phase]
}
