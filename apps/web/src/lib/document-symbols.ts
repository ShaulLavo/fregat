import type { LspMatch } from '@workspace/contracts'

import { connectLanguageServerSocket, type EdenServerSocket } from '@/lib/server-sockets'
import { clientErrors } from '@/lib/structured-errors'
import type { Client } from '@/lib/client'

type DocumentSymbolRange = {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export type FlatDocumentSymbol = {
  containerName: string | null
  kind: number
  name: string
  range: DocumentSymbolRange
  selectionRange: DocumentSymbolRange
}

export type DocumentSymbol = {
  children?: readonly DocumentSymbol[]
  kind: number
  name: string
  range: DocumentSymbolRange
  selectionRange: DocumentSymbolRange
}

export type DocumentSymbolsRequest = {
  path: string
  rootPath: string
  /** The language server to ask; the socket route refuses to guess one. */
  serverId: string
  signal: AbortSignal
  text?: string | null
}

// Ranks are ascending: lower wins.
export function documentSymbolServerId(matches: readonly LspMatch[] | null): string | null {
  if (!matches || matches.length === 0) return null

  const navigating = matches
    .filter((match) => match.features.navigation !== undefined)
    .toSorted((left, right) => left.features.navigation! - right.features.navigation!)

  return (navigating[0] ?? matches[0])!.serverId
}

type JsonRpcResponse = {
  error?: { message?: string }
  id?: number | string | null
  result?: unknown
}

export async function fetchDocumentSymbolTree(
  request: DocumentSymbolsRequest,
  client: Client,
): Promise<readonly DocumentSymbol[]> {
  return requestDocumentSymbols(request, client).catch((error: unknown) => {
    if (request.signal?.aborted) throw error
    return []
  })
}

export async function fetchDocumentSymbols(
  request: DocumentSymbolsRequest,
  client: Client,
): Promise<readonly FlatDocumentSymbol[]> {
  return flattenDocumentSymbols(await fetchDocumentSymbolTree(request, client))
}

function requestDocumentSymbols(
  { path, rootPath, serverId, signal, text }: DocumentSymbolsRequest,
  client: Client,
) {
  return new Promise<readonly DocumentSymbol[]>((resolve, reject) => {
    if (signal?.aborted) {
      reject(clientErrors.DOCUMENT_SYMBOL_ABORTED())
      return
    }

    const socket = connectLanguageServerSocket({ path, rootPath, serverId }, client, signal)
    const requestId = 1
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return

      settled = true
      signal?.removeEventListener('abort', abort)
      socket.close()
      callback()
    }
    const abort = () => finish(() => reject(clientErrors.DOCUMENT_SYMBOL_ABORTED()))

    signal?.addEventListener('abort', abort, { once: true })
    socket.addEventListener('open', () => {
      sendOpenDocument(socket, path, text)
      socket.send(
        JSON.stringify({
          id: requestId,
          jsonrpc: '2.0',
          method: 'textDocument/documentSymbol',
          params: { textDocument: { uri: fileUriForPath(path) } },
        }),
      )
    })
    socket.addEventListener('message', (event) => {
      const response = parseJsonRpcResponse((event as MessageEvent).data)
      if (!response || response.id !== requestId) return
      if (response.error) {
        finish(() =>
          reject(
            clientErrors.DOCUMENT_SYMBOL_FAILED({
              message: response.error?.message ?? undefined,
            }),
          ),
        )
        return
      }

      finish(() => resolve(documentSymbolsFromResult(response.result)))
    })
    socket.addEventListener('error', () =>
      finish(() => reject(clientErrors.DOCUMENT_SYMBOL_SOCKET_FAILED())),
    )
    socket.addEventListener('close', () =>
      finish(() => reject(clientErrors.DOCUMENT_SYMBOL_SOCKET_CLOSED())),
    )
  })
}

function sendOpenDocument(socket: EdenServerSocket, path: string, text: string | null | undefined) {
  if (text === null || text === undefined) return

  socket.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          languageId: languageIdForPath(path),
          text,
          uri: fileUriForPath(path),
          version: 1,
        },
      },
    }),
  )
}

function flattenDocumentSymbols(
  symbols: readonly DocumentSymbol[],
  containerName: string | null = null,
): readonly FlatDocumentSymbol[] {
  return symbols.flatMap((symbol) => [
    {
      containerName,
      kind: symbol.kind,
      name: symbol.name,
      range: symbol.range,
      selectionRange: symbol.selectionRange,
    },
    ...flattenDocumentSymbols(symbol.children ?? [], symbol.name),
  ])
}

// Servers without hierarchical support answer the flat SymbolInformation list;
// it is nested back by container name so a method still sits under its class.
function documentSymbolsFromResult(result: unknown): readonly DocumentSymbol[] {
  if (!Array.isArray(result)) return []

  const hierarchical = result.flatMap((value) => (isDocumentSymbol(value) ? [value] : []))
  if (hierarchical.length > 0) return hierarchical

  return nestSymbolInformation(
    result.flatMap((value) => (isSymbolInformation(value) ? [value] : [])),
  )
}

type SymbolInformation = {
  containerName?: string
  kind: number
  location: { range: DocumentSymbolRange }
  name: string
}

function nestSymbolInformation(symbols: readonly SymbolInformation[]): DocumentSymbol[] {
  const roots: DocumentSymbol[] = []
  const nodes: { node: DocumentSymbol; children: DocumentSymbol[] }[] = []
  for (const info of symbols) {
    const children: DocumentSymbol[] = []
    const node: DocumentSymbol = {
      children,
      kind: info.kind,
      name: info.name,
      range: info.location.range,
      selectionRange: info.location.range,
    }
    const parent = info.containerName
      ? nodes.findLast(
          (entry) =>
            entry.node.name === info.containerName && rangeContains(entry.node.range, node.range),
        )
      : undefined
    ;(parent?.children ?? roots).push(node)
    nodes.push({ children, node })
  }

  return roots
}

function rangeContains(outer: DocumentSymbolRange, inner: DocumentSymbolRange) {
  const startsBefore =
    outer.start.line < inner.start.line ||
    (outer.start.line === inner.start.line && outer.start.character <= inner.start.character)
  const endsAfter =
    outer.end.line > inner.end.line ||
    (outer.end.line === inner.end.line && outer.end.character >= inner.end.character)

  return startsBefore && endsAfter
}

function isSymbolInformation(value: unknown): value is SymbolInformation {
  if (!value || typeof value !== 'object') return false
  if (!('name' in value) || typeof value.name !== 'string') return false
  if (!('kind' in value) || typeof value.kind !== 'number') return false
  if (!('location' in value) || !value.location || typeof value.location !== 'object') return false

  return 'range' in value.location && isRange(value.location.range)
}

function isDocumentSymbol(value: unknown): value is DocumentSymbol {
  if (!value || typeof value !== 'object') return false
  if (!('name' in value) || typeof value.name !== 'string') return false
  if (!('kind' in value) || typeof value.kind !== 'number') return false
  if (!('range' in value) || !isRange(value.range)) return false
  if (!('selectionRange' in value) || !isRange(value.selectionRange)) return false

  return !('children' in value) || Array.isArray(value.children)
}

function isRange(value: unknown): value is DocumentSymbolRange {
  if (!value || typeof value !== 'object') return false
  if (!('start' in value) || !isPosition(value.start)) return false
  return 'end' in value && isPosition(value.end)
}

function isPosition(value: unknown) {
  if (!value || typeof value !== 'object') return false
  if (!('line' in value) || typeof value.line !== 'number') return false
  return 'character' in value && typeof value.character === 'number'
}

function parseJsonRpcResponse(value: unknown): JsonRpcResponse | null {
  try {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
    if (!parsed || typeof parsed !== 'object') return null

    return parsed as JsonRpcResponse
  } catch {
    return null
  }
}

export function fileUriForPath(path: string) {
  const normalized = path.replace(/^\/+/, '')
  return `file:///${normalized.split('/').map(encodeURIComponent).join('/')}`
}

function languageIdForPath(path: string) {
  if (path.endsWith('.tsx')) return 'typescriptreact'
  if (path.endsWith('.jsx')) return 'javascriptreact'
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript'

  return 'typescript'
}
