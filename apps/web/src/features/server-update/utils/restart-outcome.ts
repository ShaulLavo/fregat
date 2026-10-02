import { isConnectivityError } from '@workspace/client-core/transport/connectivity-error'
import { isObject } from '@workspace/utils/objects'

// A proxy in front of the server (the mesh) answers these when the upstream went away.
const GATEWAY_STATUSES = new Set([502, 504])

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
