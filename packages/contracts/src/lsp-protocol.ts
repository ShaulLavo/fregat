/**
 * The messages this app's LSP proxy sends a browser that LSP itself does not
 * define as client-bound, named once so the two halves cannot drift.
 *
 * Everything else on that socket is ordinary JSON-RPC forwarded between a
 * browser and a language server. These are the proxy speaking for itself,
 * and each exists because a backend is **pooled** — shared by every tab in a root
 * — so neither the server's request nor the socket's close can address one tab.
 */

/**
 * A server's `workspace/semanticTokens/refresh` **request**, re-emitted to every
 * connection as a notification: same method name, no `id`, nothing to answer.
 *
 * The proxy answers the server itself. It has to: *N* pooled clients cannot
 * answer one request id, and whichever answered first would be deciding for the
 * rest. Forwarding it instead would also need a client *response* to travel back
 * through the proxy, which is a path that exists but is unreachable today and
 * should stay that way.
 *
 * A host's handler does two things and no more: clear the layer it holds, then
 * issue one fresh non-delta request.
 */
export const LSP_SEMANTIC_TOKENS_REFRESH = 'workspace/semanticTokens/refresh'

/** The pooled equivalent of `workspace/semanticTokens/refresh` for pull diagnostics. */
export const LSP_DIAGNOSTIC_REFRESH = 'workspace/diagnostic/refresh'

/**
 * Why the socket is about to close.
 *
 * Broadcast immediately before the proxy closes a client socket, because a bare
 * close is indistinguishable from a healthy idle one: the browser transport
 * clears its handlers and reports nothing, so a language server that died left
 * the status indicator saying `'ready'`. `$/`-prefixed because it is
 * implementation-defined, which the protocol permits and requires a client to
 * tolerate.
 *
 * The same method `@singapore-editor/lsp` names, so the editor's connection
 * reports the close that follows as an `LspServerExitedError` carrying these params.
 */
export const LSP_SERVER_EXITED = '$/serverExited'

export const LSP_FEATURE_IDS = [
  'completion',
  'hover',
  'navigation',
  'signatureHelp',
  'diagnostics',
  'codeActions',
  'formatting',
  'rename',
  'documentHighlights',
  'semanticTokens',
] as const

export type LspFeatureId = (typeof LSP_FEATURE_IDS)[number]

export type LspFeatureRanks = Partial<Readonly<Record<LspFeatureId, number>>>

export type LspMatch = {
  readonly root: string
  readonly serverId: string
  readonly features: LspFeatureRanks
}

/**
 * What a pooled backend actually agreed to, read out of the `initializeResult`
 * the proxy caches and replays.
 *
 * Reported so a developer can find out why a language is uncoloured without
 * attaching a debugger. Every per-server fact this app relies on — whether
 * `range` is answered at all, whether `full.delta` is real, how many names the
 * legend carries — changes when a server updates, and the only defence is that
 * the negotiated result is visible.
 */
export type LspNegotiatedSemanticTokens = {
  readonly full: boolean
  readonly range: boolean
  /** True only when the provider says so. A `resultId` in a response means nothing. */
  readonly delta: boolean
  readonly legend: {
    readonly tokenTypes: readonly string[]
    readonly tokenModifiers: readonly string[]
  }
}

export type LspServerExitedParams = {
  /** Which spawn died. Matches `LspServerDefinition.id`. */
  readonly serverId: string
  /** The proxy's own word for what happened: `process_exit`, `spawn_failed`, … */
  readonly outcome: string
  readonly exitCode: number | null
  readonly exitSignal: string | null
  /** The tail of the child's stderr, when it wrote any. Absent, never empty. */
  readonly stderrTail?: string
  /** The catalog's guidance for a backend that died; absent when this app closed it. */
  readonly error?: {
    readonly code?: string
    readonly message: string
    readonly why?: string
    readonly fix?: string
  }
}
