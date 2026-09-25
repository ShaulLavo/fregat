import type { ConnectionError } from '@workspace/contracts'
import {
  sameConnectionError,
  type EnvironmentPhase,
} from '@workspace/client-core/environments/utils/connection'

/** The server-side SSH check and the browser's own check both name a server built for another protocol. */
const protocolMismatchCodes: ReadonlySet<string> = new Set([
  'machines.SSH_PROTOCOL',
  'ENVIRONMENT_PROTOCOL_MISMATCH',
])

/** Update failures the update button can retry once the fix is applied. */
const retryableUpdateCodes: ReadonlySet<string> = new Set([
  'machines.SSH_UPDATE_NO_BUN',
  'machines.SSH_UPDATE_OLD_BUN',
  'machines.SSH_UPDATE_TRANSFER',
  'machines.SSH_UPDATE_INSTALL',
  'machines.SSH_UPDATE_IMMUTABLE',
])

/** The update button's label for a machine whose server the primary can install or replace. */
export function serverUpdateLabel(error: ConnectionError | null) {
  if (!error) return null
  if (error.code === 'machines.SSH_NOT_INSTALLED') return 'Install server'
  if (error.code === 'machines.SSH_PROTOCOL' || retryableUpdateCodes.has(error.code))
    return 'Update server'
  return null
}

export function connectionPending(phase: EnvironmentPhase) {
  return phase === 'launching' || phase === 'connecting' || phase === 'reconnecting'
}

export function connectionNoticeSummary(phase: EnvironmentPhase, error: ConnectionError | null) {
  if (phase === 'launching') return 'Starting server…'
  if (phase === 'connecting') return 'Connecting…'
  if (phase === 'reconnecting') return 'Reconnecting…'
  if (phase === 'identity-drift') return 'Machine identity changed'
  if (error && protocolMismatchCodes.has(error.code)) return 'Protocol mismatch'
  if (error?.code === 'machines.SSH_NOT_INSTALLED') return 'Server setup needed'
  if (error?.code.startsWith('machines.SSH_UPDATE_')) return 'Server update failed'
  if (phase === 'blocked') return 'Could not connect'
  return 'Disconnected'
}

export function connectionNoticeDismissed(
  dismissed: Readonly<Record<string, ConnectionError | null>>,
  id: string,
  phase: EnvironmentPhase,
  error: ConnectionError | null,
) {
  if (!Object.hasOwn(dismissed, id)) return false
  return connectionPending(phase) || sameConnectionError(dismissed[id] ?? null, error)
}
