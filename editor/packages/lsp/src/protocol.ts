import type * as lsp from 'vscode-languageserver-protocol'

const JSON_RPC_VERSION = '2.0'
export const METHOD_NOT_FOUND = -32601
export const REQUEST_CANCELLED = -32800

export type LspRequestId = number | string

export class LspResponseError extends Error {
  public readonly code: number
  public readonly data: unknown

  public constructor(error: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }) {
    super(error.message)
    this.name = 'LspResponseError'
    this.code = error.code
    this.data = error.data
  }
}

/**
 * Sent just before a server's transport closes, by the server or on its behalf, saying why. A bare
 * close reads the same as a healthy idle one, so without this a dead server looks like a quiet one.
 * `$/` because it is implementation-defined, which the protocol permits clients to ignore.
 */
export const LSP_SERVER_EXITED = '$/serverExited'

export type LspServerExitedParams = {
  /** How the server ended: `crashed` for a worker that threw, a process outcome otherwise. */
  readonly outcome: string
  readonly serverId?: string
  readonly exitCode?: number | null
  readonly exitSignal?: string | null
  readonly stderrTail?: string
  /** Guidance for the user; absent when the host closed the server on purpose. */
  readonly error?: {
    readonly code?: string
    readonly message: string
    readonly why?: string
    readonly fix?: string
  }
}

/** A transport that closed after the server said why; the close is reported as this. */
export class LspServerExitedError extends Error {
  public readonly params: LspServerExitedParams

  public constructor(params: LspServerExitedParams) {
    super(params.error?.message ?? `Language server ${params.outcome}`)
    this.name = 'LspServerExitedError'
    this.params = params
  }
}

export class LspRequestCancelledError extends Error {
  public readonly code = REQUEST_CANCELLED

  public constructor(message = 'LSP request cancelled') {
    super(message)
    this.name = 'LspRequestCancelledError'
  }
}

export const createRequestMessage = (
  id: LspRequestId,
  method: string,
  params: unknown,
): lsp.RequestMessage => {
  const message: lsp.RequestMessage = {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method,
  }
  if (params !== undefined) message.params = params as lsp.RequestMessage['params']
  return message
}

export const createNotificationMessage = (
  method: string,
  params?: unknown,
): lsp.NotificationMessage => {
  const message: lsp.NotificationMessage = {
    jsonrpc: JSON_RPC_VERSION,
    method,
  }
  if (params !== undefined) message.params = params as lsp.NotificationMessage['params']
  return message
}

export const createMethodNotFoundResponse = (
  id: LspRequestId | null,
  method: string,
): lsp.ResponseMessage => ({
  jsonrpc: JSON_RPC_VERSION,
  id,
  error: {
    code: METHOD_NOT_FOUND,
    message: `Method not implemented: ${method}`,
  },
})

export const createResponseMessage = (
  id: LspRequestId | null,
  result: unknown,
): lsp.ResponseMessage => ({
  jsonrpc: JSON_RPC_VERSION,
  id,
  result: result === undefined ? null : result,
})

export const createInternalErrorResponse = (
  id: LspRequestId | null,
  error: unknown,
): lsp.ResponseMessage => ({
  jsonrpc: JSON_RPC_VERSION,
  id,
  error: {
    code: -32603,
    message: error instanceof Error ? error.message : String(error),
  },
})

export const isResponseMessage = (message: unknown): message is lsp.ResponseMessage => {
  if (!isObject(message)) return false
  return 'id' in message && !('method' in message)
}

export const isRequestMessage = (message: unknown): message is lsp.RequestMessage => {
  if (!isObject(message)) return false
  return 'id' in message && typeof message.method === 'string'
}

export const isNotificationMessage = (message: unknown): message is lsp.NotificationMessage => {
  if (!isObject(message)) return false
  return !('id' in message) && typeof message.method === 'string'
}

export const responseResult = <TResult>(message: lsp.ResponseMessage): TResult => {
  if (message.error) throw new LspResponseError(message.error)
  return message.result as TResult
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
