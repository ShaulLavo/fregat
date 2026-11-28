import { lineStartOffset } from '@workspace/utils/strings'
import { isRecord } from '@workspace/utils/objects'

export type JsonRpcId = number | string | null

export type JsonRpcRequest = {
  readonly id: JsonRpcId
  readonly jsonrpc?: string
  readonly method: string
  params?: unknown
}

export type JsonRpcNotification = {
  readonly jsonrpc?: string
  readonly method: string
  params?: unknown
}

export type JsonRpcResponse = {
  readonly id: JsonRpcId
  readonly jsonrpc?: string
  readonly result?: unknown
  readonly error?: unknown
}

export type DidOpenDocument = {
  readonly languageId: string
  readonly text: string
  readonly uri: string
  readonly version: number
}

type DidChangeDocument = {
  readonly contentChanges: readonly TextDocumentContentChange[]
  readonly uri: string
  readonly version: number
}

type TextDocumentContentChange = {
  readonly rangeLength?: number
  readonly range?: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly text: string
}

/** LSP's own codes for "you cancelled this" and "the text moved under it". */
export const REQUEST_CANCELLED_CODE = -32800
export const CONTENT_MODIFIED_CODE = -32801

/**
 * The value at a dotted `section`, or the whole tree when the item names none.
 *
 * `{}` rather than `null` for a section the registry says nothing about: LSP
 * lets a client answer either, and a server that reads a field off the result
 * without checking is common enough that the shape a bare `[{}]` already gave it
 * is the safer of the two.
 */
export function configurationSection(
  configuration: Readonly<Record<string, unknown>>,
  section: unknown,
) {
  if (typeof section !== 'string' || section.length === 0) return configuration

  let value: unknown = configuration
  for (const key of section.split('.')) {
    // A section that does not resolve is answered `{}`, never the whole tree.
    // Handing back everything would tell a server asking about *itself* what
    // some other server was configured with, and would make an unknown section
    // indistinguishable from a request that named none.
    if (!isRecord(value)) return {}

    value = value[key]
  }

  return value ?? {}
}

export function safeSum(left: number, right: number): number | null {
  const result = left + right
  if (!Number.isSafeInteger(result)) return null
  if (result < 0) return null

  return result
}

export type InitializeContract = {
  readonly value: unknown
  /** Canonical JSON: equal params in any key order share one backend. */
  readonly fingerprint: string
}

/** `processId` is the backend's own pid, so it differs between siblings and is left out. */
export function initializeContractOf(params: unknown): InitializeContract {
  const { processId: _processId, ...rest } = isRecord(params) ? params : {}
  const value = immutableProtocolValue(rest)
  return { value, fingerprint: JSON.stringify(value, canonicalJsonKeys) }
}

function canonicalJsonKeys(_key: string, value: unknown): unknown {
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)),
  )
}

function immutableProtocolValue(value: unknown): unknown {
  return freezeProtocolValue(structuredClone(value))
}

function freezeProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) freezeProtocolValue(item)
    return Object.freeze(value)
  }
  if (!isRecord(value)) return value

  for (const item of Object.values(value)) freezeProtocolValue(item)
  return Object.freeze(value)
}

/** Where two protocol values first differ, as a dotted path, or `null` when they are equal. */
export function protocolValueDifference(
  left: unknown,
  right: unknown,
  path: string,
): string | null {
  if (Object.is(left, right)) return null
  if (Array.isArray(left) || Array.isArray(right)) return protocolArrayDifference(left, right, path)
  if (!isRecord(left) || !isRecord(right)) return path

  return protocolRecordDifference(left, right, path)
}

function protocolArrayDifference(left: unknown, right: unknown, path: string): string | null {
  if (!Array.isArray(left) || !Array.isArray(right)) return path
  if (left.length !== right.length) return `${path}.length`

  for (let index = 0; index < left.length; index += 1) {
    const difference = protocolValueDifference(left[index], right[index], `${path}[${index}]`)
    if (difference !== null) return difference
  }
  return null
}

function protocolRecordDifference(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  path: string,
): string | null {
  for (const key of new Set(Object.keys(left).concat(Object.keys(right)))) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return `${path}.${key}`
    const difference = protocolValueDifference(left[key], right[key], `${path}.${key}`)
    if (difference !== null) return difference
  }
  return null
}

export function normalizeClientMessage(message: string | ArrayBuffer | Uint8Array) {
  if (typeof message === 'string') return message
  if (message instanceof ArrayBuffer) return Buffer.from(message).toString('utf8')
  if (message instanceof Uint8Array) return Buffer.from(message).toString('utf8')

  return null
}

export function parseJsonMessage(message: string) {
  try {
    return JSON.parse(message) as unknown
  } catch {
    return null
  }
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value)) return false
  if (typeof value.method !== 'string') return false
  if (!('id' in value)) return false

  return isJsonRpcId(value.id)
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  if (!isRecord(value)) return false
  if (typeof value.method !== 'string') return false

  return !('id' in value)
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!isRecord(value)) return false
  if (!('id' in value)) return false
  if ('method' in value) return false
  if (!('result' in value) && !('error' in value)) return false

  return isJsonRpcId(value.id)
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string' || value === null
}

export function didOpenDocument(params: unknown): DidOpenDocument | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null

  const document = params.textDocument
  if (typeof document.uri !== 'string') return null
  if (typeof document.languageId !== 'string') return null
  if (typeof document.text !== 'string') return null
  if (!isSafeDocumentVersion(document.version)) return null

  return {
    languageId: document.languageId,
    text: document.text,
    uri: document.uri,
    version: document.version,
  }
}

export function didChangeDocument(params: unknown): DidChangeDocument | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null
  if (!Array.isArray(params.contentChanges)) return null

  const uri = params.textDocument.uri
  const version = params.textDocument.version
  if (typeof uri !== 'string') return null
  if (!isSafeDocumentVersion(version)) return null
  if (!params.contentChanges.every(isTextDocumentContentChange)) return null

  return {
    contentChanges: params.contentChanges,
    uri,
    version,
  }
}

function isTextDocumentContentChange(value: unknown): value is TextDocumentContentChange {
  if (!isRecord(value)) return false
  if (typeof value.text !== 'string') return false
  if (value.range === undefined) return value.rangeLength === undefined
  if (!isTextDocumentRange(value.range)) return false
  if (value.rangeLength === undefined) return true

  return isSafeNonNegativeInteger(value.rangeLength)
}

function isTextDocumentRange(value: unknown): value is TextDocumentContentChange['range'] {
  if (!isRecord(value)) return false
  if (!isTextDocumentPosition(value.start)) return false

  return isTextDocumentPosition(value.end)
}

function isTextDocumentPosition(
  value: unknown,
): value is { readonly line: number; readonly character: number } {
  if (!isRecord(value)) return false
  if (!isSafeNonNegativeInteger(value.line)) return false

  return isSafeNonNegativeInteger(value.character)
}

export function isSafeDocumentVersion(value: unknown): value is number {
  return isSafeNonNegativeInteger(value)
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  if (typeof value !== 'number') return false
  if (value < 0) return false

  return Number.isSafeInteger(value)
}

export function textDocumentUri(params: unknown): string | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null

  return typeof params.textDocument.uri === 'string' ? params.textDocument.uri : null
}

export function cancellationRequestId(params: unknown): JsonRpcId | null {
  if (!isRecord(params)) return null

  return isJsonRpcId(params.id) ? params.id : null
}

export function responseForClient(response: JsonRpcResponse, id: JsonRpcId): JsonRpcResponse {
  return { ...response, id }
}

export function jsonRpcResult(id: JsonRpcId, result: unknown): string {
  return JSON.stringify({
    id,
    jsonrpc: '2.0',
    result,
  })
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string): string {
  return JSON.stringify({
    error: { code, message },
    id,
    jsonrpc: '2.0',
  })
}

export function serverNotificationForClient(message: JsonRpcNotification, raw: string): string {
  if (message.method !== 'textDocument/publishDiagnostics') return raw
  if (!isRecord(message.params)) return raw

  const { version: _version, ...params } = message.params
  return JSON.stringify({ ...message, params })
}

export function applyContentChangesStrict(
  text: string,
  changes: readonly TextDocumentContentChange[],
): string | null {
  let next = text
  for (const change of changes) {
    const changed = applyContentChangeStrict(next, change)
    if (changed === null) return null

    next = changed
  }

  return next
}

function applyContentChangeStrict(text: string, change: TextDocumentContentChange): string | null {
  if (!change.range) return change.text

  const start = strictOffsetForPosition(text, change.range.start)
  const end = strictOffsetForPosition(text, change.range.end)
  if (start === null || end === null) return null
  if (end < start) return null
  if (change.rangeLength !== undefined && change.rangeLength !== end - start) return null

  return `${text.slice(0, start)}${change.text}${text.slice(end)}`
}

function strictOffsetForPosition(
  text: string,
  position: { readonly line: number; readonly character: number },
): number | null {
  const lineStart = lineStartOffset(text, position.line)
  if (lineStart === null) return null

  const newline = text.indexOf('\n', lineStart)
  const rawLineEnd = newline < 0 ? text.length : newline
  const lineEnd =
    rawLineEnd > lineStart && text[rawLineEnd - 1] === '\r' ? rawLineEnd - 1 : rawLineEnd
  if (position.character > lineEnd - lineStart) return null

  return lineStart + position.character
}

export function byteLength(value: string | ArrayBuffer | Uint8Array): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  if (value instanceof ArrayBuffer) return value.byteLength

  return value.byteLength
}

export function rewriteTextDocumentVersion(message: JsonRpcNotification, version: number) {
  const params = isRecord(message.params) ? message.params : {}
  const textDocument = isRecord(params.textDocument) ? params.textDocument : {}
  return {
    ...message,
    params: {
      ...params,
      textDocument: { ...textDocument, version },
    },
  }
}

export function withWatchedFilesCapability(capabilities: unknown) {
  const client = isRecord(capabilities) ? capabilities : {}
  const workspace = isRecord(client.workspace) ? client.workspace : {}
  return {
    ...client,
    workspace: {
      ...workspace,
      didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
    },
  }
}

export function capabilityChanges(params: unknown, field: 'registrations' | 'unregisterations') {
  const changes = isRecord(params) && Array.isArray(params[field]) ? params[field] : []
  return changes.flatMap((change: unknown) =>
    isRecord(change) && typeof change.id === 'string' && typeof change.method === 'string'
      ? [{ id: change.id, method: change.method, registerOptions: change.registerOptions }]
      : [],
  )
}

export function supportsPullDiagnostics(result: unknown) {
  return (
    isRecord(result) &&
    isRecord(result.capabilities) &&
    Boolean(result.capabilities.diagnosticProvider)
  )
}

export function publishedDiagnostics(notification: string | null): readonly unknown[] | null {
  if (!notification) return null
  const message: unknown = JSON.parse(notification)
  if (!isRecord(message) || !isRecord(message.params)) return null
  return Array.isArray(message.params.diagnostics) ? message.params.diagnostics : null
}
