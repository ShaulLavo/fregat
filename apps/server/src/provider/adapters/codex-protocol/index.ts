import * as v from 'valibot'
import {
  CODEX_CLIENT_REQUEST_PARAMS,
  CODEX_CLIENT_REQUEST_RESULTS,
  CODEX_SERVER_NOTIFICATION_PARAMS,
  type CodexClientRequestMethod,
  type CodexClientRequestParamsByMethod,
  type CodexClientRequestResultByMethod,
  type CodexServerNotificationMethod,
  type CodexServerNotificationParamsByMethod,
} from './generated/meta.gen'

export * from './generated/meta.gen'
export * from './generated/schema.gen'

export class CodexProtocolError extends Error {
  readonly detail: string

  constructor(label: string, detail: string) {
    super(`Codex app-server protocol error for ${label}: ${detail}`)
    this.name = 'CodexProtocolError'
    this.detail = detail
  }
}

export function parseCodexClientRequestParams<Method extends CodexClientRequestMethod>(
  method: Method,
  value: unknown,
): CodexClientRequestParamsByMethod[Method] {
  return parseCodexProtocolValue(
    CODEX_CLIENT_REQUEST_PARAMS[method],
    value,
    `${method} request`,
  ) as CodexClientRequestParamsByMethod[Method]
}

export function parseCodexClientRequestResult<Method extends CodexClientRequestMethod>(
  method: Method,
  value: unknown,
): CodexClientRequestResultByMethod[Method] {
  return parseCodexProtocolValue(
    CODEX_CLIENT_REQUEST_RESULTS[method],
    value,
    `${method} response`,
  ) as CodexClientRequestResultByMethod[Method]
}

export function parseCodexServerNotification<Method extends CodexServerNotificationMethod>(
  method: Method,
  value: unknown,
): CodexServerNotificationParamsByMethod[Method] {
  return parseCodexProtocolValue(
    CODEX_SERVER_NOTIFICATION_PARAMS[method],
    value,
    `${method} notification`,
  ) as CodexServerNotificationParamsByMethod[Method]
}

function parseCodexProtocolValue(schema: v.GenericSchema, value: unknown, label: string) {
  const result = v.safeParse(schema, value)
  if (result.success) return result.output

  throw new CodexProtocolError(label, v.summarize(result.issues))
}
