import {
  createDocumentLogicalRevisionScope,
  type DocumentLogicalRevisionScope,
} from '@singapore-editor/core/document'
import {
  composeWorkspaceEditClientCapabilities,
  type LspClient,
  type LspWorkspace,
} from '@singapore-editor/lsp'

import {
  createWebSocketLspTransportFactory,
  LspConnection,
  type LspConnectionCallbacks,
  type LspConnectionLease,
  type LspConnectionOptions,
  type LspConnectionTransportFactory,
} from './lspConnection'
import type {
  LanguageServerConnectionContext,
  LanguageServerLaneOptions,
  LanguageServerStatus,
} from './types'

const DEFAULT_TIMEOUT_MS = 15_000
const logicalRevisionScopes = new WeakMap<LspWorkspace, DocumentLogicalRevisionScope>()

export type AcquiredLanguageServerLane = {
  readonly id: string
  readonly client: LspClient
  readonly logicalRevisionScope: DocumentLogicalRevisionScope
  readonly workspace: LspWorkspace
  readonly ready: Promise<LanguageServerConnectionContext>
  isReady(): boolean
  release(): void
}

export type LanguageServerLaneCallbacks = {
  onDiagnosticRefresh?(): void
  onReconnecting?(): void
  onPublishDiagnostics?(params: unknown): void
  onReady?(): void
  onUnavailable?(): void
}

export type LanguageServerResolvedLaneOptions = Omit<
  LanguageServerLaneOptions,
  'webSocketRoute' | 'webSocketTransportOptions'
> & {
  createTransport: LspConnectionTransportFactory
}

type ReadyPromise = {
  readonly promise: Promise<LanguageServerConnectionContext>
  resolve(context: LanguageServerConnectionContext): void
  reject(error: unknown): void
}

export function acquireLanguageServerLane(
  options: LanguageServerLaneOptions,
  callbacks: LanguageServerLaneCallbacks = {},
): AcquiredLanguageServerLane {
  return acquireResolvedLanguageServerLane(resolveLanguageServerLaneOptions(options), callbacks)
}

export function acquireResolvedLanguageServerLane(
  options: LanguageServerResolvedLaneOptions,
  callbacks: LanguageServerLaneCallbacks = {},
): AcquiredLanguageServerLane {
  const connectionOptions = resolveConnectionOptions(options)
  const ready = readyPromise()
  let connectionLease: LspConnectionLease | null = null
  let connection: LspConnection
  let registration: { dispose(): void } | null = null
  let released = false
  let usable = false

  const connectionCallbacks: LspConnectionCallbacks = {
    onConnected: () => {
      void finishConnection()
    },
    onDiagnosticRefresh: () => callbacks.onDiagnosticRefresh?.(),
    onReconnecting: () => {
      usable = false
      callbacks.onReconnecting?.()
    },
    onUnavailable: () => {
      usable = false
      callbacks.onUnavailable?.()
    },
    onPublishDiagnostics: (params) => callbacks.onPublishDiagnostics?.(params),
    onStatusChange: (status) => reportTransportStatus(options, status, released),
    onError: (error) => {
      options.onError?.(error)
      ready.reject(error)
    },
  }

  connectionLease =
    options.connectionProvider?.acquire(connectionOptions, connectionCallbacks) ?? null
  connection =
    connectionLease?.connection ?? new LspConnection(connectionOptions, connectionCallbacks)
  const context = connectionContext(connection)
  const logicalRevisionScope = logicalRevisionScopeFor(connection.workspace)
  registration = options.onConnectionCreated?.(context) ?? null
  if (!connectionLease) connection.connect()

  return {
    id: options.id,
    client: connection.client,
    logicalRevisionScope,
    workspace: connection.workspace,
    ready: ready.promise,
    isReady: () => usable && !released,
    release: () => {
      if (released) return

      released = true
      usable = false
      ready.reject(new Error(`Language-server lane "${options.id}" was released before readiness.`))
      registration?.dispose()
      registration = null
      if (connectionLease) connectionLease.release()
      else connection.dispose()
    },
  }

  async function finishConnection(): Promise<void> {
    if (released) return

    try {
      for (const notification of options.readyNotifications ?? []) {
        await connection.client.notify(notification.method, notification.params)
        if (released) return
      }

      usable = true
      options.onStatusChange?.('ready')
      callbacks.onReady?.()
      options.onConnected?.(context)
      ready.resolve(context)
    } catch (error) {
      if (released) return

      usable = false
      options.onStatusChange?.('error')
      options.onError?.(error)
      ready.reject(error)
    }
  }
}

export function resolveLanguageServerLaneOptions(
  options: LanguageServerLaneOptions,
): LanguageServerResolvedLaneOptions {
  return {
    ...options,
    rootUri: options.rootUri ?? 'file:///',
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    capabilities: composeWorkspaceEditClientCapabilities(
      options.capabilities,
      options.onApplyWorkspaceEdit !== undefined,
    ),
    createTransport: createWebSocketLspTransportFactory(
      options.webSocketRoute,
      options.webSocketTransportOptions,
    ),
  }
}

function resolveConnectionOptions(
  options: LanguageServerResolvedLaneOptions,
): LspConnectionOptions {
  return {
    rootUri: options.rootUri ?? 'file:///',
    initializationOptions: options.initializationOptions,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    capabilities: composeWorkspaceEditClientCapabilities(
      options.capabilities,
      options.onApplyWorkspaceEdit !== undefined,
    ),
    clientInfo: options.clientInfo,
    notificationHandlers: options.notificationHandlers,
    serverRequestHandlers: options.serverRequestHandlers,
    reconnect: options.reconnect,
    createTransport: options.createTransport,
  }
}

export function logicalRevisionScopeFor(workspace: LspWorkspace): DocumentLogicalRevisionScope {
  const current = logicalRevisionScopes.get(workspace)
  if (current) return current

  const created = createDocumentLogicalRevisionScope()
  logicalRevisionScopes.set(workspace, created)
  return created
}

function reportTransportStatus(
  options: LanguageServerResolvedLaneOptions,
  status: LanguageServerStatus,
  released: boolean,
): void {
  if (released) return
  if (status === 'ready') return

  options.onStatusChange?.(status)
}

function connectionContext(connection: LspConnection): LanguageServerConnectionContext {
  return {
    client: connection.client,
    workspace: connection.workspace,
  }
}

function readyPromise(): ReadyPromise {
  let resolve!: ReadyPromise['resolve']
  let reject!: ReadyPromise['reject']
  const promise = new Promise<LanguageServerConnectionContext>((resolveReady, rejectReady) => {
    resolve = resolveReady
    reject = rejectReady
  })

  return { promise, resolve, reject }
}
