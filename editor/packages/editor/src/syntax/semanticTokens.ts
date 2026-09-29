import {
  createEditorScopeStyles,
  editorColorReference,
  editorColorValue,
  registerEditorColor,
  type EditorScopeStyleRule,
} from '../theme'
import type { VirtualizedTextHighlightStyle } from '../virtualization/virtualizedTextViewInternals'

/**
 * Semantic tokens as this editor takes them: decoded spans with names on them.
 *
 * Nothing in this file speaks LSP. There is no legend here, no 5-tuple, no `resultId`, no document
 * uri and no capability object, and there is deliberately no API that would accept one. A legend is
 * a property of whichever server answered — index-addressed, per-connection, and in a real
 * deployment fixed by whichever client reached a pooled backend first — so the index-to-name decode
 * happens once on the host's side of the seam, and what crosses it is a name.
 */
export type SemanticTokenSpan = {
  /** Absolute offset into the document text, UTF-16 code units, inclusive. */
  readonly start: number
  /** Absolute offset, UTF-16 code units, exclusive. */
  readonly end: number
  /** The legend NAME, already decoded by the host. Never an index. */
  readonly tokenType: string
  /** Legend NAMES, already decoded from the modifier bitset. Order is not significant. */
  readonly tokenModifiers?: readonly string[]
}

export type SemanticTokenPayload = {
  /** Must equal the active document's `EditorViewSnapshot.documentId`. */
  readonly documentId: string
  /**
   * The editor `textVersion` these spans describe — never the LSP document version, which a proxy
   * is free to rewrite in flight and does.
   */
  readonly textVersion: number
  readonly spans: readonly SemanticTokenSpan[]
}

/** The demand signal. Editor to host. Carries no document uri: mapping one is the host's work. */
export type SemanticTokenRangeRequest = {
  readonly documentId: string
  readonly textVersion: number
  /** Absolute offset, UTF-16, inclusive. */
  readonly start: number
  /** Absolute offset, UTF-16, exclusive. */
  readonly end: number
}

export type SemanticTokenDropReason = 'version-too-old' | 'version-ahead' | 'document-changed'

/**
 * The verdict `push()` returns synchronously. A host that ignores it is not conformant: it has no
 * other way to learn that its payload was dropped, and will sit on a stale `resultId` forever.
 */
export type SemanticTokenPushResult =
  | {
      readonly status: 'painted'
      /** 0 when the stamp was current; n when the spans were projected through n edits. */
      readonly projectedThroughEdits: number
      /** Spans that reached a highlight group. */
      readonly paintedSpans: number
      /**
       * Distinct `tokenType` names that resolved to no style and no alias, so their spans painted
       * nothing. Empty in the healthy case. This is the only signal a host has that a server's
       * custom legend is falling on the floor — which is otherwise indistinguishable from success
       * by eye, because a dropped span simply shows the syntactic colour underneath it.
       */
      readonly unresolvedTypeNames: readonly string[]
    }
  | { readonly status: 'dropped'; readonly reason: SemanticTokenDropReason }

/**
 * The standard token types, coloured through registered ids.
 *
 * Thirteen of the twenty-three have no id of their own in `EditorSyntaxTheme`, whose union is
 * closed and predates semantic tokens. `registerEditorColor` is open-ended, so they are registered
 * here with `editorColorReference` defaults pointing at the nearest existing id — a theme that
 * declares nothing new still looks deliberate, and a theme that wants its own says so by id through
 * `EditorTheme.colors`.
 */
const SEMANTIC_COLOR = {
  attribute: editorColorValue('syntax.attribute'),
  bracket: editorColorValue('syntax.bracket'),
  class: registerEditorColor('syntax.class', editorColorReference('syntax.typeDefinition')),
  comment: editorColorValue('syntax.comment'),
  constant: editorColorValue('syntax.constant'),
  decorator: registerEditorColor('syntax.decorator', editorColorReference('syntax.attribute')),
  enum: registerEditorColor('syntax.enum', editorColorReference('syntax.type')),
  enumMember: registerEditorColor('syntax.enumMember', editorColorReference('syntax.constant')),
  event: registerEditorColor('syntax.event', editorColorReference('syntax.function')),
  function: editorColorValue('syntax.function'),
  interface: registerEditorColor('syntax.interface', editorColorReference('syntax.type')),
  keyword: editorColorValue('syntax.keyword'),
  macro: registerEditorColor('syntax.macro', editorColorReference('syntax.function')),
  method: registerEditorColor('syntax.method', editorColorReference('syntax.function')),
  modifier: registerEditorColor('syntax.modifier', editorColorReference('syntax.keyword')),
  namespace: editorColorValue('syntax.namespace'),
  number: editorColorValue('syntax.number'),
  operator: registerEditorColor('syntax.operator', editorColorReference('syntax.bracket')),
  parameter: registerEditorColor('syntax.parameter', editorColorReference('syntax.variable')),
  property: editorColorValue('syntax.property'),
  regexp: registerEditorColor('syntax.regexp', editorColorReference('syntax.string')),
  string: editorColorValue('syntax.string'),
  struct: registerEditorColor('syntax.struct', editorColorReference('syntax.type')),
  type: editorColorValue('syntax.type'),
  typeParameter: editorColorValue('syntax.typeParameter'),
  variable: editorColorValue('syntax.variable'),
  variableBuiltin: editorColorValue('syntax.variableBuiltin'),
} as const

/**
 * The scopes a semantic token resolves against.
 *
 * A separate table from the tree-sitter capture rules on purpose: this vocabulary is LSP's, that one
 * is the grammars', and the names only look alike. The mechanism is shared —
 * `createEditorScopeStyles`, longest prefix at any depth — so a scope with no rule of its own
 * inherits from its nearest styled ancestor, and a name with no rule at any depth resolves to null.
 *
 * The modifier rules are few on purpose. Every one of them costs a distinct resolved style, and the
 * live highlight-group count is the number of distinct styles the viewport contains.
 */
const SEMANTIC_SCOPE_RULES: readonly EditorScopeStyleRule[] = [
  { scope: 'class', style: { color: SEMANTIC_COLOR.class } },
  { scope: 'comment', style: { color: SEMANTIC_COLOR.comment } },
  { scope: 'decorator', style: { color: SEMANTIC_COLOR.decorator } },
  { scope: 'enum', style: { color: SEMANTIC_COLOR.enum } },
  { scope: 'enumMember', style: { color: SEMANTIC_COLOR.enumMember } },
  { scope: 'event', style: { color: SEMANTIC_COLOR.event } },
  { scope: 'function', style: { color: SEMANTIC_COLOR.function } },
  { scope: 'function.defaultLibrary', style: { color: SEMANTIC_COLOR.macro } },
  { scope: 'interface', style: { color: SEMANTIC_COLOR.interface } },
  { scope: 'keyword', style: { color: SEMANTIC_COLOR.keyword } },
  { scope: 'macro', style: { color: SEMANTIC_COLOR.macro } },
  { scope: 'method', style: { color: SEMANTIC_COLOR.method } },
  { scope: 'modifier', style: { color: SEMANTIC_COLOR.modifier } },
  { scope: 'namespace', style: { color: SEMANTIC_COLOR.namespace } },
  { scope: 'number', style: { color: SEMANTIC_COLOR.number } },
  { scope: 'operator', style: { color: SEMANTIC_COLOR.operator } },
  { scope: 'parameter', style: { color: SEMANTIC_COLOR.parameter } },
  { scope: 'property', style: { color: SEMANTIC_COLOR.property } },
  { scope: 'regexp', style: { color: SEMANTIC_COLOR.regexp } },
  { scope: 'string', style: { color: SEMANTIC_COLOR.string } },
  { scope: 'struct', style: { color: SEMANTIC_COLOR.struct } },
  { scope: 'type', style: { color: SEMANTIC_COLOR.type } },
  { scope: 'typeParameter', style: { color: SEMANTIC_COLOR.typeParameter } },
  { scope: 'variable', style: { color: SEMANTIC_COLOR.variable } },
  // A readonly variable is a constant, and that is how the syntactic layer already paints one —
  // an all-caps identifier resolves to the constant colour there. Semantic colour that disagreed
  // with it in the same document would read as a bug rather than as extra information.
  { scope: 'variable.readonly', style: { color: SEMANTIC_COLOR.constant } },
  { scope: 'variable.defaultLibrary', style: { color: SEMANTIC_COLOR.variableBuiltin } },
]

const SEMANTIC_SCOPE_STYLES = createEditorScopeStyles(SEMANTIC_SCOPE_RULES)

/**
 * Which single modifier reaches the scope, most significant first.
 *
 * An LSP token carries a *set* of modifiers; the scope trie indexes a *sequence*. Subset scoring is
 * not a prefix walk, so `variable.readonly.local` finds nothing where the theme declared only
 * `variable.local`. Rather than build a second matcher, exactly one modifier — the highest-ranked
 * one present — becomes a suffix, which fits the trie the editor already has and bounds the scope
 * count at (types x modifiers + types) instead of (types x 2^modifiers).
 *
 * The order is not a judgement about which modifier is most interesting. It is this: **a modifier
 * the scope table has a rule for outranks every modifier it does not.** Only `defaultLibrary` and
 * `readonly` have one — `function.defaultLibrary`, `variable.defaultLibrary`, `variable.readonly` —
 * and a rule-less modifier resolves to exactly the base scope, because the trie walk stops at the
 * missing child. So picking one is harmless in itself and harmful only in what it displaces.
 *
 * Ranked the other way round it displaced plenty. TypeScript sets `{declaration, readonly, local}`
 * on the declaration site of a `const` and `{readonly, local}` on every reference to it, so
 * `declaration` first painted `const MAX = 10` as a plain variable and `MAX` two lines down as a
 * constant — and the syntactic layer, which resolves an all-caps identifier to the constant colour
 * at *both*, was overpainted at one of them. Turning semantic tokens on made that file worse than
 * leaving them off, in exactly the case the `variable.readonly` rule below exists to keep
 * consistent.
 *
 * `defaultLibrary` sits above `readonly` on the same principle the capture table uses for
 * `*.builtin`: it names one specific known thing, where `readonly` names a property of any symbol.
 * Below those two the order is inert today and settles ties only if a rule is ever added.
 * `definition` is not in the plan's list and is kept because `semanticTokensClientCapability()`
 * declares it; `local` is not a standard modifier and is kept because several real servers send it.
 */
const MODIFIER_PRECEDENCE: readonly string[] = [
  // Carry a rule of their own.
  'defaultLibrary',
  'readonly',
  // Resolve to the base scope, and are ranked only against each other.
  'declaration',
  'definition',
  'static',
  'abstract',
  'async',
  'deprecated',
  'documentation',
  'modification',
  'local',
]

const MODIFIER_RANKS = new Map(MODIFIER_PRECEDENCE.map((name, index) => [name, index]))

export type SemanticTokenStyleOptions = {
  /**
   * Maps a server's own type names onto scopes this editor's theme knows.
   *
   * Host data, per server, and at product scale not optional: a legend of fifty-seven types of which
   * thirty-eight are non-standard paints the standard nineteen and drops the rest until someone
   * writes its aliases. The editor ships no table of its own — there are dozens of servers, their
   * legends are theirs, and a table here would be stale the week it landed.
   */
  readonly scopeAliases?: Readonly<Record<string, string>>
  /** Stacked onto every resolved style, so the whole layer sits in one band. */
  readonly zIndex?: number
}

export type SemanticTokenStyles = {
  /** The style for a type and its modifiers, or null when nothing in the theme claims the name. */
  resolve(
    tokenType: string,
    tokenModifiers?: readonly string[],
  ): VirtualizedTextHighlightStyle | null
  /** The scope the pair maps onto, before resolution. Exposed for tests and host diagnostics. */
  scopeFor(tokenType: string, tokenModifiers?: readonly string[]): string
}

/**
 * Resolves a decoded token to a paintable style.
 *
 * The resolver is the editor's rather than the host's for one reason that outranks preference: the
 * theme is the editor's and so are the registered colour ids, and a host that resolved styles
 * itself would produce semantic colour that drifts from the tree-sitter and shiki colour in the same
 * document. One resolver, one theme, one set of ids.
 *
 * The result carries no font properties, because a highlight pseudo-element cannot apply them —
 * `VirtualizedTextHighlightStyle` does not offer them, and this is the only shape that reaches the
 * paint layer.
 */
export function createSemanticTokenStyles(
  options: SemanticTokenStyleOptions = {},
): SemanticTokenStyles {
  const aliases = options.scopeAliases
  const zIndex = options.zIndex
  const cache = new Map<string, VirtualizedTextHighlightStyle | null>()

  const scopeFor = (tokenType: string, tokenModifiers?: readonly string[]): string => {
    const base = aliases?.[tokenType] ?? tokenType
    const modifier = highestRankedModifier(tokenModifiers)
    return modifier === null ? base : `${base}.${modifier}`
  }

  return {
    scopeFor,
    resolve(tokenType, tokenModifiers) {
      const scope = scopeFor(tokenType, tokenModifiers)
      const cached = cache.get(scope)
      if (cached !== undefined) return cached

      const resolved = SEMANTIC_SCOPE_STYLES.resolve(scope)
      // An unresolved name paints nothing and the syntactic layer shows through unchanged. Falling
      // back to a wrong colour would be worse: it is what makes an unknown legend safe to receive.
      const style = resolved ? highlightStyle(resolved, zIndex) : null
      cache.set(scope, style)
      return style
    },
  }
}

function highlightStyle(
  style: { color?: string; backgroundColor?: string; textDecoration?: string },
  zIndex: number | undefined,
): VirtualizedTextHighlightStyle | null {
  const next: {
    backgroundColor?: string
    color?: string
    textDecoration?: string
    zIndex?: number
  } = {}
  if (style.color) next.color = style.color
  if (style.backgroundColor) next.backgroundColor = style.backgroundColor
  if (style.textDecoration) next.textDecoration = style.textDecoration
  // A rule that declared only a font property paints nothing at all, so it is the same as no rule.
  if (Object.keys(next).length === 0) return null
  if (zIndex !== undefined) next.zIndex = zIndex

  return next
}

function highestRankedModifier(tokenModifiers: readonly string[] | undefined): string | null {
  if (!tokenModifiers || tokenModifiers.length === 0) return null

  let best: string | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const modifier of tokenModifiers) {
    // A modifier the table does not list ranks below every one it does; ties among unlisted ones go
    // to the lexicographically first, so a set is resolved the same way however it was ordered.
    const rank = MODIFIER_RANKS.get(modifier) ?? MODIFIER_PRECEDENCE.length
    if (rank < bestRank || (rank === bestRank && best !== null && modifier < best)) {
      best = modifier
      bestRank = rank
    }
  }

  return best
}
