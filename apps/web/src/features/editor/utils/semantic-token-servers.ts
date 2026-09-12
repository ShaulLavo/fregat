/**
 * What each language server's semantic tokens are worth, per server id.
 *
 * Data with a citation per row, and it lives here rather than in the editor
 * package on purpose: a table of one vendor's spelling choices and one vendor's
 * bugs is not something an editor library can carry — there are thirty-seven
 * servers behind this app, their legends are theirs, and a table shipped inside
 * the editor would be stale the week it landed.
 *
 * **Every row below was probed against the real binary** on this machine
 * (aarch64 macOS, 2026-08-21) by driving stdio with `Content-Length` framing and
 * the capability block `semanticTokensCapabilityForServer` builds. Nothing here
 * is a published legend copied out of a README. Re-probe rather than trust any of
 * it after a server upgrade — every fact below is a snapshot of one version, and
 * `semantic-token-conformance.test.ts` is what re-checks them (it spawns each
 * binary and skips only when one is absent).
 */

/**
 * Names this app deliberately paints nothing for, and why.
 *
 * Not an oversight and not a TODO: an unresolved name falls through to the
 * syntactic colour underneath, which is the right answer for every name here.
 * The list is explicit because the alternative — a name quietly resolving to
 * nothing — is indistinguishable by eye from a name that painted, and is how a
 * legend ends up two thirds on the floor while everything looks fine.
 */
type SemanticTokenUncoveredReason =
  /**
   * The grammar already paints this identically. A comma is a comma to
   * tree-sitter and to shiki; the server knows nothing about it that they do
   * not, so an alias would cost a span and a repaint per token to reproduce the
   * colour already on screen.
   */
  | 'grammar-equivalent'
  /**
   * The server is telling us it does *not* know. Painting it would assert a
   * confidence nobody has, and an error already has a louder layer above this
   * one.
   */
  | 'server-uncertain'

export type SemanticTokenServerProfile = {
  /**
   * What the client declares it will accept. Crosses to the backend inside
   * `initialize`, so it is an input to at least two real servers rather than a
   * local decoding table: terraform-ls intersects its own legend against the
   * declared `tokenTypes`, and ocaml-lsp returns no provider at all unless the
   * client declares `formats: ['relative']` and `requests.full`.
   */
  readonly requests: { readonly full: { readonly delta: boolean }; readonly range: boolean }
  /**
   * Whether this app already has syntactic colour for the languages this server
   * claims. The editor cannot answer it — it depends on which grammar *this*
   * host registered for the language id — and a wrong answer changes what a
   * server sends.
   */
  readonly augmentsSyntaxTokens: boolean
  /** This server's own type names, mapped onto scopes the editor's theme knows. */
  readonly scopeAliases: Readonly<Record<string, string>>
  /** Names left to fall through, each with the reason it is left. */
  readonly uncovered: Readonly<Record<string, SemanticTokenUncoveredReason>>
  /**
   * Refuse a whole-file request above this many bytes, `null` for no cap.
   *
   * A cap rather than a preference: gopls v0.21.0 answers a `full` request over
   * 100 000 bytes with `semantic tokens: range …/server.go too large
   * (131896 > 100000)` — an error the user must never see — while a 60-line
   * range request against the same file succeeds. Above the cap, range is not an
   * optimization; it is the only thing that works.
   */
  readonly maxFullRequestBytes: number | null
  /** Whether this server's tokens are requested when the user has set no preference. */
  readonly enabledByDefault: boolean
}

/**
 * Punctuation and operator families, shared by every server that names them.
 *
 * Every one of these is lexically obvious. Aliasing them would roughly double
 * the painted span count to reproduce a colour the grammar already put there.
 */
const GRAMMAR_EQUIVALENT_PUNCTUATION = [
  'angle',
  'arithmetic',
  'bitwise',
  'boolean',
  'brace',
  'bracket',
  'character',
  'colon',
  'comma',
  'comparison',
  'dot',
  'logical',
  'parenthesis',
  'punctuation',
  'semicolon',
] as const

const grammarEquivalent = (
  names: readonly string[],
): Readonly<Record<string, SemanticTokenUncoveredReason>> =>
  Object.fromEntries(names.map((name) => [name, 'grammar-equivalent' as const]))

/**
 * rust-analyzer 1.88.0 — measured: `full: { delta: true }`, `range: true`,
 * **57 types / 22 modifiers**, of which 38 types are non-standard.
 *
 * It is the server that makes this table unavoidable rather than optional:
 * executed with no aliases at all it paints the nineteen standard names and
 * drops the other thirty-eight, and nothing looks broken while it does.
 */
const RUST_ANALYZER: SemanticTokenServerProfile = {
  augmentsSyntaxTokens: true,
  enabledByDefault: true,
  maxFullRequestBytes: null,
  requests: { full: { delta: true }, range: true },
  scopeAliases: {
    attribute: 'decorator',
    attributeBracket: 'decorator',
    builtinAttribute: 'decorator',
    builtinType: 'type',
    // A `const` or `static` item is a constant, and the syntactic layer already
    // resolves an all-caps identifier to the constant colour — `variable.readonly`
    // is the scope that agrees with it rather than fighting it.
    const: 'variable.readonly',
    constParameter: 'typeParameter',
    derive: 'decorator',
    deriveHelper: 'decorator',
    // A format specifier is genuine analysis: it is a hole inside a string
    // literal that the grammar renders as more string.
    escapeSequence: 'regexp',
    formatSpecifier: 'regexp',
    generic: 'typeParameter',
    label: 'typeParameter',
    lifetime: 'typeParameter',
    macroBang: 'macro',
    parenthesis: 'operator',
    procMacro: 'macro',
    selfKeyword: 'keyword',
    selfTypeKeyword: 'keyword',
    static: 'variable.readonly',
    toolModule: 'namespace',
    typeAlias: 'type',
    union: 'struct',
  },
  uncovered: {
    ...grammarEquivalent(GRAMMAR_EQUIVALENT_PUNCTUATION.filter((name) => name !== 'parenthesis')),
    invalidEscapeSequence: 'server-uncertain',
    unresolvedReference: 'server-uncertain',
  },
}

/**
 * gopls v0.21.0 — measured: `full: true` (**a bare `true`, so no delta**),
 * `range: true`, 14 types / 15 modifiers.
 *
 * The control case. Its custom axis is *modifiers* — Go's type shapes, `array`
 * `chan` `map` `pointer` `slice` `struct` — not types, and a modifier the scope
 * table has no rule for resolves to exactly the base scope, so none of them need
 * a row. It also returns a `resultId` on every response and then rejects
 * `full/delta` outright, which is why nothing here reads a `resultId` to decide
 * anything.
 */
const GOPLS: SemanticTokenServerProfile = {
  augmentsSyntaxTokens: true,
  enabledByDefault: true,
  // Measured: `full` on a 131.9 KB file is refused outright; the 60-line range
  // request against the same file succeeded.
  maxFullRequestBytes: 100_000,
  requests: { full: { delta: false }, range: true },
  scopeAliases: { label: 'typeParameter' },
  uncovered: {},
}

/**
 * clangd (Apple 15) — measured: `full: { delta: true }` and **`range: false`**.
 * A `semanticTokens/range` request answers *method not found*.
 *
 * That single fact is why request policy is per server rather than universal: a
 * design whose viewport story is "always ask for a range" has nothing to ask
 * clangd. Its legend also carries duplicate names at several indices —
 * `variable` at 0, 1 and 7, `function` at 3 and 5, `type` at 12, 13 and 18 —
 * which is why the decoder reads by index and never inverts a legend into a
 * name-to-index map.
 */
const CLANGD: SemanticTokenServerProfile = {
  augmentsSyntaxTokens: true,
  enabledByDefault: true,
  maxFullRequestBytes: null,
  requests: { full: { delta: true }, range: false },
  scopeAliases: { concept: 'interface' },
  uncovered: { unknown: 'server-uncertain' },
}

/**
 * zls 0.16.0 — measured: `full: true` (a bare boolean, so no delta),
 * `range: true`, **28 types / 13 modifiers**.
 *
 * The largest user-visible payoff on the shortlist, because `.zig` had no colour
 * at all before this change — which is also why `augmentsSyntaxTokens` is the one
 * `false` in this table.
 *
 * It is also the row that justifies decoding by index rather than by name:
 * `escapeSequence` sits at index **19**, *between* `string` and `number` —
 * inserted mid-legend rather than appended — so anything assuming indices 0-22
 * are the standard set mis-decodes every token after it.
 */
const ZLS: SemanticTokenServerProfile = {
  // False, and this is the row that proves the field has to be per server: zig
  // now has a shiki grammar registered here, but zls's own tokens are the whole
  // rendering of the identifiers in it.
  augmentsSyntaxTokens: false,
  enabledByDefault: true,
  maxFullRequestBytes: null,
  requests: { full: { delta: false }, range: true },
  // The five non-standard names in the measured legend, and no more: an alias
  // for a name a server does not emit is dead data that reads as coverage.
  scopeAliases: {
    builtin: 'function.defaultLibrary',
    errorTag: 'enumMember',
    escapeSequence: 'regexp',
    keywordLiteral: 'keyword',
    label: 'typeParameter',
  },
  uncovered: {},
}

/**
 * terraform-ls — measured: `full: true`, **no `range` key at all**, and a legend
 * of exactly **9 types / 1 modifier**, every one of them standard.
 *
 * The row that turns "who owns the legend" from an argument into something a
 * server demonstrates. Those 9 are not terraform-ls's own vocabulary — they are
 * *the intersection of its vocabulary with the `tokenTypes` this client
 * declared*. Its custom `hcl-*` types are absent because we did not name them,
 * and it will not emit what it did not advertise.
 *
 * So the declared block is an **input** to this server, not a local decoding
 * table — which is precisely why it must be a pure function of the server id.
 * A block that varied per tab would give the first tab in a root a different
 * legend from the second, against a backend they share.
 */
const TERRAFORM_LS: SemanticTokenServerProfile = {
  augmentsSyntaxTokens: true,
  enabledByDefault: true,
  maxFullRequestBytes: null,
  requests: { full: { delta: false }, range: false },
  scopeAliases: {},
  uncovered: {},
}

/**
 * typescript-language-server — measured: `full: true`, `range: true`, **12 types
 * / 6 modifiers**, with `member` the one non-standard type and `local` a
 * non-standard modifier.
 *
 * Shipped off pending a look against a real theme — highest traffic, smallest gain, largest
 * regression risk. Looked at against rose-pine, so it is on.
 */
const TYPESCRIPT_LANGUAGE_SERVER: SemanticTokenServerProfile = {
  augmentsSyntaxTokens: true,
  enabledByDefault: true,
  maxFullRequestBytes: null,
  requests: { full: { delta: false }, range: true },
  // `member` is this server's name for a class member, and VS Code maps it to
  // `entity.name.function.member` — the function colour. Aliasing it to `property` painted every
  // method the field colour, overriding the yellow shiki had already given it.
  scopeAliases: { member: 'method' },
  // `local` is a modifier here rather than a type, and a modifier the scope table
  // has no rule for resolves to exactly the base scope, so it needs nothing.
  uncovered: {},
}

/**
 * What a server with no row of its own gets.
 *
 * `augmentsSyntaxTokens: true` because the overwhelming majority of the
 * thirty-seven servers behind this app cover a language shiki already paints,
 * and off by default because a server nobody has looked at should not be
 * repainting anyone's code.
 */
const DEFAULT_PROFILE: SemanticTokenServerProfile = {
  augmentsSyntaxTokens: true,
  enabledByDefault: false,
  maxFullRequestBytes: null,
  requests: { full: { delta: false }, range: true },
  scopeAliases: {},
  uncovered: {},
}

const SEMANTIC_TOKEN_SERVERS: Readonly<Record<string, SemanticTokenServerProfile>> = {
  clangd: CLANGD,
  gopls: GOPLS,
  rust: RUST_ANALYZER,
  terraform: TERRAFORM_LS,
  typescript: TYPESCRIPT_LANGUAGE_SERVER,
  zls: ZLS,
}

/** Ids with a row of their own. Exported so a test can assert each one is real. */
export const SEMANTIC_TOKEN_SERVER_IDS = Object.keys(SEMANTIC_TOKEN_SERVERS)

export function semanticTokenProfileFor(serverId: string): SemanticTokenServerProfile {
  return SEMANTIC_TOKEN_SERVERS[serverId] ?? DEFAULT_PROFILE
}
