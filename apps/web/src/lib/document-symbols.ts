import { type LspTransportHandler } from '@singapore-editor/lsp/types'
import { LspClient, composeWorkspaceEditClientCapabilities } from '@singapore-editor/lsp'
import { fileUriForPath, type LspMatch } from '@workspace/contracts'

import { connectLanguageServerSocket, type EdenServerSocket } from '@/lib/server-sockets'
import { clientErrors } from '@/lib/structured-errors'
import type { Client } from '@/lib/client'
import { log } from '@/lib/client-logging'
import {
  clientCapabilitiesForServer,
  LANGUAGE_SERVER_CLIENT_INFO,
  LANGUAGE_SERVER_REQUEST_TIMEOUT_MS,
} from '@/lib/language-server-capabilities'

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

export async function fetchDocumentSymbolTree(
  request: DocumentSymbolsRequest,
  client: Client,
  connectSocket = connectLanguageServerSocket,
): Promise<readonly DocumentSymbol[]> {
  return requestDocumentSymbols(request, client, connectSocket).catch((error: unknown) => {
    if (request.signal.aborted) throw error
    log.warn({
      action: 'lsp.document_symbols',
      area: 'lsp',
      outcome: 'failed',
      path: request.path,
      rootPath: request.rootPath,
      serverId: request.serverId,
      error: clientErrors.DOCUMENT_SYMBOL_FAILED({
        cause: error instanceof Error ? error : undefined,
        internal: { serverId: request.serverId, rootPath: request.rootPath },
      }),
    })
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
  connectSocket: typeof connectLanguageServerSocket,
) {
  return new Promise<readonly DocumentSymbol[]>((resolve, reject) => {
    if (signal?.aborted) {
      reject(clientErrors.DOCUMENT_SYMBOL_ABORTED({ internal: { at: 'before-connect', serverId } }))
      return
    }

    const socket = connectSocket({ path, rootPath, serverId }, client, signal)
    const languageClient = new LspClient({
      rootUri: fileUriForPath(rootPath),
      clientInfo: LANGUAGE_SERVER_CLIENT_INFO,
      timeoutMs: LANGUAGE_SERVER_REQUEST_TIMEOUT_MS,
      capabilities: composeWorkspaceEditClientCapabilities(
        clientCapabilitiesForServer(serverId),
        true,
      ),
    })
    const handlers = new Set<LspTransportHandler>()
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return

      settled = true
      signal?.removeEventListener('abort', abort)
      languageClient.disconnect()
      socket.close()
      callback()
    }
    const abort = () =>
      finish(() =>
        reject(clientErrors.DOCUMENT_SYMBOL_ABORTED({ internal: { at: 'in-flight', serverId } })),
      )

    signal?.addEventListener('abort', abort, { once: true })
    const succeed = (result: unknown) => finish(() => resolve(documentSymbolsFromResult(result)))
    const fail = (error: unknown) => finish(() => reject(error))
    socket.addEventListener('open', () => {
      void readConnectedSymbols(languageClient, socket, handlers, { path, text, signal }).then(
        succeed,
        fail,
      )
    })
    socket.addEventListener('message', (event) => dispatchSocketMessage(handlers, event))
    socket.addEventListener('error', () =>
      finish(() =>
        reject(clientErrors.DOCUMENT_SYMBOL_SOCKET_FAILED({ internal: { serverId, rootPath } })),
      ),
    )
    socket.addEventListener('close', () =>
      finish(() =>
        reject(clientErrors.DOCUMENT_SYMBOL_SOCKET_CLOSED({ internal: { serverId, rootPath } })),
      ),
    )
  })
}

function dispatchSocketMessage(handlers: ReadonlySet<LspTransportHandler>, event: Event) {
  if (!(event instanceof MessageEvent)) return
  const data: unknown = event.data
  if (typeof data !== 'string') return
  for (const handler of handlers) handler(data)
}

async function readConnectedSymbols(
  languageClient: LspClient,
  socket: EdenServerSocket,
  handlers: Set<LspTransportHandler>,
  { path, text, signal }: Pick<DocumentSymbolsRequest, 'path' | 'text' | 'signal'>,
) {
  await languageClient.connect({
    send: (message) => socket.send(message),
    subscribe: (handler) => {
      handlers.add(handler)
    },
    unsubscribe: (handler) => {
      handlers.delete(handler)
    },
  })
  signal.throwIfAborted()
  sendOpenDocument(socket, path, text)
  return languageClient.request(
    'textDocument/documentSymbol',
    {
      textDocument: { uri: fileUriForPath(path) },
    },
    { signal },
  )
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

function languageIdForPath(path: string) {
  if (path.endsWith('.tsx')) return 'typescriptreact'
  if (path.endsWith('.jsx')) return 'javascriptreact'
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript'

  return 'typescript'
}
