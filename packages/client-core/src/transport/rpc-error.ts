import { errorNumberField, errorStringField } from '@workspace/contracts'
import { createClientError } from '../errors'

export function rpcErrorPayload(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error
  const container = 'value' in error ? error.value : error
  if (!container || typeof container !== 'object') return container
  return 'error' in container ? container.error : container
}

export function createRpcError(error: unknown) {
  const payload = rpcErrorPayload(error)
  return createClientError({
    cause: error,
    code: errorStringField(payload, 'code') ?? 'client.RPC_FAILED',
    message: errorStringField(payload, 'message') ?? 'The server request failed.',
    status: errorNumberField(error, 'status') ?? errorNumberField(payload, 'status') ?? 502,
    why: errorStringField(payload, 'why') ?? 'The server answered with an error.',
    fix:
      errorStringField(payload, 'fix') ??
      'Try again. If it keeps failing, open the Logs panel to see what went wrong.',
  })
}
