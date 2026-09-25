import { adaptWebSocket, isAbnormalWebSocketClose, webSocketQueryValue } from '../utils/websocket'
import { LSP_SERVER_EXITED, type LspNegotiatedSemanticTokens } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import * as v from 'valibot'

import { authenticateWebSocketData, type AuthConfig } from '../auth'
import { pathSchema } from '../fs/contracts'
import type { WorkspacePaths } from '../fs/path'
import {
  bestLspMatchForFeature,
  matchDescriptor,
  matchLspServers,
  resolveLspServer,
  type LspServerMatch,
  type LspSettings,
} from './registry'
import type { LspProxyClientSession, LspSessionSource } from './proxy-session'
import { recordProcessInfo, recordProcessWarning } from '../observability'

type LspRouteFileSystem = {
  readonly paths: WorkspacePaths
}

export const lspMatchQuerySchema = v.object({
  path: pathSchema,
  root: v.optional(pathSchema, ''),
  server: v.optional(v.string()),
})

export async function lspRouteMatch(
  paths: WorkspacePaths,
  query: v.InferOutput<typeof lspMatchQuerySchema>,
  settings: LspSettings,
) {
  const matches = await resolveLspRouteMatches(paths, routeMatchInput(query), settings)
  return matches.map(matchDescriptor)
}

/**
 * What the matched server actually agreed to, for a developer and for the
 * browser's own diagnostics.
 *
 * `negotiated` is `null` until a backend for this root has answered
 * `initialize` — which is the ordinary state when the page asks, because
 * `/lsp/match` runs *before* the websocket opens. That is reported rather than
 * papered over: the alternative is spawning a language server to answer a
 * question about language servers.
 *
 * The browser's semantic-token controller does not read this. It reads the same
 * capabilities off its own `LspClient`, which the proxy fed from the same cached
 * `initialize` result — same bytes, no round trip, and no race against the
 * connection it would be describing.
 */
export async function lspRouteSemanticTokens(
  paths: WorkspacePaths,
  query: v.InferOutput<typeof lspMatchQuerySchema>,
  settings: LspSettings,
  pool: LspNegotiationSource,
) {
  const match = query.server
    ? await resolveExplicitLspRouteMatch(
        resolveRouteTarget(paths, routeMatchInput(query)),
        query.server,
        settings,
      )
    : bestLspMatchForFeature(
        await resolveLspRouteMatches(paths, routeMatchInput(query), settings),
        'semanticTokens',
      )
  if (!match) return null

  return {
    negotiated: pool.negotiatedSemanticTokens(match),
    root: match.root,
    serverId: match.server.id,
  }
}

/** The one method `lspRouteSemanticTokens` needs; `LspSessionPool` satisfies it. */
export type LspNegotiationSource = {
  negotiatedSemanticTokens(match: LspServerMatch): LspNegotiatedSemanticTokens | null
}

export type LspRouteDeps = {
  readonly resolveServer?: typeof resolveLspServer
  /**
   * Required: the app owns the pool so `appCleanup` can tear it down. There is
   * deliberately no module-global fallback — that was the bug.
   */
  readonly pool: LspSessionSource
  /**
   * A getter, not a value: `/lsp/match` and the websocket outlive any one
   * settings snapshot, and a knob that only applied at boot would be a knob the
   * user has to restart the server to use.
   */
  readonly settings: () => LspSettings
}

export function lspRoutes(fs: LspRouteFileSystem, auth: AuthConfig, deps: LspRouteDeps) {
  const sessions = new WeakMap<object, PendingLspSession>()
  const resolveServer = deps.resolveServer ?? resolveLspServer

  return {
    async open(ws: unknown) {
      const socket = websocketObject(ws)
      if (!socket) return

      const pending = createPendingLspSession()
      sessions.set(socket.key, pending)

      const authError = authenticateWebSocketData(socket.data, auth)
      if (authError) {
        rejectPendingLspSession(sessions, socket, pending)
        recordProcessWarning('lsp.session.rejected', {
          area: 'lsp',
          errorCode: authError.code,
          operation: 'open',
          outcome: 'auth_failed',
          status: authError.statusCode,
        })
        socket.close(1008, 'unauthorized')
        return
      }

      const target = resolveRouteTarget(fs.paths, socket)
      if (!target) {
        rejectPendingLspSession(sessions, socket, pending)
        recordProcessWarning('lsp.session.rejected', {
          area: 'lsp',
          operation: 'open',
          outcome: 'invalid_root',
          path: socket.path,
          rootPath: socket.root,
        })
        socket.close(1008, 'invalid-root')
        return
      }

      const match = await resolveExplicitLspRouteMatch(
        target,
        socket.serverId,
        deps.settings(),
        resolveServer,
      )
      if (!match) {
        rejectPendingLspSession(sessions, socket, pending)
        recordProcessWarning('lsp.session.rejected', {
          area: 'lsp',
          operation: 'open',
          outcome: 'no_server_match',
          path: socket.path,
          serverId: socket.serverId,
        })
        closeWithReason(socket, 'no_server_match', socket.serverId ?? 'unknown')
        return
      }

      const session = await deps.pool.acquire(
        countedSocket(socket, pending),
        match,
        fs.paths.toRelative(match.root),
      )
      if (!session) {
        rejectPendingLspSession(sessions, socket, pending)
        recordProcessWarning('lsp.session.rejected', {
          area: 'lsp',
          operation: 'open',
          outcome: 'spawn_failed',
          rootPath: fs.paths.toRelative(match.root),
          serverId: match.server.id,
        })
        closeWithReason(socket, 'spawn_failed', match.server.id)
        return
      }

      attachPendingLspSession(pending, session)
    },
    message(ws: unknown, message: unknown) {
      const socket = websocketObject(ws)
      if (!socket) return

      const session = sessions.get(socket.key)
      if (!session) return
      const encoded = lspMessage(message)
      if (!encoded) return

      queueLspClientMessage(session, encoded)
    },
    close(ws: unknown, code?: number, reason?: string) {
      const socket = websocketObject(ws)
      if (!socket) return

      const pending = sessions.get(socket.key)
      sessions.delete(socket.key)
      // A refused socket was already reported by the refusal and is no longer in the map.
      if (!pending) return

      pending.dispose()
      const record = isAbnormalWebSocketClose(code) ? recordProcessWarning : recordProcessInfo
      record('lsp.socket.close', {
        area: 'lsp',
        receivedCount: pending.receivedCount,
        code: code ?? null,
        durationMs: Math.round(performance.now() - pending.openedAt),
        reason: reason || null,
        rootPath: socket.root,
        sentCount: pending.sentCount,
        serverId: socket.serverId,
      })
    },
  }
}

// Backend failures use an LSP notification; policy refusals use close code 1008.
function closeWithReason(socket: LspWebSocket, outcome: string, serverId: string) {
  socket.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method: LSP_SERVER_EXITED,
      params: { exitCode: null, exitSignal: null, outcome, serverId },
    }),
  )
  socket.close()
}

type LspClientMessage = string | ArrayBuffer | Uint8Array

type PendingLspSession = {
  readonly messages: LspClientMessage[]
  readonly openedAt: number
  receivedCount: number
  sentCount: number
  closed: boolean
  flushing: boolean
  session: LspProxyClientSession | null
  dispose(): void
}

/** Counts what the proxy sends, so the close event reports traffic in both directions. */
function countedSocket(socket: LspWebSocket, pending: PendingLspSession): LspWebSocket {
  return {
    ...socket,
    send: (message) => {
      pending.sentCount += 1
      return socket.send(message)
    },
  }
}

function createPendingLspSession(): PendingLspSession {
  const pending: PendingLspSession = {
    messages: [],
    openedAt: performance.now(),
    receivedCount: 0,
    sentCount: 0,
    closed: false,
    flushing: false,
    session: null,
    dispose: () => {
      pending.closed = true
      pending.messages.length = 0
      pending.session?.dispose()
      pending.session = null
    },
  }

  return pending
}

function rejectPendingLspSession(
  sessions: WeakMap<object, PendingLspSession>,
  socket: LspWebSocket,
  pending: PendingLspSession,
) {
  pending.dispose()
  sessions.delete(socket.key)
}

function attachPendingLspSession(pending: PendingLspSession, session: LspProxyClientSession) {
  if (pending.closed) {
    session.dispose()
    return
  }

  pending.session = session
  flushPendingLspSession(pending)
}

function queueLspClientMessage(pending: PendingLspSession, message: LspClientMessage) {
  if (pending.closed) return

  pending.receivedCount += 1
  pending.messages.push(message)
  flushPendingLspSession(pending)
}

function flushPendingLspSession(pending: PendingLspSession) {
  if (pending.flushing) return
  if (pending.closed) return
  if (!pending.session) return

  pending.flushing = true
  void flushPendingLspMessages(pending)
}

async function flushPendingLspMessages(pending: PendingLspSession) {
  while (!pending.closed && pending.session && pending.messages.length > 0) {
    const message = pending.messages.shift()
    if (message) await pending.session.handleClientMessage(message)
  }

  pending.flushing = false
  if (pending.messages.length > 0) flushPendingLspSession(pending)
}

async function resolveLspRouteMatches(
  paths: WorkspacePaths,
  input: LspRouteMatchInput,
  settings: LspSettings,
  match: typeof matchLspServers = matchLspServers,
): Promise<readonly LspServerMatch[]> {
  try {
    const target = resolveRouteTarget(paths, input)
    if (!target) return []

    return match({
      filePath: target.filePath,
      settings,
      workspaceRoot: target.workspaceRoot,
    })
  } catch {
    return []
  }
}

async function resolveExplicitLspRouteMatch(
  target: ReturnType<typeof resolveRouteTarget>,
  serverId: string | null,
  settings: LspSettings,
  resolve: typeof resolveLspServer = resolveLspServer,
): Promise<LspServerMatch | null> {
  if (!target || !serverId) return null

  try {
    return resolve({
      filePath: target.filePath,
      serverId,
      settings,
      workspaceRoot: target.workspaceRoot,
    })
  } catch {
    return null
  }
}

function resolveRouteTarget(paths: WorkspacePaths, input: LspRouteMatchInput) {
  if (!input.path) return null

  try {
    return {
      filePath: paths.resolve(input.path).absolutePath,
      workspaceRoot: paths.resolve(input.root).absolutePath,
    }
  } catch {
    return null
  }
}

type LspRouteMatchInput = {
  readonly path: string
  readonly root: string
  readonly serverId: string | null
}

function routeMatchInput(query: v.InferOutput<typeof lspMatchQuerySchema>): LspRouteMatchInput {
  return {
    path: query.path,
    root: query.root,
    serverId: query.server ?? null,
  }
}

type LspWebSocket = {
  close(code?: number, reason?: string): unknown
  data: unknown
  key: object
  path: string
  root: string
  send(message: string): unknown
  serverId: string | null
}

function websocketObject(value: unknown): LspWebSocket | null {
  const socket = adaptWebSocket(value)
  if (!socket) return null
  return {
    ...socket,
    path: webSocketQueryValue(socket.data, 'path') ?? '',
    root: webSocketQueryValue(socket.data, 'root') ?? '',
    serverId: webSocketQueryValue(socket.data, 'server'),
  }
}

function lspMessage(value: unknown): string | ArrayBuffer | Uint8Array | null {
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return value
  if (value instanceof Uint8Array) return value
  if (isRecord(value)) return JSON.stringify(value)

  return null
}
