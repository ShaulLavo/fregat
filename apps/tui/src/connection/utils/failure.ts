import { errorStringField, TUI_CLIENT_ORIGIN } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'

export type ConnectionFailure = ReturnType<typeof connectionFailure>

export function connectionFailure(error: unknown) {
  const detail = failureDetails(error)
  const code = errorStringField(detail, 'code') ?? 'TUI_CONNECTION_FAILED'
  return {
    message: errorStringField(detail, 'message') ?? 'Could not reach the Platform server.',
    fix: errorStringField(detail, 'fix') ?? failureFix(code),
    code,
  }
}

function failureDetails(error: unknown): unknown {
  if (!isRecord(error) || !isRecord(error.value)) return error
  return isRecord(error.value.error) ? error.value.error : error.value
}

function failureFix(code: string) {
  if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN_ORIGIN') {
    return `Register ${TUI_CLIENT_ORIGIN} in SERVER_ALLOWED_ORIGINS and restart the server.`
  }
  return 'Check the server address and connection, then press Ctrl+R to retry.'
}
