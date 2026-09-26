import type { ServerConnectionState } from '@workspace/client-core/environments/utils/connection'
import { isConnectivityError } from '@workspace/client-core/transport/connectivity-error'
import type { ServerUpdate } from '@workspace/contracts'
import { isObject } from '@workspace/utils/objects'

// A proxy in front of the server (the mesh) answers these when the upstream went away.
const GATEWAY_STATUSES = new Set([502, 504])

/** A local "restarting" guess, valid only while `update` is still the latest push. */
export type RestartMarker = {
  readonly update: ServerUpdate
  /** The server instance the tab was connected to when it asked. */
  readonly instance: string | null
  /** The server answered `restarting`; a dropped request only guesses it. */
  readonly confirmed: boolean
}

/** The server may exit before its answer flushes, so a dropped connection may mean it is restarting. */
export function isRestartDisconnect(error: unknown): boolean {
  if (isConnectivityError(error)) return true
  if (!isObject(error)) return false
  // Eden answers a failed fetch with a 503 whose `value` is the TypeError; createRpcError wraps it.
  if ('value' in error && isConnectivityError(error.value)) return true
  if ('status' in error && typeof error.status === 'number' && GATEWAY_STATUSES.has(error.status))
    return true
  const cause = causeOf(error)
  return cause !== undefined && cause !== error && isRestartDisconnect(cause)
}

// createClientError keeps an Error on `cause` and anything else (an Eden envelope) on `internal.cause`.
function causeOf(error: object): unknown {
  if ('cause' in error && error.cause !== undefined) return error.cause
  if (!('internal' in error) || !isObject(error.internal)) return undefined
  return error.internal.cause
}

export function showsRestarting(
  update: ServerUpdate,
  marker: RestartMarker | null,
  connection: Pick<ServerConnectionState, 'phase' | 'serverInstanceId'>,
): boolean {
  if (update.phase === 'restarting') return true
  if (!marker || marker.update !== update) return false
  if (marker.confirmed) return true
  // A socket still live on the instance that was asked proves the dropped request restarted nothing.
  return connection.phase !== 'connected' || connection.serverInstanceId !== marker.instance
}
