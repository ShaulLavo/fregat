import type * as lsp from 'vscode-languageserver-protocol'

export const JSON_RPC_VERSION = '2.0'
export const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603
export const REQUEST_FAILED = -32803

export type JsonRpcRequestId = number | string

export type JsonRpcResponseError = {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function rpcError(code: number, message: string): JsonRpcResponseError {
  return { code, message }
}

export function responseErrorFromThrown(error: unknown): JsonRpcResponseError {
  if (isRpcError(error)) return error
  return rpcError(INTERNAL_ERROR, errorMessage(error))
}

function isRpcError(error: unknown): error is JsonRpcResponseError {
  if (!isRecord(error)) return false
  return typeof error.code === 'number' && typeof error.message === 'string'
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function parseIncomingMessage(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data) as unknown
  } catch {
    return null
  }
}

export function isRequestMessage(message: unknown): message is lsp.RequestMessage {
  if (!isRecord(message)) return false
  return 'id' in message && typeof message.method === 'string'
}

export function isNotificationMessage(message: unknown): message is lsp.NotificationMessage {
  if (!isRecord(message)) return false
  return !('id' in message) && typeof message.method === 'string'
}

export function requestId(message: lsp.RequestMessage): JsonRpcRequestId | null {
  const id = message.id
  if (typeof id === 'number' || typeof id === 'string') return id
  return null
}

export function textDocumentItemFromParams(params: unknown): lsp.TextDocumentItem | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null

  const textDocument = params.textDocument
  if (typeof textDocument.uri !== 'string') return null
  if (typeof textDocument.languageId !== 'string') return null
  if (typeof textDocument.version !== 'number') return null
  if (typeof textDocument.text !== 'string') return null
  return textDocument as unknown as lsp.TextDocumentItem
}

export function didChangeParams(params: unknown): {
  readonly uri: lsp.DocumentUri
  readonly version: number
  readonly contentChanges: readonly lsp.TextDocumentContentChangeEvent[]
} | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null
  if (!Array.isArray(params.contentChanges)) return null

  const textDocument = params.textDocument
  if (typeof textDocument.uri !== 'string') return null
  if (typeof textDocument.version !== 'number') return null
  return {
    uri: textDocument.uri,
    version: textDocument.version,
    contentChanges: params.contentChanges as lsp.TextDocumentContentChangeEvent[],
  }
}

export function textDocumentUri(params: unknown): lsp.DocumentUri | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null
  return typeof params.textDocument.uri === 'string' ? params.textDocument.uri : null
}

export function positionParam(params: unknown): lsp.Position | null {
  if (!isRecord(params)) return null
  return lspPositionFromValue(params.position)
}

export function rangeParam(params: unknown): lsp.Range | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.range)) return null

  const start = lspPositionFromValue(params.range.start)
  const end = lspPositionFromValue(params.range.end)
  if (!start || !end) return null

  return { start, end }
}

function lspPositionFromValue(value: unknown): lsp.Position | null {
  if (!isRecord(value)) return null
  if (typeof value.line !== 'number') return null
  if (typeof value.character !== 'number') return null

  return { line: value.line, character: value.character }
}

export function stringParam(params: unknown, key: string): string | null {
  if (!isRecord(params)) return null
  const value = params[key]
  return typeof value === 'string' ? value : null
}
