import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'

export function connectionPending(phase: EnvironmentPhase) {
  return phase === 'launching' || phase === 'connecting' || phase === 'reconnecting'
}

export function connectionNoticeSummary(phase: EnvironmentPhase, error: string | null) {
  if (phase === 'launching') return 'Starting server…'
  if (phase === 'connecting') return 'Connecting…'
  if (phase === 'reconnecting') return 'Reconnecting…'
  if (phase === 'identity-drift') return 'Machine identity changed'
  if (error?.includes('Platform server is not installed')) return 'Server setup needed'
  if (phase === 'blocked') return 'Could not connect'
  return 'Disconnected'
}

export function connectionNoticeDismissed(
  dismissed: Readonly<Record<string, string | null>>,
  id: string,
  phase: EnvironmentPhase,
  error: string | null,
) {
  if (!Object.hasOwn(dismissed, id)) return false
  return connectionPending(phase) || dismissed[id] === error
}
