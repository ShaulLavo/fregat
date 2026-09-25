import { lineStartOffset } from '@workspace/utils/strings'
import { errorMessage } from '@workspace/contracts'
import { elapsedMs } from '@workspace/utils/timing'
import { createInternalError, lspErrors } from '../observability/structured-errors'

import {
  DEFAULT_SETTING_VALUES,
  LSP_DIAGNOSTIC_REFRESH,
  LSP_SEMANTIC_TOKENS_REFRESH,
  LSP_SERVER_EXITED,
  type LspNegotiatedSemanticTokens,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { LspServerHandle, LspServerMatch } from './registry'
import { fileUriForPath } from './language'
import { LspStdioMessageReader, writeLspStdioMessage } from './stdio-rpc'
import { DID_CHANGE_WATCHED_FILES, LspWatchedFiles, type FileEvent } from './watched-files'
import type { TreeWatchSource } from '../fs/tree-watch'
import { errorSummary, limitText, recordProcessInfo, recordProcessWarning } from '../observability'

type JsonRpcId = number | string | null

type JsonRpcRequest = {
  readonly id: JsonRpcId
  readonly jsonrpc?: string
  readonly method: string
  params?: unknown
}

type JsonRpcNotification = {
  readonly jsonrpc?: string
  readonly method: string
  params?: unknown
}

type JsonRpcResponse = {
  readonly id: JsonRpcId
  readonly jsonrpc?: string
  readonly result?: unknown
  readonly error?: unknown
}

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

type SharedDocument = {
  backendVersion: number
  diagnostics: string | null
  languageId: string
  readonly owners: Map<LspProxyConnection, OwnerDocumentState>
  syncEpoch: number
  text: string
}

type OwnerDocumentState = {
  clientVersion: number
  text: string
  contentEpoch: number
  lastSyncEpoch: number
  synchronizedBackendVersion: number
}

type CapturedDocumentProvenance = {
  readonly backendVersion: number
  readonly owner: Readonly<OwnerDocumentState> | null
  readonly syncEpoch: number
  readonly text: string
}

type WorkspaceEditProvenance = {
  readonly connection: LspProxyConnection
  readonly documents: ReadonlyMap<string, CapturedDocumentProvenance>
}

type DidOpenDocument = {
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

    this.sessions.set(key, [...(this.sessions.get(key) ?? []), session])
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
  private semanticTokenDeltaRejections = 0
  readonly key: string
  private readonly match: LspServerMatch
  private readonly pendingRequests = new Map<JsonRpcId, PendingBackendRequest>()
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
    if (message.error !== undefined && !isRejectedBaselineError(request, message.error)) {
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
    params.rootUri = fileUriForPath(this.match.root)
    params.workspaceFolders = [
      {
        name: this.match.server.id,
        uri: fileUriForPath(this.match.root),
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
    const backendId = clientId === null ? null : connection.backendRequestIdFor(clientId)
    if (backendId === null) return

    // A token request is shared, so one client's cancel is not the request's
    // cancel. `dropSemanticTokenWaiter` already knows how to retire one waiter
    // and only cancel when the last one leaves; the teardown path got that right
    // and this path did not, which left the very hazard that function exists to
    // prevent open on the route clients actually take — the browser cancels an
    // in-flight token request on every keystroke.
    const pending = this.pendingRequests.get(backendId)
    if (pending?.semanticTokens) {
      connection.untrackRequest(clientId as JsonRpcId)
      this.dropSemanticTokenWaiter(backendId, pending.semanticTokens, connection)
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
          uri: fileUriForPath(this.match.root),
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
        error: errorSummary(error),
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
        this.dropSemanticTokenWaiter(backendId, pending.semanticTokens, connection)
        continue
      }
      if (pending.connection !== connection) continue

      this.pendingRequests.delete(backendId)
      this.cancelBackendRequest(backendId)
    }
  }

  private dropSemanticTokenWaiter(
    backendId: JsonRpcId,
    request: SemanticTokenRequest,
    connection: LspProxyConnection,
  ): void {
    const remaining = request.waiters.filter((waiter) => waiter.connection !== connection)
    if (remaining.length === request.waiters.length) return
    if (remaining.length > 0) {
      request.waiters.splice(0, request.waiters.length, ...remaining)
      return
    }

    // Nobody is listening any more, so the backend can stop working on it — and
    // the baseline must not be updated by an answer nothing will read.
    this.pendingRequests.delete(backendId)
    this.semanticTokenInFlight.delete(request.uri)
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
        error: errorSummary(error),
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

  /**
   * Says why, then closes.
   *
   * A bare close is what made a dead backend invisible: the browser's transport
   * clears its handlers and `LspConnection` has no close callback, so the status
   * indicator stays `'ready'` over a server that exited — confident colour plus a
   * green light reads as working software. The exit is broadcast as a
   * notification first, on the socket that is about to close, because that is the
   * one channel this proxy shares with a browser that has no other way to hear it.
   */
  private closeConnections(outcome: string): void {
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
      },
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

class LspProxyConnection implements LspProxyClientSession {
  private readonly documents = new Set<string>()
  private readonly requestIds = new Map<JsonRpcId, JsonRpcId>()
  private session: PooledLspProxySession
  private readonly socket: LspProxySocket
  private closed = false

  constructor(socket: LspProxySocket, session: PooledLspProxySession) {
    this.socket = socket
    this.session = session
  }

  get isClosed(): boolean {
    return this.closed
  }

  async handleClientMessage(message: string | ArrayBuffer | Uint8Array): Promise<void> {
    if (this.closed) return

    await this.session.handleClientMessage(this, message)
  }

  dispose(): void {
    if (this.closed) return

    this.closed = true
    this.session.releaseConnection(this)
  }

  send(message: string): void {
    if (this.closed) return

    this.socket.send(message)
  }

  /** Only before `initialize` is answered: nothing is registered with the old backend yet. */
  moveTo(session: PooledLspProxySession): void {
    this.session.releaseConnection(this)
    this.session = session
    session.adopt(this)
  }

  closeSocket(): void {
    if (this.closed) return

    this.closed = true
    this.socket.close()
  }

  closeForProtocolError(): void {
    if (this.closed) return

    this.session.releaseConnection(this)
    this.closed = true
    this.socket.close()
  }

  addDocument(uri: string): void {
    this.documents.add(uri)
  }

  deleteDocument(uri: string): void {
    this.documents.delete(uri)
  }

  documentUris(): readonly string[] {
    return Array.from(this.documents)
  }

  trackRequest(clientId: JsonRpcId, backendId: JsonRpcId): void {
    this.requestIds.set(clientId, backendId)
  }

  untrackRequest(clientId: JsonRpcId): void {
    this.requestIds.delete(clientId)
  }

  backendRequestIdFor(clientId: JsonRpcId): JsonRpcId | null {
    return this.requestIds.get(clientId) ?? null
  }
}

/**
 * The value at a dotted `section`, or the whole tree when the item names none.
 *
 * `{}` rather than `null` for a section the registry says nothing about: LSP
 * lets a client answer either, and a server that reads a field off the result
 * without checking is common enough that the shape a bare `[{}]` already gave it
 * is the safer of the two.
 */
/**
 * Reads a `semanticTokensProvider` out of an `initialize` result.
 *
 * `full` may be `true` or `{ delta }`, and only the object form's `delta` counts:
 * gopls returns a `resultId` on every response and then rejects `full/delta`
 * outright, so a `resultId` in a response says nothing about delta support and
 * `full.delta === true` is the only thing that does.
 */
function negotiatedSemanticTokens(result: unknown): LspNegotiatedSemanticTokens | null {
  if (!isRecord(result)) return null
  if (!isRecord(result.capabilities)) return null

  const provider = result.capabilities.semanticTokensProvider
  if (!isRecord(provider)) return null

  const full = provider.full
  const legend = isRecord(provider.legend) ? provider.legend : {}
  return {
    delta: isRecord(full) && full.delta === true,
    full: full === true || isRecord(full),
    legend: {
      tokenModifiers: stringArray(legend.tokenModifiers),
      tokenTypes: stringArray(legend.tokenTypes),
    },
    range: provider.range === true || isRecord(provider.range),
  }
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function configurationSection(configuration: Readonly<Record<string, unknown>>, section: unknown) {
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

type WorkspaceEditTranslation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false }

function workspaceEditResponseMethod(method: string): boolean {
  if (method === 'textDocument/rename') return true
  if (method === 'textDocument/codeAction') return true

  return method === 'codeAction/resolve'
}

function translateWorkspaceEditResponse(
  method: string,
  result: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (method === 'textDocument/rename') {
    return translateWorkspaceEdit(result, provenance, documents)
  }
  if (method === 'textDocument/codeAction') {
    return translateCodeActionList(result, provenance, documents)
  }
  if (method === 'codeAction/resolve') {
    return translateCodeAction(result, provenance, documents)
  }

  return translated(result)
}

function translateCodeActionList(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!Array.isArray(value)) return translated(value)

  const actions: unknown[] = []
  for (const action of value) {
    const result = translateCodeAction(action, provenance, documents)
    if (!result.ok) return result
    actions.push(result.value)
  }
  return translated(actions)
}

function translateCodeAction(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!isRecord(value)) return translated(value)
  if (!Object.hasOwn(value, 'edit')) return translated(value)

  const edit = translateWorkspaceEdit(value.edit, provenance, documents)
  if (!edit.ok) return edit

  return translated({ ...value, edit: edit.value })
}

function translateWorkspaceEdit(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!isRecord(value)) return translated(value)
  if (value.documentChanges === undefined) return translated(value)
  if (!Array.isArray(value.documentChanges)) return translated(value)

  const documentChanges: unknown[] = []
  for (const change of value.documentChanges) {
    const result = translateDocumentChange(change, provenance, documents)
    if (!result.ok) return result
    documentChanges.push(result.value)
  }

  return translated({ ...value, documentChanges })
}

function translateDocumentChange(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!isRecord(value)) return translated(value)
  if (!isRecord(value.textDocument)) return translated(value)

  const document = value.textDocument
  if (typeof document.uri !== 'string') return translationFailure()
  if (document.version === null) return translated(value)
  if (!isSafeDocumentVersion(document.version)) return translationFailure()

  const version = translatedDocumentVersion(document.uri, document.version, provenance, documents)
  if (version === null) return translationFailure()

  return translated({
    ...value,
    textDocument: { ...document, version },
  })
}

function translatedDocumentVersion(
  uri: string,
  backendVersion: number,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): number | null {
  const captured = provenance.documents.get(uri)
  if (!captured?.owner) return null
  if (!documentProvenanceIsCurrent(uri, captured, provenance.connection, documents)) return null

  const delta = backendVersion - captured.backendVersion
  if (!Number.isSafeInteger(delta)) return null
  if (delta < 0) return null

  return safeSum(captured.owner.clientVersion, delta)
}

function documentProvenanceIsCurrent(
  uri: string,
  captured: CapturedDocumentProvenance,
  connection: LspProxyConnection,
  documents: ReadonlyMap<string, SharedDocument>,
): boolean {
  const capturedOwner = captured.owner
  if (!capturedOwner) return false
  if (!capturedOwnerIsSynchronized(capturedOwner, captured)) return false

  const current = documents.get(uri)
  const currentOwner = current?.owners.get(connection)
  if (!current || !currentOwner) return false
  if (current.backendVersion !== captured.backendVersion) return false
  if (current.syncEpoch !== captured.syncEpoch) return false
  if (current.text !== captured.text) return false

  return ownerStatesEqual(currentOwner, capturedOwner)
}

function capturedOwnerIsSynchronized(
  owner: Readonly<OwnerDocumentState>,
  document: CapturedDocumentProvenance,
): boolean {
  if (owner.text !== document.text) return false
  if (owner.lastSyncEpoch !== document.syncEpoch) return false

  return owner.synchronizedBackendVersion === document.backendVersion
}

function ownerStatesEqual(
  current: Readonly<OwnerDocumentState>,
  captured: Readonly<OwnerDocumentState>,
): boolean {
  if (current.clientVersion !== captured.clientVersion) return false
  if (current.text !== captured.text) return false
  if (current.contentEpoch !== captured.contentEpoch) return false
  if (current.lastSyncEpoch !== captured.lastSyncEpoch) return false

  return current.synchronizedBackendVersion === captured.synchronizedBackendVersion
}

function translated(value: unknown): WorkspaceEditTranslation {
  return { ok: true, value }
}

function translationFailure(): WorkspaceEditTranslation {
  return { ok: false }
}

/** LSP's own codes for "you cancelled this" and "the text moved under it". */
const REQUEST_CANCELLED_CODE = -32800
const CONTENT_MODIFIED_CODE = -32801

const SEMANTIC_TOKENS_FULL = 'textDocument/semanticTokens/full'
const SEMANTIC_TOKENS_DELTA = 'textDocument/semanticTokens/full/delta'

/**
 * Applies a `SemanticTokensDelta`'s edits to a baseline array.
 *
 * Returns `null` rather than a best effort for anything malformed. Every edit is
 * `{ start, deleteCount, data? }` over the flat uint32 array, and the spec gives
 * them in **descending** order of `start` so earlier edits do not move later
 * ones — but a server is not obliged to, so they are sorted here rather than
 * trusted. An edit whose range runs past the array is refused outright: applying
 * it would silently shift every 5-tuple after it, and a shifted tuple stream
 * decodes to plausible spans over the wrong text.
 */
/**
 * Is this error the server saying it cannot honour our `previousResultId`?
 *
 * Only a delta request can get that answer, and only that answer justifies
 * throwing the baseline away. The two codes that dominate the hot path —
 * `-32800 RequestCancelled`, which is what every keystroke produces because the
 * browser cancels its in-flight request, and `-32801 ContentModified`, the
 * ordinary answer to asking about text that has moved — are explicitly *not*
 * evidence about the baseline. Treating them as such threw away a good baseline
 * on every keystroke and counted each one against the server.
 */
function isRejectedBaselineError(request: SemanticTokenRequest, error: unknown): boolean {
  if (!request.delta) return false
  if (!isRecord(error)) return false
  if (error.code === REQUEST_CANCELLED_CODE || error.code === CONTENT_MODIFIED_CODE) return false

  return true
}

/**
 * Applies a `SemanticTokensDelta`'s edits to a baseline array.
 *
 * Returns `null` rather than a best effort for anything malformed. Every edit is
 * `{ start, deleteCount, data? }` over the flat uint32 array, and **every one of
 * those offsets indexes the array the server diffed against** — the previous
 * result — not the array as it is being rewritten. So the edits are validated
 * against the baseline's own length, checked for overlap, and then applied in
 * descending order of `start` so that each splice leaves every lower offset
 * exactly where the server computed it.
 *
 * Sorting rather than trusting the order given: the spec does not oblige a
 * server to emit them in any particular one, and applying two edits in the wrong
 * order silently shifts every 5-tuple after them into a stream that still decodes
 * — into plausible spans over the wrong text.
 */
function applySemanticTokenEdits(baseline: readonly number[], edits: readonly unknown[]) {
  const parsed: { start: number; deleteCount: number; data: number[] }[] = []
  for (const edit of edits) {
    if (!isRecord(edit)) return null
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.deleteCount)) return null

    const data = edit.data === undefined ? [] : edit.data
    if (!Array.isArray(data)) return null
    if (data.some((value) => !Number.isInteger(value) || (value as number) < 0)) return null

    const start = edit.start as number
    const deleteCount = edit.deleteCount as number
    // Against the BASELINE, before anything has been spliced. Checking the
    // running array instead would let a later edit pass because an earlier one
    // had already grown it — the bound would be measuring the wrong array.
    if (start < 0 || deleteCount < 0) return null
    if (start + deleteCount > baseline.length) return null

    parsed.push({ data: data as number[], deleteCount, start })
  }

  const ordered = parsed.toSorted((left, right) => right.start - left.start)
  for (let index = 1; index < ordered.length; index += 1) {
    const later = ordered[index - 1]
    const earlier = ordered[index]
    if (!later || !earlier) return null
    // Two edits claiming the same region describe an array that cannot be built.
    if (earlier.start + earlier.deleteCount > later.start) return null
  }

  const next = [...baseline]
  for (const edit of ordered) next.splice(edit.start, edit.deleteCount, ...edit.data)

  // A token stream is 5-tuples. Anything else means the edits did not describe
  // the array we held, and the client must not be told otherwise.
  if (next.length % 5 !== 0) return null

  return next
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

function safeSum(left: number, right: number): number | null {
  const result = left + right
  if (!Number.isSafeInteger(result)) return null
  if (result < 0) return null

  return result
}

type InitializeContract = {
  readonly value: unknown
  /** Canonical JSON: equal params in any key order share one backend. */
  readonly fingerprint: string
}

/** `processId` is the backend's own pid, so it differs between siblings and is left out. */
function initializeContractOf(params: unknown): InitializeContract {
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
function protocolValueDifference(left: unknown, right: unknown, path: string): string | null {
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
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return `${path}.${key}`
    const difference = protocolValueDifference(left[key], right[key], `${path}.${key}`)
    if (difference !== null) return difference
  }
  return null
}

function lspProxySessionKey(match: LspServerMatch): string {
  return `${match.server.id}\u0000${match.root}`
}

function normalizeClientMessage(message: string | ArrayBuffer | Uint8Array) {
  if (typeof message === 'string') return message
  if (message instanceof ArrayBuffer) return Buffer.from(message).toString('utf8')
  if (message instanceof Uint8Array) return Buffer.from(message).toString('utf8')

  return null
}

function parseJsonMessage(message: string) {
  try {
    return JSON.parse(message) as unknown
  } catch {
    return null
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value)) return false
  if (typeof value.method !== 'string') return false
  if (!('id' in value)) return false

  return isJsonRpcId(value.id)
}

function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  if (!isRecord(value)) return false
  if (typeof value.method !== 'string') return false

  return !('id' in value)
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!isRecord(value)) return false
  if (!('id' in value)) return false
  if ('method' in value) return false
  if (!('result' in value) && !('error' in value)) return false

  return isJsonRpcId(value.id)
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string' || value === null
}

function didOpenDocument(params: unknown): DidOpenDocument | null {
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

function didChangeDocument(params: unknown): DidChangeDocument | null {
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

function isSafeDocumentVersion(value: unknown): value is number {
  return isSafeNonNegativeInteger(value)
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  if (typeof value !== 'number') return false
  if (value < 0) return false

  return Number.isSafeInteger(value)
}

function textDocumentUri(params: unknown): string | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null

  return typeof params.textDocument.uri === 'string' ? params.textDocument.uri : null
}

function cancellationRequestId(params: unknown): JsonRpcId | null {
  if (!isRecord(params)) return null

  return isJsonRpcId(params.id) ? params.id : null
}

function responseForClient(response: JsonRpcResponse, id: JsonRpcId): JsonRpcResponse {
  return { ...response, id }
}

function jsonRpcResult(id: JsonRpcId, result: unknown): string {
  return JSON.stringify({
    id,
    jsonrpc: '2.0',
    result,
  })
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): string {
  return JSON.stringify({
    error: { code, message },
    id,
    jsonrpc: '2.0',
  })
}

function serverNotificationForClient(message: JsonRpcNotification, raw: string): string {
  if (message.method !== 'textDocument/publishDiagnostics') return raw
  if (!isRecord(message.params)) return raw

  const { version: _version, ...params } = message.params
  return JSON.stringify({ ...message, params })
}

function applyContentChangesStrict(
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

function byteLength(value: string | ArrayBuffer | Uint8Array): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  if (value instanceof ArrayBuffer) return value.byteLength

  return value.byteLength
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

function rewriteTextDocumentVersion(message: JsonRpcNotification, version: number) {
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

function withWatchedFilesCapability(capabilities: unknown) {
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

function capabilityChanges(params: unknown, field: 'registrations' | 'unregisterations') {
  const changes = isRecord(params) && Array.isArray(params[field]) ? params[field] : []
  return changes.flatMap((change: unknown) =>
    isRecord(change) && typeof change.id === 'string' && typeof change.method === 'string'
      ? [{ id: change.id, method: change.method, registerOptions: change.registerOptions }]
      : [],
  )
}
