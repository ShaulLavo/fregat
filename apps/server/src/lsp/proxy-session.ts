import { withinDiagnosticsBudget } from './diagnostics-budget'

import { errorMessage } from '@workspace/contracts'
import { fileUriForNativePath } from './language'
import { elapsedMs } from '@workspace/utils/timing'
import { createInternalError, lspErrors } from '../observability/structured-errors'

import {
  DEFAULT_SETTING_VALUES,
  LSP_DIAGNOSTIC_REFRESH,
  LSP_SEMANTIC_TOKENS_REFRESH,
  LSP_SERVER_EXITED,
  type LspNegotiatedSemanticTokens,
  type LspServerExitedParams,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { LspServerHandle, LspServerMatch } from './registry'
import { LspStdioMessageReader, writeLspStdioMessage } from './stdio-rpc'
import {
  lspDiagnosticsFromTsserver,
  offersTsserverRequests,
  tsserverDiagnosticRequests,
} from './typescript/tsserver-diagnostics'
import {
  DID_CHANGE_WATCHED_FILES,
  FILE_CHANGED,
  LspWatchedFiles,
  type FileEvent,
} from './watched-files'
import type { TreeWatchSource } from '../fs/tree-watch'
import {
  operatorErrorSummary,
  limitText,
  recordProcessInfo,
  recordProcessWarning,
} from '../observability'

import {
  CONTENT_MODIFIED_CODE,
  applyContentChangesStrict,
  byteLength,
  cancellationRequestId,
  capabilityChanges,
  configurationSection,
  didChangeDocument,
  didOpenDocument,
  initializeContractOf,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  jsonRpcError,
  jsonRpcResult,
  normalizeClientMessage,
  parseJsonMessage,
  protocolValueDifference,
  publishedDiagnostics,
  responseForClient,
  rewriteTextDocumentVersion,
  safeSum,
  serverNotificationForClient,
  supportsPullDiagnostics,
  textDocumentUri,
  withWatchedFilesCapability,
  type DidOpenDocument,
  type InitializeContract,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './proxy-protocol'
import {
  SEMANTIC_TOKENS_DELTA,
  SEMANTIC_TOKENS_FULL,
  applySemanticTokenEdits,
  isRejectedBaselineError,
  negotiatedSemanticTokens,
} from './proxy-semantic-tokens'
import {
  translateWorkspaceEditResponse,
  workspaceEditResponseMethod,
  type CapturedDocumentProvenance,
  type WorkspaceEditProvenance,
} from './proxy-workspace-edits'

import { LspProxyConnection } from './proxy-connection'

type PendingBackendRequest = {
  readonly clientId: JsonRpcId
  readonly connection: LspProxyConnection | null
  readonly method: string
  /** Set only for a token request, so its response can be reassembled and fanned out. */
  readonly semanticTokens?: SemanticTokenRequest
  workspaceEditCancelled?: boolean
  workspaceEditProvenance?: WorkspaceEditProvenance
  reject?: (error: unknown) => void
  resolve?: (response: JsonRpcResponse) => void
}

/** One backend token request, and every client waiting on its answer. */
type SemanticTokenRequest = {
  readonly uri: string
  /** True when the outbound method was rewritten to `full/delta`. */
  readonly delta: boolean
  /**
   * The baseline this request was actually diffed against, or null for a whole
   * file. Recorded rather than re-read at response time: the map can have moved
   * on, and splicing a delta into a baseline the server never saw produces an
   * array that matches no version of the text.
   */
  readonly previousResultId: string | null
  /**
   * The document version the request went out against, so a later request that
   * straddles a `didChange` starts its own rather than coalescing onto an answer
   * that describes text the user has already replaced.
   */
  readonly backendVersion: number
  /** Whether this is the one retry a rejected `previousResultId` is allowed. */
  readonly retried: boolean
  readonly waiters: { readonly connection: LspProxyConnection; readonly clientId: JsonRpcId }[]
}

/**
 * A delta baseline, and nothing else.
 *
 * Never served to a client as a response — it exists only so the *next* request
 * for this uri can be sent as a delta. It lives here rather than in a browser
 * because a `resultId` is per backend document, not per tab, and this backend is
 * shared by every tab in a root: two browsers each holding their own baseline
 * would take turns invalidating each other's, and a server that does not
 * validate would diff against the wrong one and answer spans matching no version
 * of the text.
 */
type SemanticTokenBaseline = {
  resultId: string
  data: number[]
}

export type SharedDocument = {
  backendVersion: number
  diagnostics: string | null
  languageId: string
  readonly owners: Map<LspProxyConnection, OwnerDocumentState>
  syncEpoch: number
  text: string
}

export type OwnerDocumentState = {
  clientVersion: number
  text: string
  contentEpoch: number
  lastSyncEpoch: number
  synchronizedBackendVersion: number
}

/** A file's diagnostics as the backend has them: pulled on request, or its last publish. */
export type LspFileDiagnostics = {
  readonly mode: 'pull' | 'push'
  readonly diagnostics: readonly unknown[]
}

export type LspProxySocket = {
  close(): unknown
  send(message: string): unknown
}

export type LspProxyClientSession = {
  handleClientMessage(message: string | ArrayBuffer | Uint8Array): Promise<void>
  dispose(): void
}

/**
 * The seam `lspRoutes` depends on. `LspSessionPool` satisfies it structurally,
 * so a route test can hand in a stub without spawning a fake child process.
 */
export type LspSessionSource = {
  acquire(
    socket: LspProxySocket,
    match: LspServerMatch,
    rootPath: string,
  ): Promise<LspProxyClientSession | null>
}

/**
 * Owns every pooled language-server child process belonging to one app.
 *
 * This was two module-level Maps. `createApp` had no handle on them, so
 * `closeApp()` left jdtls/gopls/rust-analyzer running on the developer's
 * machine, and the pool key — server id plus root, no app identity — handed two
 * apps in one process each other's backends. The pool is now constructed in
 * `createApp` and torn down by `appCleanup`.
 */
export class LspSessionPool implements LspSessionSource {
  /**
   * Backends per match. Usually one; a client whose initialize params differ from the running
   * backend's (a tab left open across a deploy) gets a sibling instead of being refused.
   */
  private readonly sessions = new Map<string, PooledLspProxySession[]>()
  private readonly starting = new Map<string, Promise<PooledLspProxySession | null>>()
  private disposed = false
  /**
   * A getter, not a number: a pooled session outlives many settings writes, and
   * reading it when the idle timer is armed is what makes `lsp.idleTimeoutMs`
   * take effect without restarting the server.
   */
  private readonly idleTimeoutMs: () => number

  /**
   * A getter for the same reason `idleTimeoutMs` is one: a pooled session
   * outlives many settings writes, and reading it per request is what lets the
   * delta branch be turned off without restarting anything.
   */
  private readonly deltaEnabled: () => boolean

  /** Backs `workspace/didChangeWatchedFiles`; without one the capability is not advertised. */
  private readonly watchSource: TreeWatchSource | null

  constructor(
    idleTimeoutMs: () => number = () => DEFAULT_SETTING_VALUES['lsp.idleTimeoutMs'],
    deltaEnabled: () => boolean = () => DEFAULT_SETTING_VALUES['lsp.semanticTokens.delta'],
    watchSource: TreeWatchSource | null = null,
  ) {
    this.idleTimeoutMs = idleTimeoutMs
    this.deltaEnabled = deltaEnabled
    this.watchSource = watchSource
  }

  /** Live pooled backends. Read by teardown assertions. */
  get size(): number {
    let size = 0
    for (const group of this.sessions.values()) size += group.length
    return size
  }

  async acquire(
    socket: LspProxySocket,
    match: LspServerMatch,
    rootPath: string,
  ): Promise<LspProxyClientSession | null> {
    if (this.disposed) return null

    const session = await this.pooledSession(match, rootPath)
    if (!session) return null
    // `pooledSession` is async, so shutdown can land in the await gap.
    if (this.disposed || session.isDisposed) return null

    return session.connect(socket)
  }

  /**
   * The backend whose initialize contract is `contract`, spawning one when none has it.
   * Called by a backend that refused a client's contract, before that client sees a reply.
   */
  async sessionForContract(
    match: LspServerMatch,
    rootPath: string,
    contract: InitializeContract,
  ): Promise<PooledLspProxySession | null> {
    if (this.disposed) return null

    const key = lspProxySessionKey(match)
    const existing = this.liveSessions(key).find((session) => session.hasContract(contract))
    if (existing) return existing

    const startingKey = `${key}\u0000${contract.fingerprint}`
    const starting = this.starting.get(startingKey)
    if (starting) return starting

    const created = this.startSession(startingKey, key, match, rootPath, contract)
    this.starting.set(startingKey, created)
    return created
  }

  /**
   * Kills every backend and closes every client socket.
   *
   * Idempotent on purpose: Elysia's `.onStop` and an explicit `closeApp()` can
   * both fire for the same app, and a second kill would log a second session
   * event for a process that is already gone.
   */
  disposeAll(): void {
    if (this.disposed) return

    this.disposed = true
    // Copied first: `dispose` calls back into `remove` and mutates the map.
    const sessions = Array.from(this.sessions.values()).flat()
    for (const session of sessions) session.dispose('app_shutdown')
    this.sessions.clear()
  }

  remove(session: PooledLspProxySession): void {
    const group = this.sessions.get(session.key)
    if (!group?.includes(session)) return

    const rest = group.filter((candidate) => candidate !== session)
    if (rest.length > 0) this.sessions.set(session.key, rest)
    else this.sessions.delete(session.key)
  }

  /**
   * What the backend for this match agreed to, or `null` when none exists yet.
   *
   * Deliberately does not spawn one. `/lsp/match` runs before the socket opens,
   * so a caller asking early gets `null` and asks again — which is honest, where
   * spawning a language server to answer a diagnostic question would not be.
   */
  negotiatedSemanticTokens(match: LspServerMatch): LspNegotiatedSemanticTokens | null {
    for (const session of this.liveSessions(lspProxySessionKey(match))) {
      const negotiated = session.negotiatedSemanticTokens
      if (negotiated) return negotiated
    }
    return null
  }

  /**
   * A file's diagnostics from a backend that is already running for `match`, within `timeoutMs`.
   * Spawns nothing: an agent's edit is checked only where a language server already serves it.
   */
  async fileDiagnostics(
    match: LspServerMatch,
    uri: string,
    timeoutMs: number,
    text: string,
  ): Promise<LspFileDiagnostics | null> {
    return withinDiagnosticsBudget(timeoutMs, async (remaining) => {
      for (const session of this.liveSessions(lspProxySessionKey(match))) {
        if (remaining() <= 0) return null
        const result = await session.fileDiagnostics(uri, remaining(), text)
        if (result) return result
      }
      return null
    })
  }

  private liveSessions(key: string): readonly PooledLspProxySession[] {
    return (this.sessions.get(key) ?? []).filter((session) => !session.isDisposed)
  }

  private async pooledSession(match: LspServerMatch, rootPath: string) {
    const key = lspProxySessionKey(match)
    const existing = this.liveSessions(key)[0]
    if (existing) return existing

    const starting = this.starting.get(key)
    if (starting) return starting

    const created = this.startSession(key, key, match, rootPath)
    this.starting.set(key, created)
    return created
  }

  private startSession(
    startingKey: string,
    key: string,
    match: LspServerMatch,
    rootPath: string,
    contract?: InitializeContract,
  ) {
    return PooledLspProxySession.spawn(
      key,
      match,
      rootPath,
      this,
      this.idleTimeoutMs,
      this.deltaEnabled,
      this.watchSource,
    )
      .then((session) => {
        if (contract) session?.claimContract(contract)
        return this.adoptSession(key, session)
      })
      .finally(() => this.starting.delete(startingKey))
  }

  /**
   * A spawn still in flight when the app shuts down would otherwise land in the
   * map after teardown and orphan the child process. Kill it on arrival.
   */
  private adoptSession(key: string, session: PooledLspProxySession | null) {
    if (!session) return null
    if (this.disposed) {
      session.dispose('pool_disposed')
      return null
    }

    this.sessions.set(key, (this.sessions.get(key) ?? []).concat([session]))
    return session
  }
}

class PooledLspProxySession {
  private readonly connections = new Set<LspProxyConnection>()
  private readonly documents = new Map<string, SharedDocument>()
  /** Delta baselines, per uri. See SemanticTokenBaseline. */
  private readonly semanticTokenBaselines = new Map<string, SemanticTokenBaseline>()
  /** Backend request id per uri, so two tabs asking at once ask the backend once. */
  private readonly semanticTokenInFlight = new Map<string, JsonRpcId>()
  /**
   * The tsserver diagnostics request ids in flight per uri. tsls's `TSServerRequestCommand` takes
   * no cancellation token, so `$/cancelRequest` here cancels only our own wait, not tsserver's
   * queued work; tracking only the latest pair per uri still keeps a burst of reads for one file
   * from piling up, and a read superseded before its answer lands is dropped.
   */
  private readonly tsserverDiagnosticsInFlight = new Map<string, readonly JsonRpcId[]>()
  private semanticTokenDeltaRejections = 0
  readonly key: string
  private readonly match: LspServerMatch
  private readonly pendingRequests = new Map<JsonRpcId, PendingBackendRequest>()
  /** Readers waiting for document synchronization or diagnostics, per uri. */
  private readonly fileWaiters = new Map<string, Set<() => void>>()
  private readonly idleTimeoutMs: () => number
  private readonly deltaEnabled: () => boolean
  private readonly pool: LspSessionPool
  private readonly process: ChildProcessWithoutNullStreams
  private readonly reader: LspStdioMessageReader
  private readonly rootPath: string
  private backendRequestId = 1
  private clientBytes = 0
  private clientMessageCount = 0
  private connectionCount = 0
  private diagnosticPublicationCount = 0
  private diagnosticReplayCount = 0
  private disposed = false
  private exitCode: number | null = null
  private exitSignal: NodeJS.Signals | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private initializeContract: InitializeContract | undefined
  private initializePromise: Promise<JsonRpcResponse> | null = null
  private initializeResult: JsonRpcResponse | null = null
  private initializeSent = false
  private initializedNotificationSent = false
  private openedAt = performance.now()
  private serverBytes = 0
  private serverHandledRequestCount = 0
  private serverMessageCount = 0
  private stderrBytes = 0
  private stderrCount = 0
  private stderrTail = ''
  private readonly handle: LspServerHandle
  private readonly watchedFiles: LspWatchedFiles | null

  private constructor(
    key: string,
    match: LspServerMatch,
    handle: LspServerHandle,
    rootPath: string,
    pool: LspSessionPool,
    idleTimeoutMs: () => number,
    deltaEnabled: () => boolean,
    watchSource: TreeWatchSource | null,
  ) {
    this.deltaEnabled = deltaEnabled
    this.idleTimeoutMs = idleTimeoutMs
    this.key = key
    this.match = match
    this.pool = pool
    this.handle = handle
    this.process = handle.process
    this.rootPath = rootPath
    this.reader = new LspStdioMessageReader((message, byteLength) =>
      this.handleServerMessage(message, byteLength),
    )
    this.watchedFiles = watchSource
      ? new LspWatchedFiles(match.root, watchSource, (changes) => this.notifyWatchedFiles(changes))
      : null
    this.bindProcess()
  }

  static async spawn(
    key: string,
    match: LspServerMatch,
    rootPath: string,
    pool: LspSessionPool,
    idleTimeoutMs: () => number,
    deltaEnabled: () => boolean,
    watchSource: TreeWatchSource | null,
  ) {
    const handle = await match.server.spawn(match.root)
    if (!handle) return null

    return new PooledLspProxySession(
      key,
      match,
      handle,
      rootPath,
      pool,
      idleTimeoutMs,
      deltaEnabled,
      watchSource,
    )
  }

  get isDisposed() {
    return this.disposed
  }

  get negotiatedSemanticTokens(): LspNegotiatedSemanticTokens | null {
    return negotiatedSemanticTokens(this.initializeResult?.result)
  }

  /** Open documents must match the disk snapshot before their diagnostics can describe the edit. */
  fileDiagnostics(
    uri: string,
    timeoutMs: number,
    text: string,
  ): Promise<LspFileDiagnostics | null> {
    return withinDiagnosticsBudget(timeoutMs, async (remaining) => {
      if (this.disposed || !this.initializeResult) return null
      const synchronized = await this.waitForFileState(uri, remaining(), () => {
        const document = this.documents.get(uri)
        return !document || document.text === text
      })
      if (!synchronized || remaining() <= 0) return null
      const capabilities = this.initializeResult.result
      if (supportsPullDiagnostics(capabilities))
        return this.pullFileDiagnostics(uri, text, remaining())
      if (offersTsserverRequests(capabilities))
        return this.tsserverFileDiagnostics(uri, text, remaining())
      return this.publishedFileDiagnostics(uri, text, remaining())
    })
  }

  private async tsserverFileDiagnostics(
    uri: string,
    text: string,
    timeoutMs: number,
  ): Promise<LspFileDiagnostics | null> {
    const document = this.documents.get(uri)
    if (!document || document.text !== text) return null
    const version = document.backendVersion

    const superseded = this.tsserverDiagnosticsInFlight.get(uri)
    if (superseded) for (const id of superseded) this.cancelBackendRequest(id)
    const ids: JsonRpcId[] = []
    const answered = Promise.all(
      tsserverDiagnosticRequests(uri).map((params) =>
        this.backendRequest('workspace/executeCommand', params, timeoutMs, (id) => ids.push(id)),
      ),
    )
    this.tsserverDiagnosticsInFlight.set(uri, ids)
    const responses = await answered
    // A newer read for this uri already replaced the map entry: the newest wins, so this
    // superseded answer, valid or not, is dropped rather than delivered stale.
    const current = this.tsserverDiagnosticsInFlight.get(uri) === ids
    if (current) this.tsserverDiagnosticsInFlight.delete(uri)
    if (!current) return null

    if (this.documents.get(uri) !== document || document.backendVersion !== version) return null

    const failed = responses.find((response) => response !== null && response.error !== undefined)
    if (failed) {
      recordProcessWarning('lsp.tsserver_diagnostics_failed', {
        area: 'lsp',
        error: operatorErrorSummary(failed.error),
        reason: 'backend-error',
        rootPath: this.rootPath,
        serverId: this.match.server.id,
        uri,
      })
      return null
    }
    // A request this call is still waiting on times out silently: the read gives up rather than
    // hang the caller, and the budget itself is the signal worth watching, not a log line.
    if (responses.some((response) => response === null)) return null

    const diagnostics = lspDiagnosticsFromTsserver(responses.map((response) => response?.result))
    if (!diagnostics) {
      recordProcessWarning('lsp.tsserver_diagnostics_failed', {
        area: 'lsp',
        reason: 'unparsed',
        rootPath: this.rootPath,
        serverId: this.match.server.id,
        uri,
      })
      return null
    }
    return { mode: 'pull', diagnostics }
  }

  private async pullFileDiagnostics(
    uri: string,
    text: string,
    timeoutMs: number,
  ): Promise<LspFileDiagnostics | null> {
    const document = this.documents.get(uri)
    if (document && document.text !== text) return null
    const version = document?.backendVersion
    this.notifyWatchedFiles([{ uri, type: FILE_CHANGED }])
    const response = await this.backendRequest(
      'textDocument/diagnostic',
      { textDocument: { uri } },
      timeoutMs,
    )
    if (this.documents.get(uri) !== document || document?.backendVersion !== version) return null
    const items = isRecord(response?.result) ? response.result.items : null
    return Array.isArray(items) ? { mode: 'pull', diagnostics: items } : null
  }

  private async publishedFileDiagnostics(
    uri: string,
    text: string,
    timeoutMs: number,
  ): Promise<LspFileDiagnostics | null> {
    if (!this.documents.has(uri)) return null
    const ready = await this.waitForFileState(uri, timeoutMs, () => {
      const document = this.documents.get(uri)
      return !document || (document.text === text && document.diagnostics !== null)
    })
    const document = this.documents.get(uri)
    if (!ready || document?.text !== text) return null
    const published = publishedDiagnostics(document.diagnostics)
    return published ? { mode: 'push', diagnostics: published } : null
  }

  private backendRequest(
    method: string,
    params: unknown,
    timeoutMs: number,
    onBackendId?: (id: JsonRpcId) => void,
  ) {
    const backendId = this.nextBackendRequestId()
    onBackendId?.(backendId)
    return new Promise<JsonRpcResponse | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(backendId)
        this.cancelBackendRequest(backendId)
        resolve(null)
      }, timeoutMs)
      const settle = (response: JsonRpcResponse | null) => {
        clearTimeout(timer)
        resolve(response)
      }
      this.pendingRequests.set(backendId, {
        clientId: null,
        connection: null,
        method,
        reject: () => settle(null),
        resolve: settle,
      })
      this.writeToServer(JSON.stringify({ id: backendId, jsonrpc: '2.0', method, params }))
    })
  }

  private waitForFileState(uri: string, timeoutMs: number, ready: () => boolean): Promise<boolean> {
    if (this.disposed || timeoutMs <= 0) return Promise.resolve(false)
    if (ready()) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const waiters = this.fileWaiters.get(uri) ?? new Set<() => void>()
      const done = (value: boolean) => {
        clearTimeout(timer)
        waiters.delete(check)
        if (waiters.size === 0) this.fileWaiters.delete(uri)
        resolve(value)
      }
      const check = () => {
        if (this.disposed || ready()) done(!this.disposed)
      }
      const timer = setTimeout(() => done(false), timeoutMs)
      waiters.add(check)
      this.fileWaiters.set(uri, waiters)
    })
  }

  private wakeFileReaders(uri: string): void {
    for (const waiter of this.fileWaiters.get(uri) ?? []) waiter()
  }

  connect(socket: LspProxySocket): LspProxyClientSession {
    const connection = new LspProxyConnection(socket, this)
    this.adopt(connection)
    return connection
  }

  adopt(connection: LspProxyConnection): void {
    this.clearIdleTimer()
    this.connections.add(connection)
    this.connectionCount += 1
  }

  hasContract(contract: InitializeContract): boolean {
    return this.initializeContract?.fingerprint === contract.fingerprint
  }

  /** Reserves a fresh backend for the contract it was spawned for, before any client initializes it. */
  claimContract(contract: InitializeContract): void {
    this.initializeContract ??= contract
  }

  async handleClientMessage(
    connection: LspProxyConnection,
    message: string | ArrayBuffer | Uint8Array,
  ): Promise<void> {
    if (this.disposed) return

    const encoded = normalizeClientMessage(message)
    if (!encoded) return

    this.clientBytes += byteLength(encoded)
    this.clientMessageCount += 1
    await this.routeClientMessage(connection, encoded)
  }

  releaseConnection(connection: LspProxyConnection): void {
    if (!this.connections.delete(connection)) return

    this.cancelPendingRequestsForConnection(connection)
    for (const uri of connection.documentUris()) this.releaseDocumentOwner(connection, uri)
    if (this.connections.size === 0) this.scheduleIdleDisposal()
  }

  private bindProcess(): void {
    // `index.ts` registers only `unhandledRejection`, so a synchronous throw here
    // would take the whole server down with it.
    this.process.stdout.on('data', (chunk) => this.pushServerBytes(chunk))
    this.process.stderr.on('data', (chunk) => this.logStderr(chunk))
    this.process.once('exit', (code, signal) => {
      this.exitCode = code
      this.exitSignal = signal
      this.closeFromProcess('process_exit')
    })
    this.process.once('error', () => this.closeFromProcess('process_error'))
  }

  private async routeClientMessage(connection: LspProxyConnection, encoded: string): Promise<void> {
    const parsed = parseJsonMessage(encoded)
    if (isJsonRpcRequest(parsed)) return this.handleClientRequest(connection, parsed)
    if (isJsonRpcNotification(parsed)) return this.handleClientNotification(connection, parsed)

    this.writeToServer(encoded)
  }

  private async handleClientRequest(
    connection: LspProxyConnection,
    message: JsonRpcRequest,
  ): Promise<void> {
    if (message.method === 'initialize') return this.initializeConnection(connection, message)
    if (message.method === 'shutdown') {
      connection.send(jsonRpcResult(message.id, null))
      return
    }
    if (message.method === SEMANTIC_TOKENS_FULL) {
      return this.handleSemanticTokensFull(connection, message)
    }

    this.forwardClientRequest(connection, message)
  }

  /**
   * Turns a whole-file token request into a delta against the baseline this
   * session already holds, and turns the answer back into a whole file.
   *
   * **The client's request and the client's response are unchanged.** No
   * `full/delta` request and no `SemanticTokensDelta` ever crosses the
   * WebSocket — the browser never holds a `resultId` and does not know this
   * happened. That is not a detail: a `resultId` is per backend document, and
   * this backend is shared by every tab in a root, so a browser holding one
   * would be holding a fact about a resource it does not own.
   *
   * Requests for one uri are also **serialized**. Two concurrent `full/delta`
   * requests carrying the same `previousResultId` make the server issue two new
   * result ids and the cache can only follow one; while one is in flight, later
   * requests for the same uri attach to it and receive the same reassembled
   * answer — which is a straight win when three tabs show the same file.
   */
  private handleSemanticTokensFull(connection: LspProxyConnection, message: JsonRpcRequest): void {
    const uri = textDocumentUri(message.params)
    if (!uri) {
      this.forwardClientRequest(connection, message)
      return
    }

    const inFlight = this.semanticTokenInFlight.get(uri)
    const pending = inFlight === undefined ? null : this.pendingRequests.get(inFlight)
    // Same file *and* same text. Coalescing is justified by three tabs showing
    // one document, which is a claim about content; a request that went out
    // before a `didChange` describes text the user has already replaced, and
    // handing that answer to a client that asked after the edit is how a tab ends
    // up painted from a version it never asked about.
    if (
      pending?.semanticTokens &&
      pending.semanticTokens.backendVersion === this.documentVersion(uri)
    ) {
      pending.semanticTokens.waiters.push({ clientId: message.id, connection })
      connection.trackRequest(message.id, inFlight as JsonRpcId)
      return
    }

    this.sendSemanticTokenRequest(uri, [{ clientId: message.id, connection }], false)
  }

  private documentVersion(uri: string): number {
    return this.documents.get(uri)?.backendVersion ?? -1
  }

  private sendSemanticTokenRequest(
    uri: string,
    waiters: { readonly connection: LspProxyConnection; readonly clientId: JsonRpcId }[],
    retried: boolean,
  ): void {
    const baseline = this.deltaEnabled() ? this.semanticTokenBaselines.get(uri) : undefined
    const delta = Boolean(baseline) && this.backendSupportsSemanticTokenDelta()
    const backendId = this.nextBackendRequestId()

    this.pendingRequests.set(backendId, {
      clientId: waiters[0]?.clientId ?? null,
      connection: waiters[0]?.connection ?? null,
      method: delta ? SEMANTIC_TOKENS_DELTA : SEMANTIC_TOKENS_FULL,
      semanticTokens: {
        backendVersion: this.documentVersion(uri),
        delta,
        previousResultId: delta ? (baseline?.resultId ?? null) : null,
        retried,
        uri,
        waiters,
      },
    })
    this.semanticTokenInFlight.set(uri, backendId)
    for (const waiter of waiters) waiter.connection.trackRequest(waiter.clientId, backendId)

    this.writeToServer(
      JSON.stringify({
        id: backendId,
        jsonrpc: '2.0',
        method: delta ? SEMANTIC_TOKENS_DELTA : SEMANTIC_TOKENS_FULL,
        params: delta
          ? { previousResultId: baseline?.resultId, textDocument: { uri } }
          : { textDocument: { uri } },
      }),
    )
  }

  private backendSupportsSemanticTokenDelta(): boolean {
    return this.negotiatedSemanticTokens?.delta === true
  }

  /**
   * Answers every waiter with a whole `SemanticTokens`, whatever the backend sent.
   *
   * A delta is applied to the baseline here and never forwarded. A response that
   * cannot be reassembled — an unknown `previousResultId`, or edits that do not
   * fit the array — drops the baseline and retries **once** as a plain `full`,
   * because the alternative is answering a client with spans that match no
   * version of its text.
   */
  private handleSemanticTokenResponse(
    backendId: JsonRpcId,
    request: SemanticTokenRequest,
    message: JsonRpcResponse,
  ): void {
    // Only if it is still this request's marker: `releaseDocumentOwner` and a
    // straddling edit can both start a second request for the same uri, and
    // deleting by uri alone would clear the newer one's claim.
    if (this.semanticTokenInFlight.get(request.uri) === backendId) {
      this.semanticTokenInFlight.delete(request.uri)
    }

    // An error that is not about the baseline is not evidence about the baseline.
    // `-32800 RequestCancelled` is the *normal* path while typing — the browser
    // cancels an in-flight request on every keystroke — and `-32801
    // ContentModified` is the ordinary answer to asking about text that has since
    // moved. Treating either as a rejected `previousResultId` would throw away a
    // good baseline on every keystroke, poison the counter that decides whether a
    // server is dropped from the delta set, and re-issue a whole-file request the
    // client explicitly told us to stop working on.
    if (message.error !== undefined && !isRejectedBaselineError(request.delta, message.error)) {
      this.answerSemanticTokenWaiters(request, message)
      return
    }

    const reassembled = this.reassembleSemanticTokens(request, message)
    if (reassembled === null) {
      this.semanticTokenBaselines.delete(request.uri)
      this.semanticTokenDeltaRejections += 1
      if (!request.retried) {
        recordProcessWarning('lsp.semanticTokens.delta_rejected', {
          area: 'lsp',
          operation: 'semantic_tokens',
          outcome: 'baseline_dropped',
          rejections: this.semanticTokenDeltaRejections,
          rootPath: this.rootPath,
          serverId: this.match.server.id,
        })
        this.sendSemanticTokenRequest(request.uri, request.waiters, true)
        return
      }

      // Retried already. Hand the backend's own answer through untouched rather
      // than inventing one; a client that gets an error asks again on its own
      // schedule, which is better than a loop here.
      this.answerSemanticTokenWaiters(request, message)
      return
    }

    const full = { data: reassembled.data, resultId: reassembled.resultId }
    for (const waiter of request.waiters) {
      waiter.connection.untrackRequest(waiter.clientId)
      waiter.connection.send(jsonRpcResult(waiter.clientId, full))
    }
  }

  /** Forwards the backend's own response to every waiter, under each one's id. */
  private answerSemanticTokenWaiters(
    request: SemanticTokenRequest,
    message: JsonRpcResponse,
  ): void {
    for (const waiter of request.waiters) {
      waiter.connection.untrackRequest(waiter.clientId)
      waiter.connection.send(JSON.stringify(responseForClient(message, waiter.clientId)))
    }
  }

  /**
   * The reassembled array, or `null` when this answer cannot be trusted.
   *
   * `null` is deliberately the answer for every doubtful case — an error
   * response, a missing baseline, an edit that runs past the end of the array —
   * because the failure mode of guessing is spans painted over unrelated text
   * with nothing reporting it.
   */
  private reassembleSemanticTokens(
    request: SemanticTokenRequest,
    message: JsonRpcResponse,
  ): SemanticTokenBaseline | null {
    if (message.error !== undefined) return null
    if (!isRecord(message.result)) return null

    const resultId = typeof message.result.resultId === 'string' ? message.result.resultId : ''
    const data = message.result.data
    if (Array.isArray(data)) {
      const next = { data: data as number[], resultId }
      if (resultId) this.semanticTokenBaselines.set(request.uri, next)
      return next
    }

    const edits = message.result.edits
    if (!Array.isArray(edits)) return null

    const baseline = this.semanticTokenBaselines.get(request.uri)
    if (!baseline) return null
    // The one the server diffed against, not merely the one that happens to be
    // here now. Another request for this uri can have completed in the gap and
    // replaced it, and splicing these edits into a different array produces a
    // token stream that describes no version of anything.
    if (request.previousResultId !== null && baseline.resultId !== request.previousResultId) {
      return null
    }

    const applied = applySemanticTokenEdits(baseline.data, edits)
    if (!applied) return null
    // The check that makes this branch safe to ship. Everything above validates
    // the *edits*; this validates the *result*, against the text this session is
    // holding for the same uri — and it is the only thing standing between a
    // mis-reassembled array and spans painted over unrelated code with every
    // drop counter reading zero.
    if (!this.semanticTokensFitDocument(request.uri, applied)) return null

    const next = { data: applied, resultId: resultId || baseline.resultId }
    this.semanticTokenBaselines.set(request.uri, next)
    return next
  }

  /**
   * Does this token stream describe a document this session actually has?
   *
   * A 5-tuple stream is a cumulative walk: each tuple's `deltaLine` advances a
   * line cursor that never goes backwards. So a stream that has been shifted,
   * truncated or spliced wrong overwhelmingly walks *past the last line* — which
   * is one integer comparison per tuple to detect, against a line count that
   * costs a single scan of text this session already holds in memory.
   *
   * Not gated on a dev build. It is roughly 0.1 ms against a 200 KB file, on a
   * path that exists to save 14 ms of `JSON.parse` per twelve keystrokes, and the
   * failure it catches is silent in production and nowhere else.
   */
  private semanticTokensFitDocument(uri: string, data: readonly number[]): boolean {
    const document = this.documents.get(uri)
    // Nothing to check against is not evidence of a problem: a token request can
    // outlive the `didClose` that removed the shared document.
    if (!document) return true

    let lineCount = 1
    for (let index = 0; index < document.text.length; index += 1) {
      if (document.text[index] === '\n') lineCount += 1
    }

    let line = 0
    for (let index = 0; index + 5 <= data.length; index += 5) {
      line += data[index] as number
      if (line >= lineCount) return false
    }

    return true
  }

  async initializeConnection(
    connection: LspProxyConnection,
    message: JsonRpcRequest,
  ): Promise<void> {
    try {
      const prepared = await this.initializeRequest(message)
      if (this.disposed || connection.isClosed) return
      const contract = initializeContractOf(prepared.params)
      const mismatch = this.initializeContractMismatch(contract)
      if (mismatch !== null) {
        await this.moveToContractSession(connection, message, contract, mismatch)
        return
      }

      const response = await this.ensureInitialized(prepared)
      connection.send(JSON.stringify(responseForClient(response, message.id)))
    } catch (error) {
      connection.send(jsonRpcError(message.id, -32000, errorMessage(error)))
    }
  }

  /** The first path where `contract` departs from this backend's, or `null` when it matches. */
  private initializeContractMismatch(contract: InitializeContract): string | null {
    if (this.initializeContract === undefined) {
      this.initializeContract = contract
      return null
    }
    if (this.hasContract(contract)) return null

    return (
      protocolValueDifference(this.initializeContract.value, contract.value, 'params') ?? 'params'
    )
  }

  /**
   * A backend is initialized once, so a client asking for different capabilities (a tab from an
   * older build) is served by a sibling backend rather than refused while this one lives.
   */
  private async moveToContractSession(
    connection: LspProxyConnection,
    message: JsonRpcRequest,
    contract: InitializeContract,
    mismatchPath: string,
  ): Promise<void> {
    const target = await this.pool.sessionForContract(this.match, this.rootPath, contract)
    recordProcessInfo('lsp.initialize_contract_split', {
      area: 'lsp',
      mismatchPath,
      outcome: target ? 'moved' : 'spawn_failed',
      rootPath: this.rootPath,
      serverId: this.match.server.id,
    })
    if (connection.isClosed) return
    if (!target || target.isDisposed) {
      connection.send(jsonRpcError(message.id, -32000, 'Language server failed to start'))
      connection.closeForProtocolError()
      return
    }

    connection.moveTo(target)
    await target.initializeConnection(connection, message)
  }

  private ensureInitialized(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.initializeResult) return Promise.resolve(this.initializeResult)
    if (this.initializePromise) return this.initializePromise

    this.initializePromise = this.sendInitializeRequest(message)
    return this.initializePromise
  }

  private sendInitializeRequest(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.disposed) {
      if (!this.initializeSent) this.initializeContract = undefined
      return Promise.reject(createInternalError('LSP session disposed before initialize'))
    }

    const backendId = this.nextBackendRequestId()
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pendingRequests.set(backendId, {
        clientId: message.id,
        connection: null,
        method: 'initialize',
        reject,
        resolve,
      })
    })

    try {
      this.writeToServer(JSON.stringify({ ...message, id: backendId }))
      this.initializeSent = true
    } catch (error) {
      this.pendingRequests.delete(backendId)
      if (!this.initializeSent) this.initializeContract = undefined
      throw error
    }

    return response
      .then((result) => {
        this.initializeResult = result
        this.recordNegotiatedSemanticTokens()
        return result
      })
      .catch((error: unknown) => {
        this.initializePromise = null
        if (!this.initializeSent) this.initializeContract = undefined
        throw error
      })
  }

  /**
   * Logged once per pooled backend, at the only moment the answer is decided.
   *
   * `initialize` is sent once per backend and its result is replayed to every
   * later client, so this is the whole negotiation for every tab in this root —
   * and it is the one record that survives a server upgrade silently dropping a
   * capability or reshaping its legend.
   */
  private recordNegotiatedSemanticTokens(): void {
    const negotiated = this.negotiatedSemanticTokens
    recordProcessInfo('lsp.semanticTokens.negotiated', {
      area: 'lsp',
      delta: negotiated?.delta ?? false,
      full: negotiated?.full ?? false,
      modifierCount: negotiated?.legend.tokenModifiers.length ?? 0,
      operation: 'initialize',
      outcome: negotiated ? 'advertised' : 'absent',
      range: negotiated?.range ?? false,
      rootPath: this.rootPath,
      serverId: this.match.server.id,
      typeCount: negotiated?.legend.tokenTypes.length ?? 0,
    })
  }

  private async initializeRequest(message: JsonRpcRequest): Promise<JsonRpcRequest> {
    const params = isRecord(message.params) ? { ...message.params } : {}
    params.rootUri = fileUriForNativePath(this.match.root)
    params.workspaceFolders = [
      {
        name: this.match.server.id,
        uri: fileUriForNativePath(this.match.root),
      },
    ]
    params.processId = this.process.pid ?? null
    if (this.watchedFiles) params.capabilities = withWatchedFilesCapability(params.capabilities)
    await this.applyInitializationOptions(params)
    return { ...message, params }
  }

  private async applyInitializationOptions(params: Record<string, unknown>): Promise<void> {
    const options = await this.match.server.initializationOptions?.(this.match.root)
    if (!options && !this.handle.initializationOptions) return

    params.initializationOptions = {
      ...(isRecord(params.initializationOptions) ? params.initializationOptions : {}),
      ...this.handle.initializationOptions,
      ...options,
    }
  }

  private async handleClientNotification(
    connection: LspProxyConnection,
    message: JsonRpcNotification,
  ): Promise<void> {
    if (message.method === '$/cancelRequest')
      return this.forwardCancelNotification(connection, message)
    if (message.method === 'initialized') return this.forwardInitializedNotification(message)
    if (message.method === 'exit') {
      connection.dispose()
      return
    }
    if (message.method === 'textDocument/didOpen') return this.handleDidOpen(connection, message)
    if (message.method === 'textDocument/didChange')
      return this.handleDidChange(connection, message)
    if (message.method === 'textDocument/didClose') return this.handleDidClose(connection, message)

    this.writeToServer(JSON.stringify(message))
  }

  private forwardCancelNotification(
    connection: LspProxyConnection,
    message: JsonRpcNotification,
  ): void {
    const clientId = cancellationRequestId(message.params)
    if (clientId === null) return
    const backendId = connection.backendRequestIdFor(clientId)
    if (backendId === null) return

    const pending = this.pendingRequests.get(backendId)
    if (pending?.semanticTokens) {
      connection.untrackRequest(clientId)
      this.dropSemanticTokenWaiters(
        backendId,
        pending.semanticTokens,
        (waiter) => waiter.connection === connection && waiter.clientId === clientId,
      )
      return
    }

    if (pending?.workspaceEditProvenance) {
      delete pending.workspaceEditProvenance
      pending.workspaceEditCancelled = true
    }

    this.writeToServer(
      JSON.stringify({
        ...message,
        params: {
          ...(isRecord(message.params) ? message.params : {}),
          id: backendId,
        },
      }),
    )
  }

  private async forwardInitializedNotification(message: JsonRpcNotification): Promise<void> {
    if (this.initializedNotificationSent) return

    this.initializedNotificationSent = true
    if (!this.initializeResult && this.initializePromise) await this.initializePromise
    if (this.disposed) return

    this.writeToServer(JSON.stringify(message))
    this.pushConfiguration()
  }

  private pushConfiguration(): void {
    const settings = this.match.server.didChangeConfiguration
    if (!settings) return

    this.writeToServer(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'workspace/didChangeConfiguration',
        params: { settings },
      }),
    )
  }

  private handleDidOpen(connection: LspProxyConnection, message: JsonRpcNotification): void {
    const document = didOpenDocument(message.params)
    if (!document) {
      connection.closeForProtocolError()
      return
    }

    const shared = this.documents.get(document.uri)
    if (shared) {
      this.attachExistingDocument(connection, shared, document)
      return
    }

    this.openBackendDocument(document, connection, message)
  }

  private attachExistingDocument(
    connection: LspProxyConnection,
    shared: SharedDocument,
    opened: DidOpenDocument,
  ): void {
    if (shared.owners.has(connection) || shared.languageId !== opened.languageId) {
      connection.closeForProtocolError()
      return
    }
    if (shared.text === opened.text) {
      shared.owners.set(connection, synchronizedOwner(opened, shared))
      connection.addDocument(opened.uri)
      if (shared.diagnostics !== null) {
        connection.send(shared.diagnostics)
        this.diagnosticReplayCount += 1
      }
      return
    }

    const backendVersion = safeSum(shared.backendVersion, 1)
    const syncEpoch = safeSum(shared.syncEpoch, 1)
    if (backendVersion === null || syncEpoch === null) {
      connection.closeForProtocolError()
      return
    }

    shared.diagnostics = null
    this.sendFullDocumentChange(opened.uri, opened.text, backendVersion)
    shared.backendVersion = backendVersion
    shared.syncEpoch = syncEpoch
    shared.text = opened.text
    shared.owners.set(connection, synchronizedOwner(opened, shared))
    connection.addDocument(opened.uri)
    this.wakeFileReaders(opened.uri)
  }

  private openBackendDocument(
    document: DidOpenDocument,
    owner: LspProxyConnection,
    message: JsonRpcNotification,
  ): void {
    const shared = {
      backendVersion: document.version,
      diagnostics: null,
      languageId: document.languageId,
      owners: new Map<LspProxyConnection, OwnerDocumentState>(),
      syncEpoch: 0,
      text: document.text,
    } satisfies SharedDocument
    shared.owners.set(owner, synchronizedOwner(document, shared))
    this.documents.set(document.uri, shared)
    owner.addDocument(document.uri)
    this.writeToServer(JSON.stringify(rewriteTextDocumentVersion(message, shared.backendVersion)))
    this.wakeFileReaders(document.uri)
  }

  private handleDidChange(connection: LspProxyConnection, message: JsonRpcNotification): void {
    const change = didChangeDocument(message.params)
    if (!change) {
      connection.closeForProtocolError()
      return
    }

    const shared = this.documents.get(change.uri)
    const owner = shared?.owners.get(connection)
    if (!shared || !owner) {
      connection.closeForProtocolError()
      return
    }

    const logicalDelta = change.version - owner.clientVersion
    const backendVersion = safeSum(shared.backendVersion, logicalDelta)
    const syncEpoch = safeSum(shared.syncEpoch, 1)
    const contentEpoch = safeSum(owner.contentEpoch, 1)
    const text = applyContentChangesStrict(owner.text, change.contentChanges)
    if (
      logicalDelta <= 0 ||
      !Number.isSafeInteger(logicalDelta) ||
      backendVersion === null ||
      syncEpoch === null ||
      contentEpoch === null ||
      text === null
    ) {
      connection.closeForProtocolError()
      return
    }

    shared.diagnostics = null
    if (ownerIsSynchronized(owner, shared)) {
      this.writeToServer(JSON.stringify(rewriteTextDocumentVersion(message, backendVersion)))
    } else {
      this.sendFullDocumentChange(change.uri, text, backendVersion)
    }

    shared.backendVersion = backendVersion
    shared.syncEpoch = syncEpoch
    shared.text = text
    owner.clientVersion = change.version
    owner.contentEpoch = contentEpoch
    owner.lastSyncEpoch = syncEpoch
    owner.synchronizedBackendVersion = backendVersion
    owner.text = text
    this.wakeFileReaders(change.uri)
  }

  private handleDidClose(connection: LspProxyConnection, message: JsonRpcNotification): void {
    const uri = textDocumentUri(message.params)
    if (!uri) {
      this.writeToServer(JSON.stringify(message))
      return
    }

    this.releaseDocumentOwner(connection, uri)
  }

  private releaseDocumentOwner(connection: LspProxyConnection, uri: string): void {
    connection.deleteDocument(uri)
    const document = this.documents.get(uri)
    if (!document) return

    document.owners.delete(connection)
    if (document.owners.size > 0) return

    this.documents.delete(uri)
    this.wakeFileReaders(uri)
    // The server's own cache for this document dies with the `didClose`, so a
    // baseline kept past it would be a `previousResultId` nothing can diff.
    this.semanticTokenBaselines.delete(uri)
    // And the request in flight for it has to be retired rather than merely
    // forgotten: clearing only the marker leaves a live pending request whose
    // answer would re-seed a baseline for a document the backend has closed,
    // while a second request starts alongside it — two concurrent token requests
    // for one uri, which is the thing serialization exists to prevent.
    this.retireSemanticTokenRequest(uri)
    this.writeToServer(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: { textDocument: { uri } },
      }),
    )
  }

  private sendFullDocumentChange(uri: string, text: string, version: number): void {
    this.writeToServer(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          contentChanges: [{ text }],
          textDocument: {
            uri,
            version,
          },
        },
      }),
    )
  }

  private forwardClientRequest(connection: LspProxyConnection, message: JsonRpcRequest): void {
    const backendId = this.nextBackendRequestId()
    const pending: PendingBackendRequest = {
      clientId: message.id,
      connection,
      method: message.method,
    }
    if (workspaceEditResponseMethod(message.method)) {
      pending.workspaceEditProvenance = this.captureWorkspaceEditProvenance(connection)
    }

    this.pendingRequests.set(backendId, pending)
    connection.trackRequest(message.id, backendId)
    this.writeToServer(JSON.stringify({ ...message, id: backendId }))
  }

  private captureWorkspaceEditProvenance(connection: LspProxyConnection): WorkspaceEditProvenance {
    const documents = new Map<string, CapturedDocumentProvenance>()
    for (const [uri, shared] of this.documents) {
      const owner = shared.owners.get(connection)
      documents.set(uri, {
        backendVersion: shared.backendVersion,
        owner: owner ? { ...owner } : null,
        syncEpoch: shared.syncEpoch,
        text: shared.text,
      })
    }

    return { connection, documents }
  }

  private handleServerMessage(message: string, byteLength: number): void {
    // The reader already framed this body, so its length is known exactly and
    // does not need re-measuring.
    this.serverBytes += byteLength
    this.serverMessageCount += 1
    const parsed = parseJsonMessage(message)
    if (isJsonRpcRequest(parsed)) {
      this.handleServerRequestMessage(parsed)
      return
    }
    if (isJsonRpcResponse(parsed)) return this.handleServerResponse(parsed)
    if (isJsonRpcNotification(parsed)) return this.broadcastServerNotification(parsed, message)

    this.broadcastServerMessage(message)
  }

  private handleServerResponse(message: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(message.id)
    if (!pending) return

    this.pendingRequests.delete(message.id)
    if (pending.semanticTokens) {
      this.handleSemanticTokenResponse(message.id, pending.semanticTokens, message)
      return
    }

    pending.connection?.untrackRequest(pending.clientId)
    if (pending.resolve) {
      pending.resolve(message)
      return
    }

    if (message.error !== undefined) {
      pending.connection?.send(JSON.stringify(responseForClient(message, pending.clientId)))
      return
    }
    if (pending.workspaceEditCancelled) {
      pending.connection?.send(
        jsonRpcError(pending.clientId, CONTENT_MODIFIED_CODE, 'Content modified'),
      )
      return
    }
    if (!pending.workspaceEditProvenance) {
      pending.connection?.send(JSON.stringify(responseForClient(message, pending.clientId)))
      return
    }

    const translated = translateWorkspaceEditResponse(
      pending.method,
      message.result,
      pending.workspaceEditProvenance,
      this.documents,
    )
    if (!translated.ok) {
      pending.connection?.send(
        jsonRpcError(pending.clientId, CONTENT_MODIFIED_CODE, 'Content modified'),
      )
      return
    }

    pending.connection?.send(
      JSON.stringify(responseForClient({ ...message, result: translated.value }, pending.clientId)),
    )
  }

  private handleServerRequestMessage(message: JsonRpcRequest): void {
    if (this.handleServerRequest(message)) {
      this.serverHandledRequestCount += 1
      return
    }

    this.respondToServerError(message.id, -32601, `Method not implemented: ${message.method}`)
    this.serverHandledRequestCount += 1
  }

  private handleServerRequest(message: JsonRpcRequest): boolean {
    if (message.method === 'workspace/configuration') {
      this.respondToServer(message.id, this.workspaceConfiguration(message.params))
      return true
    }
    if (message.method === 'workspace/workspaceFolders') {
      this.respondToServer(message.id, [
        {
          name: this.match.server.id,
          uri: fileUriForNativePath(this.match.root),
        },
      ])
      return true
    }
    if (message.method === 'window/workDoneProgress/create') {
      this.respondToServer(message.id, null)
      return true
    }
    if (message.method === 'client/registerCapability') {
      void this.registerCapability(message)
      return true
    }
    if (message.method === 'client/unregisterCapability') {
      void this.unregisterCapability(message)
      return true
    }
    if (message.method === LSP_SEMANTIC_TOKENS_REFRESH) {
      this.broadcastRefresh(message.id, LSP_SEMANTIC_TOKENS_REFRESH)
      return true
    }
    if (message.method === LSP_DIAGNOSTIC_REFRESH) {
      this.broadcastRefresh(message.id, LSP_DIAGNOSTIC_REFRESH)
      return true
    }

    return false
  }

  /**
   * Answers the server itself, then re-emits the method to every connection as a
   * **notification**.
   *
   * A downgrade rather than a forward, and the difference is load-bearing. *N*
   * pooled clients cannot answer one request id — whichever answered first would
   * decide for the rest — so the proxy has to answer. And a forwarded request
   * would draw a client *response*, which `routeClientMessage` falls through to
   * `writeToServer` verbatim with an unremapped id; that path is dead today only
   * because nothing ever asks a browser to respond, and a notification has no id
   * and draws no response, so it stays dead.
   *
   * The name is the same method name with no `id`. That is a convention between
   * this proxy and the browser code it serves rather than anything LSP defines,
   * which is exactly why it is written down here: a host registers a handler for
   * it by name.
   */
  private broadcastRefresh(id: JsonRpcId, method: string): void {
    this.respondToServer(id, null)
    this.broadcastServerMessage(JSON.stringify({ jsonrpc: '2.0', method }))
  }

  /**
   * One value per requested item, in the order the server asked.
   *
   * The old reply was a fixed `[{}]` for every request, which was wrong twice
   * over. It ignored `items[].section` — a server asking for three sections got
   * one object back and had to guess — and an empty object is not a neutral
   * answer to a server that reads feature flags out of it (see
   * `LspServerDefinition.configuration`).
   *
   * A request with no `items` array is answered `[{}]` still: that is a
   * malformed request rather than a request for everything, and inventing a
   * length for it would be worse than the shape the server already tolerated.
   */
  private workspaceConfiguration(params: unknown): unknown[] {
    const items = isRecord(params) && Array.isArray(params.items) ? params.items : null
    if (!items) return [{}]

    const configuration = this.match.server.configuration?.(this.match.root) ?? {}
    return items.map((item) =>
      configurationSection(configuration, isRecord(item) ? item.section : null),
    )
  }

  /**
   * Watched-file registrations are answered once their watches are attached, so an event the
   * server expects after its request completes cannot be lost. A failure is reported, not
   * acknowledged. Other registrations are acknowledged as before: nothing here acts on them.
   */
  private async registerCapability(message: JsonRpcRequest): Promise<void> {
    const registrations = capabilityChanges(message.params, 'registrations')
    try {
      for (const registration of registrations) {
        if (registration.method !== DID_CHANGE_WATCHED_FILES) continue
        if (!this.watchedFiles) throw createInternalError('Watched files are not supported')
        await this.watchedFiles.register(registration.id, registration.registerOptions)
      }
      this.respondToServer(message.id, null)
    } catch (error) {
      recordProcessWarning('lsp.watched_files.register_failed', {
        area: 'lsp',
        error: operatorErrorSummary(error),
        registrationCount: registrations.length,
        rootPath: this.rootPath,
        serverId: this.match.server.id,
      })
      this.respondToServerError(message.id, -32603, errorMessage(error))
    }
  }

  private async unregisterCapability(message: JsonRpcRequest): Promise<void> {
    // The protocol spells the field `unregisterations`.
    for (const unregistration of capabilityChanges(message.params, 'unregisterations')) {
      if (unregistration.method !== DID_CHANGE_WATCHED_FILES) continue
      await this.watchedFiles?.unregister(unregistration.id)
    }
    this.respondToServer(message.id, null)
  }

  private notifyWatchedFiles(changes: FileEvent[]): void {
    this.writeToServer(
      JSON.stringify({ jsonrpc: '2.0', method: DID_CHANGE_WATCHED_FILES, params: { changes } }),
    )
  }

  private respondToServer(id: JsonRpcId, result: unknown): void {
    this.writeToServer(jsonRpcResult(id, result))
  }

  private respondToServerError(id: JsonRpcId, code: number, message: string): void {
    this.writeToServer(jsonRpcError(id, code, message))
  }

  private broadcastServerNotification(message: JsonRpcNotification, raw: string): void {
    const notification = serverNotificationForClient(message, raw)
    this.captureDiagnostics(message, notification)
    this.broadcastServerMessage(notification)
  }

  private captureDiagnostics(message: JsonRpcNotification, notification: string): void {
    if (message.method !== 'textDocument/publishDiagnostics') return
    const params = message.params
    if (!isRecord(params) || typeof params.uri !== 'string') return
    this.diagnosticPublicationCount += 1
    const document = this.documents.get(params.uri)
    if (!document || !Array.isArray(params.diagnostics)) return
    if (params.version !== undefined && params.version !== document.backendVersion) return
    document.diagnostics = notification
    this.wakeFileReaders(params.uri)
  }

  private broadcastServerMessage(message: string): void {
    for (const connection of this.connections) connection.send(message)
  }

  private writeToServer(message: string): void {
    if (this.disposed) return

    writeLspStdioMessage(this.process.stdin, message)
  }

  private nextBackendRequestId(): JsonRpcId {
    const id = `platform-${this.backendRequestId}`
    this.backendRequestId += 1
    return id
  }

  private cancelPendingRequestsForConnection(connection: LspProxyConnection): void {
    for (const [backendId, pending] of Array.from(this.pendingRequests)) {
      // A token request is shared: several tabs showing one file wait on a single
      // backend request, and `pending.connection` is only whichever of them asked
      // first. Cancelling on that name would let the first tab to close take the
      // answer away from every other tab still waiting for it.
      if (pending.semanticTokens) {
        this.dropSemanticTokenWaiters(
          backendId,
          pending.semanticTokens,
          (waiter) => waiter.connection === connection,
        )
        continue
      }
      if (pending.connection !== connection) continue

      this.pendingRequests.delete(backendId)
      this.cancelBackendRequest(backendId)
    }
  }

  private dropSemanticTokenWaiters(
    backendId: JsonRpcId,
    request: SemanticTokenRequest,
    shouldDrop: (waiter: SemanticTokenRequest['waiters'][number]) => boolean,
  ): void {
    const remaining = request.waiters.filter((waiter) => !shouldDrop(waiter))
    if (remaining.length === request.waiters.length) return
    if (remaining.length > 0) {
      request.waiters.splice(0, request.waiters.length, ...remaining)
      return
    }

    // Nobody is listening any more, so the backend can stop working on it — and
    // the baseline must not be updated by an answer nothing will read.
    this.pendingRequests.delete(backendId)
    if (this.semanticTokenInFlight.get(request.uri) === backendId) {
      this.semanticTokenInFlight.delete(request.uri)
    }
    this.cancelBackendRequest(backendId)
  }

  /** Cancels and forgets whatever token request is in flight for this uri. */
  private retireSemanticTokenRequest(uri: string): void {
    const backendId = this.semanticTokenInFlight.get(uri)
    this.semanticTokenInFlight.delete(uri)
    if (backendId === undefined) return

    const pending = this.pendingRequests.get(backendId)
    if (!pending?.semanticTokens) return

    for (const waiter of pending.semanticTokens.waiters) {
      waiter.connection.untrackRequest(waiter.clientId)
    }
    this.pendingRequests.delete(backendId)
    this.cancelBackendRequest(backendId)
  }

  private cancelBackendRequest(backendId: JsonRpcId): void {
    this.writeToServer(
      JSON.stringify({
        jsonrpc: '2.0',
        method: '$/cancelRequest',
        params: { id: backendId },
      }),
    )
  }

  private scheduleIdleDisposal(): void {
    this.clearIdleTimer()
    const timer = setTimeout(() => this.dispose('idle_timeout'), this.idleTimeoutMs())
    // A 120-second handle must not be the reason the process refuses to exit.
    timer.unref()
    this.idleTimer = timer
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return

    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private pushServerBytes(chunk: Buffer): void {
    try {
      this.reader.push(chunk)
    } catch (error) {
      recordProcessWarning('lsp.framing_failed', {
        area: 'lsp',
        error: operatorErrorSummary(error),
        serverId: this.match.server.id,
        ...this.reader.stats,
      })
      // `dispose`, not `closeFromProcess`: the child is still alive. The latter is
      // for a process that already exited, so it never kills one — and having
      // already left the pool, nothing would reap it later either.
      this.dispose('framing_error')
    }
  }

  private closeFromProcess(outcome: string): void {
    // An exit after `dispose` is ours whatever its code, and `dispose` already logged it at info.
    if (this.disposed) return

    this.disposed = true
    this.clearIdleTimer()
    this.pool.remove(this)
    this.rejectPendingRequests(createInternalError(`LSP process closed: ${outcome}`))
    this.recordSession(outcome)
    void this.watchedFiles?.dispose()
    this.closeConnections(outcome)
  }

  /**
   * Public because the pool disposes its sessions on app shutdown; before that,
   * only the idle timer could reach it.
   */
  dispose(outcome: string): void {
    if (this.disposed) return

    this.disposed = true
    this.clearIdleTimer()
    this.pool.remove(this)
    // Rejected before the sockets close so an in-flight `initialize` can still
    // deliver its JSON-RPC error. Ordinary forwarded requests carry no reject
    // handler: their client learns the turn is over from the socket closing.
    this.rejectPendingRequests(createInternalError(`LSP session disposed: ${outcome}`))
    this.process.kill()
    // Before `closeConnections`, so `activeConnectionCount` reports how many
    // clients shutdown actually cut off.
    this.recordSession(outcome)
    void this.watchedFiles?.dispose()
    this.closeConnections(outcome)
  }

  /** Says why, then closes; the editor reports the close as `LspServerExitedError`. */
  private closeConnections(outcome: string): void {
    for (const uri of this.fileWaiters.keys()) this.wakeFileReaders(uri)
    const exit = JSON.stringify({
      jsonrpc: '2.0',
      method: LSP_SERVER_EXITED,
      params: {
        error: this.exitError(outcome),
        exitCode: this.exitCode,
        exitSignal: this.exitSignal,
        outcome,
        serverId: this.match.server.id,
        stderrTail: this.stderrTail || undefined,
      } satisfies LspServerExitedParams,
    })
    for (const connection of this.connections) {
      connection.send(exit)
      connection.closeSocket()
    }
    this.connections.clear()
  }

  /** The catalog's guidance for a backend that died; absent when this app closed it. */
  private exitError(outcome: string) {
    if (!isFailedLspSession(outcome, this.exitCode, this.exitSignal)) return undefined

    const error = lspErrors.SERVER_EXITED({ serverId: this.match.server.id })
    return { code: error.code, fix: error.fix, message: error.message, why: error.why }
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject?.(error)

    this.pendingRequests.clear()
  }

  private logStderr(chunk: Buffer | Uint8Array | string): void {
    const text = Buffer.from(chunk).toString('utf8').trim()
    if (!text) return

    this.stderrBytes += Buffer.byteLength(text, 'utf8')
    this.stderrCount += 1
    this.stderrTail = limitText(`${this.stderrTail}\n${text}`.trim(), 1_000)
  }

  private recordSession(outcome: string): void {
    const framing = this.reader.stats
    const initialized = this.initializeResult?.result
    const context = {
      activeConnectionCount: this.connections.size,
      area: 'lsp',
      clientBytes: this.clientBytes,
      clientMessageCount: this.clientMessageCount,
      connectionCount: this.connectionCount,
      diagnosticPublicationCount: this.diagnosticPublicationCount,
      diagnosticReplayCount: this.diagnosticReplayCount,
      durationMs: elapsedMs(this.openedAt),
      exitCode: this.exitCode,
      exitSignal: this.exitSignal,
      operation: 'session',
      outcome,
      rootPath: this.rootPath,
      serverBytes: this.serverBytes,
      // `serverChunkCount` far above `serverMessageCount` with a large
      // `serverMaxMessageBytes` is one body reassembled across many reads.
      serverChunkCount: framing.chunkCount,
      framingDiscardedBytes: framing.discardedBytes,
      framingMalformedCount: framing.malformedCount,
      serverMaxMessageBytes: framing.maxMessageBytes,
      serverHandledRequestCount: this.serverHandledRequestCount,
      serverId: this.match.server.id,
      serverInfo: isRecord(initialized) ? initialized.serverInfo : undefined,
      serverMessageCount: this.serverMessageCount,
      stderrBytes: this.stderrBytes,
      stderrCount: this.stderrCount,
      stderrTail: this.stderrTail || undefined,
      watchedFiles: this.watchedFiles?.stats,
    }

    if (isFailedLspSession(outcome, this.exitCode, this.exitSignal)) {
      recordProcessWarning('lsp.session', context)
      return
    }

    recordProcessInfo('lsp.session', context)
  }
}

function synchronizedOwner(document: DidOpenDocument, shared: SharedDocument): OwnerDocumentState {
  return {
    clientVersion: document.version,
    contentEpoch: 0,
    lastSyncEpoch: shared.syncEpoch,
    synchronizedBackendVersion: shared.backendVersion,
    text: document.text,
  }
}

function ownerIsSynchronized(owner: OwnerDocumentState, shared: SharedDocument): boolean {
  if (owner.text !== shared.text) return false
  if (owner.lastSyncEpoch !== shared.syncEpoch) return false

  return owner.synchronizedBackendVersion === shared.backendVersion
}

function lspProxySessionKey(match: LspServerMatch): string {
  return `${match.server.id}\u0000${match.root}`
}

function isFailedLspSession(
  outcome: string,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | null,
): boolean {
  if (outcome === 'process_error') return true
  if (outcome !== 'process_exit') return false
  if (exitSignal) return true

  return exitCode !== 0
}
