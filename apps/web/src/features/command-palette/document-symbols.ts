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

type DocumentSymbol = {
  children?: readonly DocumentSymbol[]
  kind: number
  name: string
  range: DocumentSymbolRange
  selectionRange: DocumentSymbolRange
}

type JsonRpcResponse = {
  error?: { message?: string }
  id?: number | string | null
  result?: unknown
}

export async function fetchDocumentSymbols(
  {
    path,
    rootPath,
    signal,
    text,
  }: {
    path: string
    rootPath: string
    signal: AbortSignal
    text?: string | null
  },
  client: Client,
): Promise<readonly FlatDocumentSymbol[]> {
  const symbols = await requestDocumentSymbols(
    {
      path,
      rootPath,
      signal,
      text,
    },
    client,
  ).catch((error: unknown) => {
    if (signal?.aborted) throw error
    return []
  })
  return flattenDocumentSymbols(symbols)
}

function requestDocumentSymbols(
  {
    path,
    rootPath,
    signal,
    text,
  }: {
    path: string
    rootPath: string
    signal: AbortSignal
    text?: string | null
  },
  client: Client,
) {
  return new Promise<readonly DocumentSymbol[]>((resolve, reject) => {
    if (signal?.aborted) {
      reject(clientErrors.DOCUMENT_SYMBOL_ABORTED())
      return
    }

    const socket = connectLanguageServerSocket({ path, rootPath }, client, signal)
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

function documentSymbolsFromResult(result: unknown): readonly DocumentSymbol[] {
  if (!Array.isArray(result)) return []

  return result.flatMap((value) => {
    if (!isDocumentSymbol(value)) return []

    return [value]
  })
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

function fileUriForPath(path: string) {
  const normalized = path.replace(/^\/+/, '')
  return `file:///${normalized.split('/').map(encodeURIComponent).join('/')}`
}

function languageIdForPath(path: string) {
  if (path.endsWith('.tsx')) return 'typescriptreact'
  if (path.endsWith('.jsx')) return 'javascriptreact'
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript'

  return 'typescript'
}
