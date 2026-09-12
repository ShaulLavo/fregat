import type {
  LanguageServerConnectionContext,
  LanguageServerSemanticTokensDocument,
} from '@singapor/lsp-plugin'
import { decodeSemanticTokens } from '@singapor/lsp-plugin'
import type {
  SemanticTokenDropReason,
  SemanticTokenLayer,
  SemanticTokenRangeRequest,
} from '@singapor/core/extensions'
import type { LspClient, LspDocument, lsp } from '@singapor/lsp'
import { LspRequestCancelledError, offsetToLspPositionInSnapshot } from '@singapor/lsp'

import { log } from '@/lib/client-logging'
import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'
import {
  semanticTokenProfileFor,
  type SemanticTokenServerProfile,
} from '@/features/editor/utils/semantic-token-servers'

/**
 * Trailing debounce for a demand caused by an edit.
 *
 * The editor adds none of its own — `viewportDelayMs` is set to `0` explicitly
 * where the layer is created — so this and the two numbers below are the whole
 * policy on the path. If a future reader finds two delays on one signal, that is
 * the defect.
 */
const CONTENT_DEBOUNCE_MS = 250

/**
 * Trailing debounce for a demand caused by scrolling.
 *
 * `'viewport'` fires once per scroll event and is not throttled at source, so a
 * flung scroll would otherwise be one question per frame to a real child
 * process. 100 ms bounds it at ten requests a second; at the measured warm range
 * cost — 2 ms for rust-analyzer, under 1 ms for gopls — that is a fraction of one
 * core and a ~3 KB payload rather than ~78 KB. It is a rate limit on request
 * *count*, which is why it does not move with file size.
 */
const VIEWPORT_DEBOUNCE_MS = 100

/**
 * Lines of slack above and below the visible range.
 *
 * Without it a one-line scroll is a new question. With it a small scroll lands
 * inside the range already asked for and the demand's own signature check drops
 * it before this file sees it.
 */
const VIEWPORT_PADDING_LINES = 40

/**
 * A cold server's first answer is bounded by indexing, not by token computation:
 * rust-analyzer took 734 ms against a one-file crate and a real workspace is
 * bounded by cargo metadata; jdtls blocks on `waitForJobs` and is worse. The
 * editor's 3 000 ms default is a timeout on a healthy server.
 */
const FIRST_REQUEST_TIMEOUT_MS = 30_000

/**
 * A warm answer is 20–50 ms. Past five seconds the server is wedged, and the
 * right response is to stop asking rather than to keep waiting.
 */
const STEADY_REQUEST_TIMEOUT_MS = 5_000

/** Two in a row means the server is not coming back; stale colour is worse than none. */
const TIMEOUTS_BEFORE_CLEARING = 2

/**
 * How many times a resync may be answered before something has painted.
 *
 * The editor fires `onResyncRequired` on every dropped push and this side answers
 * at delay zero, so a drop a fresh request cannot fix is otherwise an unbounded
 * loop against a real child process.
 */
const MAX_RESYNCS_WITHOUT_PAINT = 2

type SemanticTokensProvider = {
  readonly full: boolean
  readonly range: boolean
}

type PendingLayer = {
  readonly layer: SemanticTokenLayer
  readonly documentId: string
  readonly uri: lsp.DocumentUri
  timer: ReturnType<typeof setTimeout> | null
  abort: AbortController | null
  requestId: number
  lastTextVersion: number | null
  /** The last range the editor asked about. Only read by a server with no `full`. */
  lastDemand: SemanticTokenRangeRequest | null
  consecutiveTimeouts: number
  /**
   * Resyncs since the last payload that actually painted.
   *
   * The editor raises `onResyncRequired` on *every* dropped push, and this side
   * answers immediately and uncapped, so a payload that keeps being dropped for
   * a reason a fresh request cannot fix is a request loop against a real child
   * process. Two in a row without a paint in between means asking again is not
   * the answer.
   */
  resyncsSincePaint: number
  loggedOversizeDocument: boolean
  answered: boolean
  /** Reported outcomes, keyed with the span. A scroll fires per frame; one line per span is the budget. */
  readonly loggedOutcomes: Set<string>
}

/** Why one demand did or did not become a request. Each was a silent `return` before. */
type SemanticTokenRequestOutcome =
  | 'answered'
  | 'disabled'
  | 'no_client'
  | 'no_document'
  | 'no_legend'
  | 'no_method'
  | 'no_text_version'

export type SemanticTokenControllerOptions = {
  readonly serverId: string
}

/**
 * Turns the editor's demand signal into a token request, a decode and a push.
 *
 * The request side is host code by construction rather than by choice: the
 * editor ships one artifact for this seam — the decoder — and states that it
 * ships no controller, because every decision made here is this repo's data.
 * Which method to call is a per-server fact, the size cap is a per-server bug,
 * the aliases are a per-server vocabulary and the three delays above were costed
 * against this transport. None of that could live in an editor library.
 *
 * Shaped after the editor's own `documentHighlightController`: an options bag, a
 * debounce cancelled on every new input, a capability gate, a per-request
 * `AbortController`, and a staleness check with three independent parts. Its
 * update-kind filter is deliberately *not* copied — that one is a question about
 * the caret, and this one is a question about the viewport.
 */
export class SemanticTokenController {
  #client: LspClient | null = null
  #pending: PendingLayer | null = null
  #disposed = false
  /** Names this server sent that nothing in the theme claims, reported once each. */
  readonly #reportedUnresolved = new Set<string>()
  readonly #profile: SemanticTokenServerProfile

  public constructor(private readonly options: SemanticTokenControllerOptions) {
    this.#profile = semanticTokenProfileFor(options.serverId)
  }

  /** Host data the layer resolves token names against. Fixed per server. */
  public get scopeAliases(): Readonly<Record<string, string>> {
    return this.#profile.scopeAliases
  }

  public attachConnection(context: LanguageServerConnectionContext): void {
    this.#client = context.client
  }

  /**
   * `initialize` has come back, so there is a legend to decode against.
   *
   * Without this the first demand is simply lost. It fires as soon as the view
   * has a viewport — well before a websocket has connected, let alone been
   * answered — and `#request` drops it because there are no server capabilities
   * yet. The layer then will not re-ask: its demand signal is deduplicated on
   * `documentId:textVersion:start:end`, so an unchanged file in an unmoved
   * viewport never produces that question a second time, and the document stays
   * uncoloured until the user scrolls or types.
   */
  public handleConnected(): void {
    const pending = this.#pending
    if (!pending || this.#disposed) return
    if (pending.answered) return

    this.#schedule(pending, pending.lastDemand, 0)
  }

  public detachConnection(): void {
    this.#client = null
    this.#dropLayer()
  }

  /**
   * Takes ownership of a layer for one document.
   *
   * A layer never spans two documents or two language ids: the contribution
   * disposes the one held here and delivers a fresh one carrying the new
   * identity. So this drops the old handle rather than clearing it — `clear()`
   * on a disposed layer is a call on a dead object, not a safeguard — and
   * re-derives everything hanging off the document with it.
   */
  public attachLayer(
    layer: SemanticTokenLayer,
    document: LanguageServerSemanticTokensDocument,
    uri: lsp.DocumentUri | null,
  ) {
    this.#dropLayer()
    if (this.#disposed || uri === null) return

    this.#pending = {
      abort: null,
      answered: false,
      consecutiveTimeouts: 0,
      documentId: document.documentId,
      resyncsSincePaint: 0,
      lastDemand: null,
      layer,
      lastTextVersion: null,
      loggedOutcomes: new Set(),
      loggedOversizeDocument: false,
      requestId: 0,
      uri,
      timer: null,
    }
  }

  /**
   * The editor asking for a range it is about to show.
   *
   * Every trigger arrives here — an edit, a scroll, a fresh document — because
   * the layer fires this signal whenever the visible range or the text inside it
   * moves, and drops it when neither has. Which of the three it was is derived
   * rather than announced: a changed `textVersion` is an edit, an unchanged one
   * with a moved range is a scroll, and no previous request at all is a document
   * that just arrived.
   */
  public handleRangeNeeded(request: SemanticTokenRangeRequest): void {
    const pending = this.#pendingFor(request.documentId)
    if (!pending) return

    const edited = pending.lastTextVersion !== request.textVersion
    const first = pending.lastTextVersion === null
    pending.lastTextVersion = request.textVersion
    pending.lastDemand = request

    // A server with no `range` has already answered every viewport with its
    // whole-file reply, so a scroll needs no new request at all. Treating a
    // scroll as a trigger here would turn one 78 KB payload into a 78 KB payload
    // per scroll event, which is the worst thing this file could do.
    if (!edited && !this.#supportsRange()) return

    this.#schedule(pending, request, this.#delayFor({ edited, first }))
  }

  /**
   * The editor saying its own text moved too far ahead of what was pushed.
   *
   * Immediate and whole-file: the payload that was dropped described a version
   * the edit chain can no longer reach, so there is nothing to ask about a range
   * of it. Nothing retries on a dropped push — this signal is the retry.
   */
  public handleResyncRequired(reason: SemanticTokenDropReason): void {
    const pending = this.#pending
    if (!pending) return

    pending.resyncsSincePaint += 1
    if (pending.resyncsSincePaint > MAX_RESYNCS_WITHOUT_PAINT) {
      // Stop rather than keep asking. The next ordinary demand — a keystroke, a
      // scroll — re-enters through `handleRangeNeeded` and resets the counter on
      // its first successful paint, so this bounds the loop without ending the
      // feature for the document.
      log.warn({
        action: 'lsp.semanticTokens.resync_abandoned',
        area: 'lsp',
        reason,
        resyncs: pending.resyncsSincePaint,
        serverId: this.options.serverId,
      })
      return
    }

    log.debug({
      action: 'lsp.semanticTokens.resync',
      area: 'lsp',
      reason,
      serverId: this.options.serverId,
    })
    this.#schedule(pending, null, 0)
  }

  /**
   * The server saying every token it ever sent is stale.
   *
   * Reaches the browser as a notification because a pooled backend cannot ask
   * one tab a question. Two steps and no more: empty the layer, then ask once.
   */
  public handleRefresh(): void {
    const pending = this.#pending
    if (!pending) return

    pending.layer.clear()
    this.#schedule(pending, null, CONTENT_DEBOUNCE_MS)
  }

  public dispose(): void {
    if (this.#disposed) return

    this.#disposed = true
    this.#client = null
    this.#dropLayer()
  }

  #delayFor({ edited, first }: { edited: boolean; first: boolean }): number {
    if (first) return 0
    if (edited) return CONTENT_DEBOUNCE_MS

    return VIEWPORT_DEBOUNCE_MS
  }

  #pendingFor(documentId: string): PendingLayer | null {
    const pending = this.#pending
    if (!pending) return null
    if (pending.documentId !== documentId) return null

    return pending
  }

  #schedule(pending: PendingLayer, request: SemanticTokenRangeRequest | null, delayMs: number) {
    this.#cancelInFlight(pending)
    if (!this.#enabled()) {
      this.#reportOutcome(pending, 'disabled')
      return
    }

    if (delayMs <= 0) {
      void this.#request(pending, request)
      return
    }

    /**
     * @justification Coalesces questions to a real child process against the
     * user's typing and scrolling rather than against rendering. `cancel()` on
     * every new demand is what turns a flung scroll into one question per pause;
     * the numbers are this file's and there is no second delay under them.
     */
    pending.timer = setTimeout(() => {
      pending.timer = null
      void this.#request(pending, request)
    }, delayMs)
  }

  #cancelInFlight(pending: PendingLayer) {
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = null
    // A real `$/cancelRequest`, remapped by the proxy and honoured by a server
    // that abandons work in its own process.
    pending.abort?.abort()
    pending.abort = null
  }

  #dropLayer() {
    const pending = this.#pending
    if (!pending) return

    this.#cancelInFlight(pending)
    this.#pending = null
  }

  /**
   * Read on every request rather than captured once, so the switch takes effect
   * without reconnecting a socket. A per-server entry outranks the master
   * switch's own default but not the master switch being off.
   */
  #enabled(): boolean {
    const settings = readSettingsMirror()
    if (!settings['lsp.semanticTokens.enabled']) return false

    return (
      settings['lsp.semanticTokens.servers'][this.options.serverId] ??
      this.#profile.enabledByDefault
    )
  }

  #provider(): SemanticTokensProvider | null {
    const provider = this.#client?.serverCapabilities?.semanticTokensProvider
    if (!provider) return null

    const full = (provider as { full?: unknown }).full
    const range = (provider as { range?: unknown }).range
    // `true` or an options object in both cases, per the protocol — and `null` is
    // neither, which the looser `!== undefined && !== false` reading called
    // supported. Written the same way the proxy's own reader writes it
    // (`negotiatedSemanticTokens`), because two spellings of one predicate is how
    // the two sides end up disagreeing about what a server offered.
    return {
      full: full === true || isProviderObject(full),
      range: range === true || isProviderObject(range),
    }
  }

  #supportsRange(): boolean {
    return this.#provider()?.range === true
  }

  #legend(): lsp.SemanticTokensLegend | null {
    const provider = this.#client?.serverCapabilities?.semanticTokensProvider
    const legend = (provider as { legend?: lsp.SemanticTokensLegend } | undefined)?.legend
    if (!legend || !Array.isArray(legend.tokenTypes)) return null

    return legend
  }

  async #request(pending: PendingLayer, demand: SemanticTokenRangeRequest | null): Promise<void> {
    const client = this.#client
    if (!client) {
      this.#reportOutcome(pending, 'no_client')
      return
    }

    const legend = this.#legend()
    if (!legend) {
      this.#reportOutcome(pending, 'no_legend')
      return
    }

    // No document means the plugin's own sync has not opened this uri yet, which
    // is reachable: the layer and the document sync are two contributions
    // updating on the same tick with no ordering between them. Asking anyway
    // would decode the answer against an empty snapshot, drop every tuple past
    // the end of a zero-length document, and push an empty span set — which
    // reads as "this file has no symbols" and blanks whatever was painted.
    const document = client.workspace.getDocument(pending.uri)
    if (!document) {
      this.#reportOutcome(pending, 'no_document')
      return
    }

    /**
     * The **editor's** version, never `LspDocument.version`.
     *
     * They are two counters that can never agree: the workspace's starts at 0
     * when document sync first opens the uri, by which time the editor has
     * already recorded its own first transition, and the proxy rewrites the LSP
     * one in flight anyway. Stamping the workspace's would make `push` compare a
     * number the editor has never issued — which is `dropped('version-too-old')`
     * on the first push, `onResyncRequired`, an immediate re-request carrying the
     * same wrong number, and a loop that asks a real child process forever while
     * the file stays uncoloured.
     *
     * A resync or a refresh carries no demand of its own, so it reuses the last
     * version the editor asked about. Null means the editor has not asked yet,
     * and there is no version to answer about — the layer fires a demand as soon
     * as anything moves, and that one carries a real number.
     */
    const textVersion = demand?.textVersion ?? pending.lastTextVersion
    if (textVersion === null) {
      this.#reportOutcome(pending, 'no_text_version')
      return
    }

    const method = this.#methodFor(pending, demand, document)
    if (!method) {
      this.#reportOutcome(pending, 'no_method')
      return
    }

    const abort = new AbortController()
    const requestId = pending.requestId + 1
    pending.requestId = requestId
    pending.abort = abort
    // Captured before the request goes out, not read back after it returns: the
    // tuples describe the text as it was asked about, and the layer's own
    // projection is what carries them onto text that has moved since.
    const snapshot = documentSnapshot(document, textVersion)
    const startedAt = performance.now()

    try {
      const response = await client.request<lsp.SemanticTokens | null>(
        method.method,
        method.params,
        {
          signal: abort.signal,
          timeoutMs: pending.answered ? STEADY_REQUEST_TIMEOUT_MS : FIRST_REQUEST_TIMEOUT_MS,
        },
      )
      if (this.#stale(pending, requestId)) return

      // Before `answered` flips, so the duration reported is the cold first answer.
      this.#reportOutcome(pending, 'answered', {
        durationMs: Math.round(performance.now() - startedAt),
        method: method.method,
        tupleCount: Math.floor((response?.data?.length ?? 0) / 5),
        ...requestedSpan(method.params, document),
      })
      pending.answered = true
      pending.consecutiveTimeouts = 0
      this.#paint(pending, response, legend, snapshot)
    } catch (error) {
      if (this.#stale(pending, requestId)) return

      this.#handleRequestError(pending, error)
    }
  }

  /**
   * Which request to send, or `null` for "do not ask".
   *
   * Range wherever the server offers one: a viewport-sized answer measured
   * 3 337 bytes against 78 669 for the whole file, and arrived in single-digit
   * milliseconds. That is prior to any argument about deltas.
   *
   * A resync arrives with no demand and asks for the whole document, because the
   * version it was holding is unreachable and a range of it means nothing. The
   * one exception is a server offering no `full` at all: there the last range the
   * editor asked about is the only question that can be put, and asking it beats
   * painting nothing forever.
   */
  #methodFor(
    pending: PendingLayer,
    demand: SemanticTokenRangeRequest | null,
    document: LspDocument,
  ): { method: string; params: unknown } | null {
    const provider = this.#provider()
    if (!provider) return null

    const textDocument = { uri: pending.uri }
    // Decided before the method is chosen, not after: a `full` this server would
    // refuse is not an option, so a demand-less trigger on an oversized file has
    // to fall back to the last range rather than to nothing. Refresh on a large
    // Go file is exactly that case — it clears the layer first, so returning
    // nothing here would leave the file blank until the user scrolled.
    const fullAllowed = provider.full && !this.#refusesFullRequest(pending, document)
    const wanted = demand ?? (fullAllowed ? null : pending.lastDemand)
    if (wanted && provider.range) {
      return {
        method: 'textDocument/semanticTokens/range',
        params: { range: paddedRange(document, wanted), textDocument },
      }
    }
    if (!fullAllowed) return null

    return { method: 'textDocument/semanticTokens/full', params: { textDocument } }
  }

  #refusesFullRequest(pending: PendingLayer, document: LspDocument): boolean {
    const cap = this.#profile.maxFullRequestBytes
    if (cap === null) return false

    const length = document.textSnapshot.length
    // The cap is a byte count — gopls compares the file's size on disk — and
    // `length` is UTF-16 code units, which is fewer for every non-ASCII
    // character. Comparing the two directly would let a file of accented text or
    // CJK past a limit the server then enforces itself, with an error the user
    // must never see. The exact byte count is only paid for once the code-unit
    // count is close enough to matter: UTF-8 is at most three bytes per UTF-16
    // unit, so anything under a third of the cap cannot reach it.
    if (length <= cap / 3) return false
    if (utf8Length(document.textSnapshot.materializeFullText()) <= cap) return false

    // Logged once per document rather than per request: above the cap every
    // request would say the same thing, and the user's only symptom is that
    // whatever is off-screen stays uncoloured until they scroll to it.
    if (!pending.loggedOversizeDocument) {
      pending.loggedOversizeDocument = true
      log.warn({
        action: 'lsp.semanticTokens.full_refused',
        area: 'lsp',
        length,
        maxFullRequestBytes: cap,
        outcome: 'document_too_large',
        serverId: this.options.serverId,
      })
    }

    return true
  }

  /** The absence of colour has seven causes here and they look identical; this says which. */
  #reportOutcome(
    pending: PendingLayer,
    outcome: SemanticTokenRequestOutcome,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    // Keyed on the span too: deduping on the outcome alone hides every request after the first.
    const key = `${outcome}:${fields?.requestedFromLine ?? '-'}:${fields?.requestedLines ?? '-'}`
    if (pending.loggedOutcomes.has(key)) return

    pending.loggedOutcomes.add(key)
    log.debug({
      action: 'lsp.semanticTokens.request',
      area: 'lsp',
      documentId: pending.documentId,
      outcome,
      serverId: this.options.serverId,
      ...fields,
    })
  }

  #stale(pending: PendingLayer, requestId: number): boolean {
    if (this.#disposed) return true
    if (pending !== this.#pending) return true

    return pending.requestId !== requestId
  }

  #paint(
    pending: PendingLayer,
    response: lsp.SemanticTokens | null,
    legend: lsp.SemanticTokensLegend,
    snapshot: { lineStarts: readonly number[]; textLength: number; textVersion: number },
  ): void {
    if (!response || !Array.isArray(response.data)) return

    const decoded = decodeSemanticTokens(response.data, legend, snapshot)
    this.#reportDrops(decoded.drops, response.data.length)

    const verdict = pending.layer.push({
      documentId: pending.documentId,
      spans: decoded.spans,
      textVersion: snapshot.textVersion,
    })
    // No retry here on purpose. A dropped payload means the text moved past what
    // was asked about; the editor raises `onResyncRequired` when it wants
    // another, and a loop that re-asked on every drop would race the typing that
    // caused it.
    if (verdict.status === 'dropped') {
      log.debug({
        action: 'lsp.semanticTokens.dropped',
        area: 'lsp',
        reason: verdict.reason,
        serverId: this.options.serverId,
      })
      return
    }

    pending.resyncsSincePaint = 0
    this.#reportUnresolved(verdict.unresolvedTypeNames, decoded.spans.length, verdict.paintedSpans)
  }

  /**
   * A tuple the decoder refused is a fact about a *server* — an index outside
   * the legend that same server advertised — and this is the only side that
   * knows which server produced it.
   */
  #reportDrops(drops: ReturnType<typeof decodeSemanticTokens>['drops'], dataLength: number): void {
    const total =
      drops.malformedTuple + drops.outOfLegendType + drops.pastEndOfDocument + drops.zeroLength
    if (total === 0) return

    log.warn({
      action: 'lsp.semanticTokens.decode_drops',
      area: 'lsp',
      malformedTuple: drops.malformedTuple,
      outOfLegendType: drops.outOfLegendType,
      pastEndOfDocument: drops.pastEndOfDocument,
      serverId: this.options.serverId,
      tupleCount: Math.floor(dataLength / 5),
      unknownModifierBits: drops.unknownModifierBits,
      zeroLength: drops.zeroLength,
    })
  }

  /**
   * The one signal either side has that a server's custom legend is falling on
   * the floor. A span that resolves to nothing simply shows the syntactic colour
   * underneath, so by eye it is indistinguishable from success — which is how a
   * fifty-seven-name legend paints nineteen names and looks fine.
   *
   * A name this table deliberately leaves uncovered is not reported: it is an
   * answer, not a gap.
   */
  #reportUnresolved(names: readonly string[], decoded: number, painted: number): void {
    const unexpected = names.filter(
      (name) => !(name in this.#profile.uncovered) && !this.#reportedUnresolved.has(name),
    )
    if (unexpected.length === 0) return

    for (const name of unexpected) this.#reportedUnresolved.add(name)
    log.warn({
      action: 'lsp.semanticTokens.unresolved_types',
      area: 'lsp',
      decodedSpans: decoded,
      paintedSpans: painted,
      serverId: this.options.serverId,
      tokenTypes: unexpected,
    })
  }

  #handleRequestError(pending: PendingLayer, error: unknown): void {
    // The normal path while typing, not a failure.
    if (error instanceof LspRequestCancelledError) return

    if (!isTimeout(error)) {
      log.warn({
        action: 'lsp.semanticTokens.request_failed',
        area: 'lsp',
        error: String(error),
        serverId: this.options.serverId,
      })
      return
    }

    pending.consecutiveTimeouts += 1
    if (pending.consecutiveTimeouts < TIMEOUTS_BEFORE_CLEARING) return

    // Previous spans survive one timeout — they are anchored and still describe
    // the text. Two says the server is wedged, and confident colour from a
    // server that stopped answering is worse than none.
    pending.layer.clear()
    log.warn({
      action: 'lsp.semanticTokens.cleared_after_timeouts',
      area: 'lsp',
      serverId: this.options.serverId,
      timeouts: pending.consecutiveTimeouts,
    })
  }
}

/**
 * The offsets and line starts the answer will be decoded against.
 *
 * Taken from the workspace document rather than from a live editor snapshot
 * because that is the text the server was told about, and taken *now* rather
 * than when the response lands because the response describes this version of
 * it. `LspWorkspace` hands out a clone per call, so the arrays below stay pinned
 * to it while the document underneath moves on.
 */
function documentSnapshot(document: LspDocument, textVersion: number) {
  return {
    lineStarts: document.lineStarts.toArray(),
    textLength: document.textSnapshot.length,
    textVersion,
  }
}

/** Lines rather than offsets: the question is "did this cover the screen", and a screen is lines. */
function requestedSpan(params: unknown, document: LspDocument): Record<string, number> {
  const documentLines = Math.max(document.lineStarts.length, 1)
  const range = (params as { range?: lsp.Range } | undefined)?.range
  if (!range) return { documentLines, requestedLines: documentLines }

  return {
    documentLines,
    requestedFromLine: range.start.line,
    requestedLines: Math.max(range.end.line - range.start.line + 1, 0),
  }
}

function paddedRange(document: LspDocument, demand: SemanticTokenRangeRequest): lsp.Range {
  const lineStarts = document.lineStarts
  const lastLine = Math.max(lineStarts.length - 1, 0)
  const firstVisible = lineStarts.indexForOffset(demand.start)
  const lastVisible = lineStarts.indexForOffset(Math.max(demand.end - 1, demand.start))
  const start = lineStarts.at(Math.max(firstVisible - VIEWPORT_PADDING_LINES, 0)) ?? 0
  // Clamping the *line* and then taking its start would stop the range at the
  // beginning of the last line, leaving that line uncoloured for every viewport
  // within a padding window of the end of the file. Past the last line the answer
  // is the end of the text, not the start of a line.
  const endLine = lastVisible + VIEWPORT_PADDING_LINES + 1
  const end =
    endLine > lastLine
      ? document.textSnapshot.length
      : (lineStarts.at(endLine) ?? document.textSnapshot.length)

  // The snapshot overload, not the string one: `materializeFullText()` would
  // build the whole document twice per request on a path that already has the
  // line starts it needs.
  return {
    end: offsetToLspPositionInSnapshot(document, end),
    start: offsetToLspPositionInSnapshot(document, start),
  }
}

/** What the file weighs on the wire, which is the unit every server's size limit is in. */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/** The protocol spells an offered sub-capability as `true` or as an options object. */
function isProviderObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

/** The editor's client rejects a timed-out request with a plain `Error`. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('LSP request timed out')
}
