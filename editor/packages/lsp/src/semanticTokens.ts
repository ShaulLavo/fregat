import type * as lsp from 'vscode-languageserver-protocol'

/**
 * The token types LSP itself defines, in the order the specification lists them.
 *
 * Exported so a host can declare the standard set plus whatever its own servers add, rather than
 * retyping twenty-three strings. The list is a *vocabulary*, not a legend: a legend is per-server,
 * index-addressed, and arrives in that server's `initializeResult`. Nothing in this package ever
 * holds one.
 */
export const SEMANTIC_TOKEN_TYPES: readonly string[] = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator',
]

/** The token modifiers LSP itself defines, in specification order. See SEMANTIC_TOKEN_TYPES. */
export const SEMANTIC_TOKEN_MODIFIERS: readonly string[] = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
]

/** The protocol's own `TokenFormat`, which its package does not re-export from its entry point. */
export type SemanticTokenFormat = lsp.SemanticTokensClientCapabilities['formats'][number]

export type SemanticTokensRequestOptions = {
  /** `true` for whole-document requests; `{ delta: true }` to also accept `SemanticTokensDelta`. */
  readonly full?: boolean | { readonly delta?: boolean }
  readonly range?: boolean
}

export type SemanticTokensClientCapabilityOptions = {
  readonly requests: SemanticTokensRequestOptions
  /** Defaults to SEMANTIC_TOKEN_TYPES. */
  readonly tokenTypes?: readonly string[]
  /** Defaults to SEMANTIC_TOKEN_MODIFIERS. */
  readonly tokenModifiers?: readonly string[]
  /** Defaults to `['relative']`, which is the only format the protocol defines. */
  readonly formats?: readonly SemanticTokenFormat[]
  /**
   * Whether the client uses semantic tokens *alongside* the colour it already has rather than
   * instead of it. Deliberately the host's answer and per server, because whether this editor
   * already has syntactic colour for a file depends on which grammar the host registered for that
   * language id — which the host knows and this package does not.
   */
  readonly augmentsSyntaxTokens?: boolean
  /**
   * Whether the client accepts a token whose span crosses a newline.
   *
   * Declarable since the paint layer was proved to render one across two mounted rows. It stays
   * opt-in rather than default-on because it is a statement about the *host's* pipeline as much as
   * the editor's: a host that re-derives spans from `{line, character}` pairs of its own may not be
   * able to honour it even though the layer can.
   */
  readonly multilineTokenSupport?: boolean
}

type Writable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * Builds a `textDocument.semanticTokens` block that declares exactly what this editor honours.
 *
 * There is no such block in `defaultClientCapabilities()` and there will not be: a client that
 * declares semantic tokens makes every server it speaks to compute them, and a host that paints no
 * tokens would be paying for answers nobody draws. So the block is opt-in, and it is built here
 * rather than hand-written by each host because three of its flags are ones a client must not claim
 * unless it can actually honour them — and a server acts on all three.
 *
 * **`overlappingTokenSupport` is not an option.** Where two spans overlap this editor truncates the
 * earlier one; it does not paint both. Declaring the flag would invite a server to send overlapping
 * tokens on the understanding that they would be layered, and they would not be.
 *
 * **`dynamicRegistration` is not an option.** Several servers answer `initialize` with *no*
 * semantic-tokens provider at all when a client declares it, expecting to register later through
 * `client/registerCapability` — a request `LspClient` answers with method-not-found and always
 * will. Declaring it would turn a working server into a silent one.
 *
 * **`multilineTokenSupport` is declarable but not assumed.** It was refused until the paint layer
 * was proved to render a span crossing a newline across two mounted rows; that gate is now open, so
 * the flag is an ordinary option. It is still opt-in, because it is a statement about the host's
 * pipeline as well as the editor's.
 *
 * Everything the block *does* say — which requests, which token types, which modifiers — is the
 * caller's to choose, because at least one real server computes its advertised legend as the
 * intersection of its own token types with the ones the client declared. That makes the declared
 * block an input to the server rather than a local decoding table, and therefore a property of a
 * connection, which is host-owned.
 */
export function semanticTokensClientCapability(
  options: SemanticTokensClientCapabilityOptions,
): lsp.ClientCapabilities {
  const requests: Writable<lsp.SemanticTokensClientCapabilities['requests']> = {}
  if (options.requests.full !== undefined) {
    requests.full =
      typeof options.requests.full === 'boolean'
        ? options.requests.full
        : { delta: options.requests.full.delta === true }
  }
  if (options.requests.range !== undefined) requests.range = options.requests.range

  const semanticTokens: Writable<lsp.SemanticTokensClientCapabilities> = {
    formats: [...(options.formats ?? ['relative'])],
    requests,
    tokenModifiers: [...(options.tokenModifiers ?? SEMANTIC_TOKEN_MODIFIERS)],
    tokenTypes: [...(options.tokenTypes ?? SEMANTIC_TOKEN_TYPES)],
  }
  // Absent, never `false`. An undeclared capability is what the wire means by "no", and a key
  // present with `false` is a different statement that some servers branch on separately.
  if (options.augmentsSyntaxTokens !== undefined) {
    semanticTokens.augmentsSyntaxTokens = options.augmentsSyntaxTokens
  }
  if (options.multilineTokenSupport !== undefined) {
    semanticTokens.multilineTokenSupport = options.multilineTokenSupport
  }

  return { textDocument: { semanticTokens } }
}
