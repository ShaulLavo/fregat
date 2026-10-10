import { clientErrorDescription } from '@/lib/client-error-taxonomy'
import type { ConnectedMachine } from '@/state/environment-connections'

const PENDING = new Set(['idle', 'launching', 'connecting', 'reconnecting'])

/** Why a machine the flow waits on stopped connecting, or null while it may still arrive. */
export function connectionFailure(record: ConnectedMachine | undefined, label: string) {
  if (record && (PENDING.has(record.phase) || record.phase === 'live')) return null
  if (record?.lastError) return clientErrorDescription(record.lastError)
  return `${label} disconnected. Connect it again.`
}
