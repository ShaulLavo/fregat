import { pathToFileURL } from 'node:url'
import path from 'node:path'
import * as v from 'valibot'
import { LspClient, type LspTransportHandler } from '@singapore-editor/lsp'
import { createRpcError } from '@workspace/client-core/transport/rpc-error'
import { readServerPaths } from '@workspace/client-core/files/read'
import { LSP_SERVER_EXITED } from '@workspace/contracts'
import type { SettingsSession } from '@/connection/state/session'
import type { ServiceSocket } from '@/connection/utils/service-socket'
import { connectionFailure } from '@/connection/utils/failure'
import { createTuiError } from '@/host/utils/structured-errors'
import { lspLanguageForPath } from '@/viewer/utils/language'
import {
  diagnosticsSchema,
  definitionLocations,
  hoverText,
  type ViewerDiagnostics,
} from '@/viewer/utils/lsp'
import type { ViewerPosition } from '@/viewer/utils/find'

export function createViewerLsp({
  session,
  rootPath,
  filePath,
  content,
  onDiagnostics,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
  readonly filePath: string
  readonly content: string
  readonly onDiagnostics: (snapshot: ViewerDiagnostics) => void
}) {
  const lifetime = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, session.signal])
  let socket: ServiceSocket | null = null
  let workspaceRoot = ''
  let uri = ''
  const publish = (
    status: ViewerDiagnostics['status'],
    items: ViewerDiagnostics['items'] = [],
    message: string | null = null,
  ) => {
    if (!signal.aborted) onDiagnostics({ path: filePath, status, items, message })
  }
  const client = new LspClient({
    clientInfo: { name: 'platform-tui' },
    timeoutMs: 30_000,
    capabilities: {
      textDocument: { hover: { contentFormat: ['plaintext', 'markdown'] }, publishDiagnostics: {} },
    },
    notificationHandlers: {
      'textDocument/publishDiagnostics': (_client, value) => {
        const parsed = v.safeParse(diagnosticsSchema, value)
        if (parsed.success && parsed.output.uri === uri) publish('ready', parsed.output.diagnostics)
        return true
      },
      [LSP_SERVER_EXITED]: () => {
        publish('failed', [], 'Language server stopped. Reopen the file to reconnect.')
        return true
      },
    },
  })
  async function connect() {
    publish('loading')
    const [paths, matches] = await Promise.all([
      readServerPaths({ client: session.client, signal }),
      session.client.lsp.match.get({
        query: { path: filePath, root: rootPath },
        fetch: { signal },
      }),
    ])
    if (matches.error) throw createRpcError(matches.error)
    signal.throwIfAborted()
    const descriptors = v.parse(
      v.array(v.object({ root: v.string(), serverId: v.string() })),
      matches.data,
    )
    const match = descriptors[0]
    if (!match) {
      publish('unavailable', [], 'No language server is configured for this file.')
      return
    }
    workspaceRoot = paths.workspaceRoot
    uri = pathToFileURL(path.resolve(workspaceRoot, filePath)).href
    const url = new URL('/lsp', session.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.search = new URLSearchParams({
      root: rootPath,
      path: filePath,
      server: match.serverId,
    }).toString()
    socket = session.createServiceSocket(url.href)
    const transport = createSocketTransport(socket)
    socket.addEventListener('close', () => {
      client.disconnect()
      publish('failed', [], 'Language server disconnected. Reopen the file to reconnect.')
    })
    await socketReady(socket, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
    await client.connect(transport)
    signal.throwIfAborted()
    publish('ready')
    await client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: lspLanguageForPath(filePath), version: 1, text: content },
    })
    session.record({
      area: 'tui.viewer.lsp',
      path: filePath,
      serverId: match.serverId,
      outcome: 'ready',
    })
  }
  const ready = connect().catch((error) => {
    if (signal.aborted) return
    publish('failed', [], connectionFailure(error).message)
    session.record({
      area: 'tui.viewer.lsp',
      path: filePath,
      outcome: 'failed',
      error: connectionFailure(error).message,
    })
  })
  async function request(method: string, position: ViewerPosition) {
    await ready
    signal.throwIfAborted()
    if (!client.initialized)
      throw createTuiError(
        'Language server is not ready.',
        'Check the Problems panel for the connection status.',
      )
    return client.request(method, { textDocument: { uri }, position }, { signal })
  }
  return {
    ready,
    async hover(position: ViewerPosition) {
      return hoverText(await request('textDocument/hover', position))
    },
    async definitions(position: ViewerPosition) {
      return definitionLocations(await request('textDocument/definition', position), workspaceRoot)
    },
    dispose() {
      lifetime.abort()
      if (client.initialized)
        void client
          .notify('textDocument/didClose', { textDocument: { uri } })
          .catch(() => undefined)
      client.disconnect()
      socket?.close()
    },
  }
}

function createSocketTransport(socket: ServiceSocket) {
  const listeners = new Set<LspTransportHandler>()
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    for (const listener of listeners) listener(event.data)
  })
  return {
    send: (message: string) => socket.send(message),
    subscribe: (listener: LspTransportHandler) => {
      listeners.add(listener)
    },
    unsubscribe: (listener: LspTransportHandler) => {
      listeners.delete(listener)
    },
  }
}

function socketReady(socket: ServiceSocket, signal: AbortSignal) {
  if (socket.readyState === 1) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('open', opened)
      socket.removeEventListener('close', failed)
      socket.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
    }
    const opened = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(
        createTuiError('Language server connection failed.', 'Check the server logs and retry.'),
      )
    }
    const aborted = () => {
      cleanup()
      reject(signal.reason)
    }
    socket.addEventListener('open', opened)
    socket.addEventListener('close', failed)
    socket.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}
