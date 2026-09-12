import type { EnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import type { SessionDetailSyncState } from '@/features/chat/state/session-detail-sync-store'

export type ComposerConnection =
  | { readonly kind: 'live' }
  | {
      readonly kind: 'syncing' | 'reconnecting' | 'disconnected'
      readonly label: string
      readonly detail: string | null
    }

export function composerConnection({
  closed,
  sync,
  unavailable,
}: {
  closed: boolean
  sync: SessionDetailSyncState
  unavailable: EnvironmentEntry | null
}): ComposerConnection {
  if (closed)
    return {
      kind: 'disconnected',
      label: 'Connection closed',
      detail: 'Reconnect to continue this chat.',
    }
  if (unavailable) {
    const machine = unavailable.label ?? unavailable.name
    const reconnecting = unavailable.phase === 'reconnecting' || unavailable.phase === 'connecting'
    return {
      kind: reconnecting ? 'reconnecting' : 'disconnected',
      label: reconnecting ? `Reconnecting to ${machine}…` : `${machine} disconnected`,
      detail: 'You can keep drafting while we reconnect.',
    }
  }
  if (sync.status === 'blocked') {
    return { kind: 'disconnected', label: 'Chat disconnected', detail: sync.error }
  }
  if (sync.status === 'reconnecting') {
    return { kind: 'reconnecting', label: 'Reconnecting chat…', detail: sync.error }
  }
  if (sync.status === 'connecting') {
    return { kind: 'syncing', label: 'Syncing messages…', detail: null }
  }

  return { kind: 'live' }
}
