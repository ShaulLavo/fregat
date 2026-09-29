import type * as lsp from 'vscode-languageserver-protocol'
import {
  clientSupportsDidSave,
  defaultClientCapabilities,
  documentSyncOptionsFromCapabilities,
  mergeClientCapabilities,
} from './capabilities'
import {
  createMethodNotFoundResponse,
  createNotificationMessage,
  createInternalErrorResponse,
  createRequestMessage,
  createResponseMessage,
  isNotificationMessage,
  isRequestMessage,
  isResponseMessage,
  LspRequestCancelledError,
  responseResult,
  type LspRequestId,
} from './protocol'
import { createLspContentChangesInSnapshot } from './positions'
import { measureLspPerformance } from './performanceDiagnostics'
import type {
  LspDocumentChange,
  LspDocumentSaveSync,
  LspDocument,
  LspDocumentSyncMode,
  LspNotificationHandler,
  LspRequestHandle,
  LspServerMessageHandler,
  LspServerRequestHandler,
  LspClientWorkspace,
  LspTransport,
  LspUnhandledNotificationHandler,
} from './types'
import { createDefaultLspWorkspace } from './workspaceFactory'

export type LspClientState = 'disconnected' | 'initializing' | 'ready' | 'failed'

export type LspClientConfig = {
  readonly rootUri?: lsp.DocumentUri | null
  readonly workspaceFolders?: readonly lsp.WorkspaceFolder[] | null
  readonly clientInfo?: lsp.InitializeParams['clientInfo']
  readonly initializationOptions?: unknown
  readonly capabilities?: lsp.ClientCapabilities
  readonly timeoutMs?: number
  readonly processId?: number | null
  readonly locale?: string
  readonly workspace?: LspClientWorkspace
  readonly notificationHandlers?: Readonly<Record<string, LspNotificationHandler<LspClient>>>
  readonly unhandledNotification?: LspUnhandledNotificationHandler<LspClient>
  readonly serverMessageHandler?: LspServerMessageHandler<LspClient>
  readonly serverRequestHandlers?: Readonly<Record<string, LspServerRequestHandler<LspClient>>>
}

type PendingRequest = {
  readonly id: LspRequestId
  readonly method: string
  readonly timeout: ReturnType<typeof setTimeout>
  readonly resolve: (result: unknown) => void
  readonly reject: (error: unknown) => void
  readonly abortCleanup?: () => void
}

/**
 * Per-request overrides. Both matter to a caller the default was not written for: `timeoutMs`
 * because a cold server on a large project will blow past the 3s default on its first answer, and
 * `signal` because aborting sends `$/cancelRequest` on the wire — a server that honours it abandons
 * real work, which is not the same thing as suppressing a response that was already computed.
 */
export type RequestOptions = {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export class LspClient {
  public readonly workspace: LspClientWorkspace
  public serverCapabilities: lsp.ServerCapabilities | null = null
  public initializeResult: lsp.InitializeResult | null = null

  private readonly config: LspClientConfig
  private readonly timeoutMs: number
  private readonly clientCapabilities: lsp.ClientCapabilities
  private transport: LspTransport | null = null
  private state: LspClientState = 'disconnected'
  private nextRequestId = 1
  private initializePromise: Promise<void> | null = null
  private syncMode: LspDocumentSyncMode = 'none'
  private syncOpenClose = false
  private syncSave: LspDocumentSaveSync = { enabled: false, includeText: false }
  private readonly pendingRequests = new Map<LspRequestId, PendingRequest>()
  private readonly syncedDocuments = new Set<lsp.DocumentUri>()

  public constructor(config: LspClientConfig = {}) {
    this.config = config
    this.timeoutMs = config.timeoutMs ?? 3000
    this.clientCapabilities = mergeClientCapabilities(
      defaultClientCapabilities(),
      this.config.capabilities,
    )
    this.workspace = config.workspace ?? createDefaultLspWorkspace()
    this.workspace.attachClient(this)
    this.receiveMessage = this.receiveMessage.bind(this)
  }

  public get connected(): boolean {
    return this.transport !== null
  }

  public get initialized(): boolean {
    return this.state === 'ready'
  }

  public get initialization(): Promise<void> | null {
    return this.initializePromise
  }

  public connect(transport: LspTransport): Promise<void> {
    this.disconnect()
    this.transport = transport
    this.state = 'initializing'
    transport.subscribe(this.receiveMessage)
    this.initializePromise = this.initialize()
    return this.initializePromise
  }

  public disconnect(): void {
    const transport = this.transport
    if (transport) transport.unsubscribe(this.receiveMessage)

    this.transport = null
    this.state = 'disconnected'
    this.initializePromise = null
    this.initializeResult = null
    this.serverCapabilities = null
    this.syncMode = 'none'
    this.syncOpenClose = false
    this.syncSave = { enabled: false, includeText: false }
    this.syncedDocuments.clear()
    this.rejectPendingRequests(new Error('LSP client disconnected'))
    this.workspace.disconnected()
  }

  public async shutdown(): Promise<void> {
    if (!this.transport) return

    await this.request('shutdown')
    this.sendNotification('exit')
    this.disconnect()
  }

  public request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
    options: RequestOptions = {},
  ): Promise<TResult> {
    return this.requestHandle<TResult, TParams>(method, params, options).response
  }

  public requestHandle<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
    options: RequestOptions = {},
  ): LspRequestHandle<TResult> {
    const id = this.allocateRequestId()
    let cancelled = false
    const response = this.sendHandledRequest<TResult>(id, method, params, options, () => cancelled)

    return {
      id,
      response,
      cancel: () => {
        cancelled = true
        this.abortRequest(id)
      },
    }
  }

  public notify<TParams = unknown>(method: string, params?: TParams): Promise<void> {
    if (!this.transport) return Promise.reject(new Error('LSP client is not connected'))
    if (this.state === 'ready') return this.notifyReady(method, params)

    return this.awaitInitialization().then(() => this.notifyReady(method, params))
  }

  public notification<TParams = unknown>(method: string, params?: TParams): Promise<void> {
    return this.notify(method, params)
  }

  public hasCapability(name: keyof lsp.ServerCapabilities): boolean | null {
    if (!this.serverCapabilities) return null
    return Boolean(this.serverCapabilities[name])
  }

  public didOpenDocument(document: LspDocument): void {
    if (this.state !== 'ready') return
    if (this.syncedDocuments.has(document.uri)) return
    if (!this.shouldTrackDocumentSync()) return

    this.syncedDocuments.add(document.uri)
    if (!this.syncOpenClose) return

    this.trySendNotification('textDocument/didOpen', {
      textDocument: {
        uri: document.uri,
        languageId: document.languageId,
        version: document.version,
        text: documentPayloadText(document),
      },
    })
  }

  public didChangeDocument(document: LspDocument, change: LspDocumentChange): void {
    if (this.state !== 'ready') return
    if (this.syncMode === 'none') return
    if (!this.syncedDocuments.has(document.uri)) return

    this.trySendNotification('textDocument/didChange', {
      textDocument: { uri: document.uri, version: document.version },
      contentChanges: this.contentChangesForDocumentChange(document, change),
    })
  }

  public didSaveDocument(document: LspDocument): void {
    if (this.state !== 'ready') return
    if (!this.syncSave.enabled) return
    if (!this.syncedDocuments.has(document.uri)) return

    this.trySendNotification('textDocument/didSave', {
      textDocument: { uri: document.uri },
      ...(this.syncSave.includeText ? { text: documentPayloadText(document) } : {}),
    })
  }

  public didCloseDocument(document: LspDocument): void {
    if (this.state !== 'ready') return
    if (!this.syncedDocuments.delete(document.uri)) return
    if (!this.syncOpenClose) return

    this.trySendNotification('textDocument/didClose', {
      textDocument: { uri: document.uri },
    })
  }

  private async initialize(): Promise<void> {
    try {
      const result = await this.requestInner<lsp.InitializeResult>(
        'initialize',
        this.initializeParams(),
      )
      this.applyInitializeResult(result)
      this.sendNotification('initialized', {})
      this.workspace.connected()
    } catch (error) {
      this.state = 'failed'
      throw error
    }
  }

  private initializeParams(): lsp.InitializeParams {
    return {
      processId: this.config.processId ?? null,
      clientInfo: this.config.clientInfo ?? { name: '@singapore-editor/lsp' },
      locale: this.config.locale,
      rootUri: this.config.rootUri ?? null,
      capabilities: this.clientCapabilities,
      initializationOptions: this.config.initializationOptions,
      workspaceFolders: this.config.workspaceFolders ? [...this.config.workspaceFolders] : null,
    }
  }

  private applyInitializeResult(result: lsp.InitializeResult): void {
    this.initializeResult = result
    this.serverCapabilities = result.capabilities
    const sync = documentSyncOptionsFromCapabilities(result.capabilities)
    this.syncMode = sync.change
    this.syncOpenClose = sync.openClose
    this.syncSave = clientSupportsDidSave(this.clientCapabilities)
      ? sync.save
      : { enabled: false, includeText: false }
    this.state = 'ready'
  }

  private shouldTrackDocumentSync(): boolean {
    return this.syncOpenClose || this.syncMode !== 'none' || this.syncSave.enabled
  }

  private contentChangesForDocumentChange(
    document: LspDocument,
    change: LspDocumentChange,
  ): readonly lsp.TextDocumentContentChangeEvent[] {
    return measureLspPerformance(
      'lsp.createContentChanges',
      () => this.createContentChanges(document, change),
      () => ({
        syncMode: this.syncMode,
        editCount: change.edits.length,
        length: document.textSnapshot.length,
      }),
    )
  }

  private createContentChanges(
    document: LspDocument,
    change: LspDocumentChange,
  ): readonly lsp.TextDocumentContentChangeEvent[] {
    return createLspContentChangesInSnapshot(change.previousSnapshot, document, {
      incremental: this.syncMode === 'incremental',
      edits: change.edits,
    })
  }

  private requestInner<TResult>(
    method: string,
    params: unknown,
    options: RequestOptions = {},
  ): Promise<TResult> {
    return this.requestInnerWithId(this.allocateRequestId(), method, params, options)
  }

  private sendHandledRequest<TResult>(
    id: LspRequestId,
    method: string,
    params: unknown,
    options: RequestOptions,
    isCancelled: () => boolean,
  ): Promise<TResult> {
    if (!this.transport) return Promise.reject(new Error('LSP client is not connected'))
    if (this.state === 'ready')
      return this.sendReadyHandledRequest(id, method, params, options, isCancelled)
    return this.awaitInitialization().then(() =>
      this.sendReadyHandledRequest(id, method, params, options, isCancelled),
    )
  }

  private sendReadyHandledRequest<TResult>(
    id: LspRequestId,
    method: string,
    params: unknown,
    options: RequestOptions,
    isCancelled: () => boolean,
  ): Promise<TResult> {
    if (isCancelled()) return Promise.reject(new LspRequestCancelledError())
    return this.requestInnerWithId<TResult>(id, method, params, options)
  }

  private requestInnerWithId<TResult>(
    id: LspRequestId,
    method: string,
    params: unknown,
    options: RequestOptions,
  ): Promise<TResult> {
    const transport = this.requireTransport()
    const message = createRequestMessage(id, method, params)

    return new Promise<TResult>((resolve, reject) => {
      const pending = this.createPendingRequest(
        id,
        method,
        (result) => resolve(result as TResult),
        reject,
        options,
      )
      this.pendingRequests.set(id, pending)
      this.sendMessage(transport, message, pending)
    })
  }

  private allocateRequestId(): LspRequestId {
    const id = this.nextRequestId
    this.nextRequestId += 1
    return id
  }

  private createPendingRequest(
    id: LspRequestId,
    method: string,
    resolve: (result: unknown) => void,
    reject: (error: unknown) => void,
    options: RequestOptions,
  ): PendingRequest {
    const timeout = setTimeout(() => this.timeoutRequest(id), options.timeoutMs ?? this.timeoutMs)
    const pending: PendingRequest = { id, method, timeout, resolve, reject }
    if (!options.signal) return pending

    const abort = () => this.abortRequest(id)
    options.signal.addEventListener('abort', abort, { once: true })
    return { ...pending, abortCleanup: () => options.signal?.removeEventListener('abort', abort) }
  }

  private sendMessage(
    transport: LspTransport,
    message: lsp.RequestMessage,
    pending: PendingRequest,
  ): void {
    try {
      transport.send(JSON.stringify(message))
    } catch (error) {
      this.deletePendingRequest(pending.id)
      this.handleTransportSendError(error)
      pending.reject(error)
    }
  }

  private sendNotification(method: string, params?: unknown): void {
    const transport = this.requireTransport()
    try {
      transport.send(JSON.stringify(createNotificationMessage(method, params)))
    } catch (error) {
      this.handleTransportSendError(error)
      throw error
    }
  }

  private notifyReady(method: string, params?: unknown): Promise<void> {
    try {
      this.sendNotification(method, params)
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private trySendNotification(method: string, params?: unknown): boolean {
    try {
      this.sendNotification(method, params)
      return true
    } catch {
      return false
    }
  }

  private receiveMessage(message: string): void {
    const parsed = JSON.parse(message) as unknown
    if (isResponseMessage(parsed)) {
      this.handleResponse(parsed)
      return
    }
    if (isNotificationMessage(parsed)) {
      this.handleNotification(parsed)
      return
    }
    if (isRequestMessage(parsed)) {
      this.handleRequest(parsed)
    }
  }

  private handleResponse(message: lsp.ResponseMessage): void {
    if (message.id === null) return

    const pending = this.pendingRequests.get(message.id)
    if (!pending) return

    this.deletePendingRequest(message.id)
    try {
      pending.resolve(responseResult(message))
    } catch (error) {
      pending.reject(error)
    }
  }

  private handleNotification(message: lsp.NotificationMessage): void {
    const handler = this.config.notificationHandlers?.[message.method]
    if (handler?.(this, message.params, message)) return
    if (this.handleDefaultNotification(message)) return
    this.config.unhandledNotification?.(this, message.method, message.params, message)
  }

  private handleDefaultNotification(message: lsp.NotificationMessage): boolean {
    if (message.method === 'window/logMessage') return this.handleServerMessage(message)
    if (message.method === 'window/showMessage') return this.handleServerMessage(message)
    return false
  }

  private handleServerMessage(message: lsp.NotificationMessage): boolean {
    this.config.serverMessageHandler?.(this, {
      method: message.method as 'window/logMessage' | 'window/showMessage',
      type: messageType(message.params),
      message: messageText(message.params),
      params: message.params,
    })
    return true
  }

  private handleRequest(message: lsp.RequestMessage): void {
    const handler = this.config.serverRequestHandlers?.[message.method]
    if (!handler) {
      this.sendServerResponse(createMethodNotFoundResponse(message.id, message.method))
      return
    }

    let result: unknown
    try {
      result = handler(this, message.params, message)
    } catch (error) {
      this.sendServerResponse(createInternalErrorResponse(message.id, error))
      return
    }

    void Promise.resolve(result).then(
      (result) => this.sendServerResponse(createResponseMessage(message.id, result)),
      (error) => this.sendServerResponse(createInternalErrorResponse(message.id, error)),
    )
  }

  private sendServerResponse(message: lsp.ResponseMessage): void {
    const transport = this.transport
    if (!transport) return

    try {
      transport.send(JSON.stringify(message))
    } catch (error) {
      this.handleTransportSendError(error)
    }
  }

  private timeoutRequest(id: LspRequestId): void {
    const pending = this.pendingRequests.get(id)
    if (!pending) return

    this.deletePendingRequest(id)
    pending.reject(new Error(`LSP request timed out: ${pending.method}`))
  }

  private abortRequest(id: LspRequestId): void {
    const pending = this.pendingRequests.get(id)
    if (!pending) return

    this.trySendNotification('$/cancelRequest', { id })
    this.deletePendingRequest(id)
    pending.reject(new LspRequestCancelledError())
  }

  private deletePendingRequest(id: LspRequestId): void {
    const pending = this.pendingRequests.get(id)
    if (!pending) return

    clearTimeout(pending.timeout)
    pending.abortCleanup?.()
    this.pendingRequests.delete(id)
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.abortCleanup?.()
      pending.reject(error)
    }

    this.pendingRequests.clear()
  }

  private handleTransportSendError(_error: unknown): void {
    if (!this.transport) return

    this.disconnect()
  }

  private awaitInitialization(): Promise<void> {
    if (this.initializePromise) return this.initializePromise
    return Promise.reject(new Error('LSP client is not initialized'))
  }

  private requireTransport(): LspTransport {
    if (this.transport) return this.transport
    throw new Error('LSP client is not connected')
  }
}

// didOpen and didSave with text carry the whole document by protocol definition.
function documentPayloadText(document: LspDocument): string {
  return document.textSnapshot.readRange(0, document.textSnapshot.length)
}

const messageText = (params: unknown): string | null => {
  if (!isRecord(params)) return null
  return typeof params.message === 'string' ? params.message : null
}

const messageType = (params: unknown): number => {
  if (!isRecord(params)) return 3
  return typeof params.type === 'number' ? params.type : 3
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
