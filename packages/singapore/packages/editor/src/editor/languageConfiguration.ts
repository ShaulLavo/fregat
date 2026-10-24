import type { EditorDisposable } from './disposables'

/**
 * Per-language editing rules, as data.
 *
 * The rules used to live in a table per feature, each listing the language ids that feature happened
 * to know, so adding a language was an edit you could half-finish — pairs from one table, comment
 * tokens defaulted from another, folding from a third that had never heard of half of them. One
 * record per language makes a language either described or not described, and lets an embedder
 * describe one we ship no grammar for.
 */

export type EditorAutoClosingPair = {
  readonly open: string
  readonly close: string
  /** Quotes use one character for both ends, which changes several rules in auto-close. */
  readonly quote?: boolean
}

export type EditorBlockCommentTokens = {
  readonly open: string
  readonly close: string
}

export type EditorCommentTokens = {
  readonly line?: string
  readonly block?: EditorBlockCommentTokens
}

/**
 * A delimiter pair that opens and closes a block.
 *
 * Deliberately not the auto-closing list: a quote is auto-closed but never indents, and a language
 * can indent on a word pair it would never auto-close.
 */
export type EditorBracketPair = {
  readonly open: string
  readonly close: string
}

/**
 * What a line break does to the indentation it copies.
 *
 * `indentOutdent` is the two-line case: the caret lands on an indented blank line and whatever
 * followed the caret is pushed down to the outer level. Only these two carry `appendText`, because a
 * leader and a deeper level are two different claims on the new line's first text: a rule asking for
 * both would put its leader a tab stop away from the thing it continues.
 */
export type EditorEnterAction =
  | {
      readonly indentAction: 'none' | 'indentOutdent'
      /**
       * Text placed after the indentation, which is how a rule carries a comment's leader onto the
       * new line. Under `indentOutdent` it stands in for the extra level instead of adding to it.
       */
      readonly appendText?: string
      /** Characters trimmed off the end of the copied indentation, for a rule that ends a leader. */
      readonly removeText?: number
    }
  | {
      readonly indentAction: 'indent'
      readonly appendText?: undefined
      readonly removeText?: number
    }

/**
 * A rule that recognises a construct from the shape of the text around the caret.
 *
 * An omitted pattern is not a constraint. Every supplied pattern has to match, so a rule that names
 * `previousLineText` cannot fire on the first line.
 */
export type EditorOnEnterRule = {
  /** Matched against the current line from its start up to the caret. */
  readonly beforeText?: RegExp
  /** Matched against the rest of the current line, from the caret to the line's end. */
  readonly afterText?: RegExp
  /** Matched against the whole previous line. */
  readonly previousLineText?: RegExp
  readonly action: EditorEnterAction
}

/**
 * Indentation decided from a line's own shape, with no caret to look around.
 *
 * This is what reaches constructs a delimiter scan cannot see — a switch label opens a block with a
 * colon — and it is the only thing available to a whole-region reindent, which has no caret at all.
 */
export type EditorIndentationRules = {
  /** A line after which the following line belongs one level deeper. */
  readonly increaseIndentPattern: RegExp
  /** A line that belongs one level shallower than the line above it. */
  readonly decreaseIndentPattern: RegExp
  /** A line that keeps the indentation it has, whatever surrounds it. */
  readonly unIndentedLinePattern?: RegExp
}

/**
 * How the language's blocks end, for the fold walk that has only the text to go on.
 *
 * The region patterns are the language's own comment syntax: an author marks a fold explicitly by
 * writing `region` in a comment, and a line that is not a comment in this language must not count.
 */
export type EditorFoldingRules = {
  /**
   * Whether a run of blank lines closes the block above it instead of trailing inside it. True where
   * a block *is* its indentation, because then the blank lines are all that separates it from what
   * follows; false where a closing token ends the block, because that token has not been reached yet.
   */
  readonly offSide: boolean
  readonly regionMarkers: {
    readonly openers: readonly string[]
    readonly optionalHash: boolean
  }
}

export type EditorLanguageConfiguration = {
  readonly autoClosingPairs: readonly EditorAutoClosingPair[]
  readonly brackets: readonly EditorBracketPair[]
  readonly comments?: EditorCommentTokens
  readonly onEnterRules?: readonly EditorOnEnterRule[]
  readonly indentationRules?: EditorIndentationRules
  readonly folding?: EditorFoldingRules
  /**
   * Whether a line opening with a bullet, a number or a quote marker is a list item whose marker a
   * line break carries on.
   *
   * Deliberately opt-in: ` * ` at the start of a line is a doc-comment leader in every C-family
   * language, so continuing lists everywhere would fight the comment rules and, worse, strip the star
   * off a leader the user meant to keep.
   */
  readonly listMarkers?: boolean
  /**
   * What one word looks like in this language, for a feature that has to decide whether the text it
   * is tracking is still the single word it began as.
   *
   * Populated where a name is written twice over and has to stay one name; a language in which
   * nothing is mirrored needs no answer, and leaving it out is what says so.
   */
  readonly wordPattern?: RegExp
}

export type OnEnterContext = {
  /** The current line from its start up to the caret. */
  readonly textBefore: string
  /** The rest of the current line, from the caret to the line's end. */
  readonly textAfter: string
  /** The whole previous line, or null when the caret is on the first one. */
  readonly previousLineText: string | null
}

const QUOTED_PAIRS: readonly EditorAutoClosingPair[] = [
  { close: ')', open: '(' },
  { close: ']', open: '[' },
  { close: '}', open: '{' },
  { close: "'", open: "'", quote: true },
  { close: '"', open: '"', quote: true },
]

/** A backtick delimits a literal only where the language has one; elsewhere it is a stray character. */
const CODE_PAIRS: readonly EditorAutoClosingPair[] = QUOTED_PAIRS.concat([
  { close: '`', open: '`', quote: true },
])

/**
 * What a language with no entry in the catalog closes: everything. Narrowing it to brackets bought
 * nothing — `shouldAutoClose` already refuses a quote after a word character, which is the case the
 * narrowing existed for, and it keeps an unfamiliar language behaving like a familiar one.
 */
export const DEFAULT_AUTO_CLOSING_PAIRS: readonly EditorAutoClosingPair[] = CODE_PAIRS

/** Markdown and plain prose: brackets still help, but apostrophes are punctuation, not delimiters. */
const PROSE_PAIRS: readonly EditorAutoClosingPair[] = [
  { close: ')', open: '(' },
  { close: ']', open: '[' },
  { close: '}', open: '{' },
  { close: '`', open: '`', quote: true },
]

const BRACKETS: readonly EditorBracketPair[] = [
  { close: ')', open: '(' },
  { close: ']', open: '[' },
  { close: '}', open: '{' },
]

const LINE_AND_BLOCK_COMMENTS: EditorCommentTokens = {
  line: '//',
  block: { open: '/*', close: '*/' },
}

const HTML_COMMENTS: EditorCommentTokens = {
  block: { open: '<!--', close: '-->' },
}

/** A block-comment opener, plain or doc-style, that the same line does not go on to close. */
const BLOCK_COMMENT_OPENED = /^\s*\/\*\*?(?!\/)([^*]|\*(?!\/))*$/

/** A leader line inside a block comment, up to but not including its closer. */
const BLOCK_COMMENT_LEADER = /^(\t|[ ])*[ ]\*([ ]([^*]|\*(?!\/))*)?$/

/**
 * Continuation of a block comment.
 *
 * The leader is one space plus a star, not an indent level, so the stars stack under the opener's
 * second character; that is why these rules carry the leader as text instead of asking for an
 * indent. The closer's own line is a space wider than the block, hence the single character trimmed
 * back off when the comment ends.
 */
const BLOCK_COMMENT_ON_ENTER_RULES: readonly EditorOnEnterRule[] = [
  {
    action: { appendText: ' * ', indentAction: 'indentOutdent' },
    afterText: /^\s*\*\/$/,
    beforeText: BLOCK_COMMENT_OPENED,
  },
  {
    action: { appendText: ' * ', indentAction: 'none' },
    beforeText: BLOCK_COMMENT_OPENED,
  },
  {
    // Requiring the previous line to still be inside the comment is what stops a bulleted prose
    // line from growing a star of its own; a previous line that was only the closer has ended it.
    action: { appendText: '* ', indentAction: 'none' },
    beforeText: BLOCK_COMMENT_LEADER,
    previousLineText: /^\s*(\/\*|\*)(?!\/)((?!\*\/).)*$/,
  },
  {
    action: { indentAction: 'none', removeText: 1 },
    beforeText: /^(\t|[ ])*[ ]\*\/\s*$/,
  },
]

/**
 * A tag that opens an element, at the end of the text before the caret.
 *
 * Void elements are excluded because nothing can nest inside them, and the list is matched
 * case-sensitively on purpose: `<Input>` is a component with children, `<input>` is not.
 */
const OPEN_TAG_BEFORE =
  /<(?!(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b)[A-Za-z][\w.:-]*(?:\s[^<>]*[^/<>\s])?\s*>\s*$/

const CLOSE_TAG_AFTER = /^\s*<\/[A-Za-z][\w.:-]*\s*>/

/**
 * A tag name, which is wider than an identifier: the namespace colons, the custom-element hyphens
 * and the member dots a tag may carry are all part of the one name a rename is renaming.
 */
const TAG_NAME_PATTERN = /[A-Za-z_$][\w.:$-]*/

const TAG_ON_ENTER_RULES: readonly EditorOnEnterRule[] = [
  {
    action: { indentAction: 'indentOutdent' },
    afterText: CLOSE_TAG_AFTER,
    beforeText: OPEN_TAG_BEFORE,
  },
  {
    action: { indentAction: 'indent' },
    beforeText: OPEN_TAG_BEFORE,
  },
]

/**
 * Indentation by line shape for the C-family languages.
 *
 * The character classes excluded after an opener are the string delimiters: `"{"` is a brace in a
 * string literal and must not open a block, and a scan of the line is the only thing available
 * here — there is no parse tree at this level.
 *
 * A switch label is its own anchored alternative rather than another opener reached through the
 * leading run, because that run will happily spend the first half of an identifier: `lowercase:`
 * ends in a label word without being one, and prettier leaves a wrapped property name alone with its
 * colon on exactly that shape. The label words only ever begin a line.
 */
const CODE_INDENTATION_RULES: EditorIndentationRules = {
  decreaseIndentPattern: /^\s*(?:[)\]}]|(?:case\b.*|default)\s*:)/,
  increaseIndentPattern:
    /^(?:((?!\/\/).)*(?:\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)|\s*(?:case\b.*|default)\s*:)\s*$/,
}

/** Indentation for the data and style languages, where only a delimiter opens a block. */
const BRACKET_INDENTATION_RULES: EditorIndentationRules = {
  decreaseIndentPattern: /^\s*[)\]}]/,
  increaseIndentPattern: /[([{]\s*$/,
}

const SLASH_MARKED_FOLDING: EditorFoldingRules = {
  offSide: false,
  regionMarkers: { openers: ['//'], optionalHash: true },
}

const BLOCK_MARKED_FOLDING: EditorFoldingRules = {
  offSide: false,
  regionMarkers: { openers: ['/*'], optionalHash: true },
}

const TAG_MARKED_FOLDING: EditorFoldingRules = {
  offSide: false,
  regionMarkers: { openers: ['<!--'], optionalHash: true },
}

/** Prose that is also markup: regions are marked in the markup, but a section ends where it thins out. */
const PROSE_FOLDING: EditorFoldingRules = { ...TAG_MARKED_FOLDING, offSide: true }

const HASH_MARKED_FOLDING: EditorFoldingRules = {
  offSide: true,
  regionMarkers: { openers: ['#'], optionalHash: false },
}

const CODE: EditorLanguageConfiguration = {
  autoClosingPairs: CODE_PAIRS,
  brackets: BRACKETS,
  comments: LINE_AND_BLOCK_COMMENTS,
  folding: SLASH_MARKED_FOLDING,
  indentationRules: CODE_INDENTATION_RULES,
  onEnterRules: BLOCK_COMMENT_ON_ENTER_RULES,
}

const CODE_WITH_TAGS: EditorLanguageConfiguration = {
  ...CODE,
  onEnterRules: BLOCK_COMMENT_ON_ENTER_RULES.concat(TAG_ON_ENTER_RULES),
  wordPattern: TAG_NAME_PATTERN,
}

const JSON_LIKE: EditorLanguageConfiguration = {
  autoClosingPairs: CODE_PAIRS,
  brackets: BRACKETS,
  comments: LINE_AND_BLOCK_COMMENTS,
  folding: SLASH_MARKED_FOLDING,
  indentationRules: BRACKET_INDENTATION_RULES,
}

const CSS: EditorLanguageConfiguration = {
  autoClosingPairs: CODE_PAIRS,
  brackets: BRACKETS,
  comments: { block: { open: '/*', close: '*/' } },
  folding: BLOCK_MARKED_FOLDING,
  indentationRules: BRACKET_INDENTATION_RULES,
  onEnterRules: BLOCK_COMMENT_ON_ENTER_RULES,
}

const SCSS: EditorLanguageConfiguration = {
  ...CSS,
  comments: LINE_AND_BLOCK_COMMENTS,
  folding: SLASH_MARKED_FOLDING,
}

const HTML: EditorLanguageConfiguration = {
  autoClosingPairs: CODE_PAIRS,
  brackets: BRACKETS,
  comments: HTML_COMMENTS,
  folding: TAG_MARKED_FOLDING,
  onEnterRules: TAG_ON_ENTER_RULES,
  wordPattern: TAG_NAME_PATTERN,
}

const MARKDOWN: EditorLanguageConfiguration = {
  autoClosingPairs: PROSE_PAIRS,
  brackets: BRACKETS,
  comments: HTML_COMMENTS,
  folding: PROSE_FOLDING,
  listMarkers: true,
}

/** Python and the YAML family: one comment marker, and no token whose arrival would close a block. */
const INDENTED: EditorLanguageConfiguration = {
  autoClosingPairs: QUOTED_PAIRS,
  brackets: BRACKETS,
  comments: { line: '#' },
  folding: HASH_MARKED_FOLDING,
}

/** C-family languages with no backtick literal, where a stray one should stay a single character. */
const C_LIKE: EditorLanguageConfiguration = { ...CODE, autoClosingPairs: QUOTED_PAIRS }

/** An apostrophe opens a lifetime far more often than a character literal, so it is left alone. */
const RUST: EditorLanguageConfiguration = {
  ...CODE,
  autoClosingPairs: QUOTED_PAIRS.filter((pair) => pair.open !== "'"),
}

const LUA: EditorLanguageConfiguration = {
  autoClosingPairs: QUOTED_PAIRS,
  brackets: BRACKETS,
  comments: { line: '--', block: { open: '--[[', close: ']]' } },
}

const SQL: EditorLanguageConfiguration = {
  autoClosingPairs: CODE_PAIRS,
  brackets: BRACKETS,
  comments: { line: '--', block: { open: '/*', close: '*/' } },
}

/** Hash comments without Python's off-side folding: these blocks end at a token or a header. */
const HASH_COMMENTED: EditorLanguageConfiguration = {
  autoClosingPairs: QUOTED_PAIRS,
  brackets: BRACKETS,
  comments: { line: '#' },
}

const SHELL: EditorLanguageConfiguration = { ...HASH_COMMENTED, autoClosingPairs: CODE_PAIRS }

/**
 * Seeded as the map's initial contents rather than by calling `register` at module load, so that a
 * bundler treating a top-level call as droppable cannot leave the editor with no languages at all.
 */
const configurations = new Map<string, EditorLanguageConfiguration>([
  ['astro', HTML],
  ['c', C_LIKE],
  ['cpp', C_LIKE],
  ['csharp', C_LIKE],
  ['css', CSS],
  ['go', CODE],
  ['html', HTML],
  ['java', C_LIKE],
  ['javascript', CODE],
  ['javascriptreact', CODE_WITH_TAGS],
  ['json', JSON_LIKE],
  ['jsonc', JSON_LIKE],
  ['jsx', CODE_WITH_TAGS],
  ['lua', LUA],
  ['markdown', MARKDOWN],
  ['md', MARKDOWN],
  ['mdx', MARKDOWN],
  ['php', CODE],
  ['python', INDENTED],
  ['rust', RUST],
  ['scss', SCSS],
  ['shellscript', SHELL],
  ['sql', SQL],
  ['svelte', HTML],
  ['toml', HASH_COMMENTED],
  ['ts', CODE],
  ['tsx', CODE_WITH_TAGS],
  ['typescript', CODE],
  ['typescriptreact', CODE_WITH_TAGS],
  ['yaml', INDENTED],
  ['yml', INDENTED],
])

/**
 * Adds or replaces the rules for a language.
 *
 * Disposing restores whatever the registration shadowed instead of clearing the entry, because the
 * languages we ship live in the same map: an embedder overriding TypeScript and then dropping the
 * override must get TypeScript back, not a language with no rules.
 */
export function registerEditorLanguageConfiguration(
  languageId: string,
  configuration: EditorLanguageConfiguration,
): EditorDisposable {
  const key = normalizeLanguageId(languageId)
  if (key === null) return { dispose: () => {} }

  const shadowed = configurations.get(key)
  configurations.set(key, configuration)

  return {
    dispose: () => {
      if (configurations.get(key) !== configuration) return
      if (shadowed) configurations.set(key, shadowed)
      else configurations.delete(key)
    },
  }
}

export function editorLanguageConfiguration(
  languageId: string | null | undefined,
): EditorLanguageConfiguration | null {
  const key = normalizeLanguageId(languageId)
  if (key === null) return null

  return configurations.get(key) ?? null
}

/**
 * What a line break should do, decided in strict order of specificity.
 *
 * The order is the whole point. A language's own rule wins over anything derived from delimiters,
 * because a rule is the only thing that can know the construct is not a delimiter — a doc-comment
 * leader and a switch label both look like ordinary text to a bracket scan. Delimiter adjacency then
 * beats the plain copy, and the pair case beats the lone opener so the closer gets its own line.
 */
export function onEnterAction(
  configuration: EditorLanguageConfiguration | null,
  context: OnEnterContext,
): EditorEnterAction | null {
  if (!configuration) return null

  for (const rule of configuration.onEnterRules ?? []) {
    if (ruleMatches(rule, context)) return rule.action
  }

  const { textAfter, textBefore } = context
  if (textBefore.length > 0 && textAfter.length > 0) {
    for (const pair of configuration.brackets) {
      if (!matches(openBracketPattern(pair.open), textBefore)) continue
      if (!matches(closeBracketPattern(pair.close), textAfter)) continue

      return { indentAction: 'indentOutdent' }
    }
  }

  if (textBefore.length > 0) {
    for (const pair of configuration.brackets) {
      if (matches(openBracketPattern(pair.open), textBefore)) return { indentAction: 'indent' }
    }
  }

  return null
}

function ruleMatches(rule: EditorOnEnterRule, context: OnEnterContext): boolean {
  if (rule.beforeText && !matches(rule.beforeText, context.textBefore)) return false
  if (rule.afterText && !matches(rule.afterText, context.textAfter)) return false
  if (!rule.previousLineText) return true

  return (
    context.previousLineText !== null && matches(rule.previousLineText, context.previousLineText)
  )
}

/**
 * A registered pattern is a value an embedder handed us, so it may carry `g` and a `lastIndex` left
 * over from its own use; resetting makes a rule's verdict depend on the text alone.
 */
export function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0

  return pattern.test(text)
}

const openBracketPatterns = new Map<string, RegExp>()
const closeBracketPatterns = new Map<string, RegExp>()

/**
 * A delimiter turned into a test on the shape of a line rather than on one character.
 *
 * Anchoring to the end of the text before the caret is what lets `{` followed by trailing spaces
 * decide a line break the same way a bare `{` does, and the word boundary keeps a word delimiter
 * from firing inside a longer identifier.
 */
function openBracketPattern(open: string): RegExp {
  const cached = openBracketPatterns.get(open)
  if (cached) return cached

  const pattern = new RegExp(`${wordBoundaryFor(open.at(0))}${escapeForPattern(open)}\\s*$`)
  openBracketPatterns.set(open, pattern)
  return pattern
}

function closeBracketPattern(close: string): RegExp {
  const cached = closeBracketPatterns.get(close)
  if (cached) return cached

  const pattern = new RegExp(`^\\s*${escapeForPattern(close)}${wordBoundaryFor(close.at(-1))}`)
  closeBracketPatterns.set(close, pattern)
  return pattern
}

function wordBoundaryFor(char: string | undefined): string {
  if (char === undefined) return ''

  return /[\p{L}\p{N}_]/u.test(char) ? '\\b' : ''
}

function escapeForPattern(value: string): string {
  return value.replace(/[\\{}*+?|^$.[\]()]/g, '\\$&')
}

/** Language ids reach us from file associations and hosts, so casing and stray space are not signal. */
function normalizeLanguageId(languageId: string | null | undefined): string | null {
  if (!languageId) return null

  const normalized = languageId.trim().toLowerCase()
  return normalized.length === 0 ? null : normalized
}

const FALLBACK_FOLDING_RULES: EditorFoldingRules = {
  offSide: true,
  regionMarkers: { openers: ['//', '/*', '#', '--', ';', '%', '<!--'], optionalHash: true },
}

export function indentationFoldingRules(languageId: string | null): EditorFoldingRules {
  return editorLanguageConfiguration(languageId)?.folding ?? FALLBACK_FOLDING_RULES
}

export type EditorRegionMarker = 'start' | 'end' | null

type MarkerAlternative = { readonly text: string; readonly marker: 'start' | 'end' }

/** The shipped anchored marker grammar, consumed without retaining a line or its whitespace. */
export class EditorRegionMarkerClassifier {
  private stage: 'leading' | 'opener' | 'space' | 'word' | 'boundary' | 'done' = 'leading'
  private candidates: readonly string[]
  private index = 0
  private wordCandidates: readonly MarkerAlternative[] = []
  private result: EditorRegionMarker = null
  private hashAllowed: boolean

  constructor(rules: EditorFoldingRules['regionMarkers']) {
    this.candidates = rules.openers
    this.hashAllowed = rules.optionalHash
  }

  push(code: number): void {
    if (this.stage === 'done') return
    const character = String.fromCharCode(code)
    if (this.stage === 'leading' && /\s/.test(character)) return
    if (this.stage === 'leading') this.stage = 'opener'
    if (this.stage === 'opener') return this.opener(character)
    if (this.stage === 'space') return this.space(character)
    if (this.stage === 'word') return this.word(character)
    this.result = /[A-Za-z0-9_]/.test(character) ? null : this.result
    this.stage = 'done'
  }

  finish(): EditorRegionMarker {
    return this.stage === 'boundary' || this.stage === 'done' ? this.result : null
  }

  private opener(character: string): void {
    this.candidates = this.candidates.filter((opener) => opener[this.index] === character)
    this.index += 1
    if (this.candidates.length === 0) this.stage = 'done'
    if (!this.candidates.some((opener) => opener.length === this.index)) return
    this.stage = 'space'
    this.index = 0
  }

  private space(character: string): void {
    if (/\s/.test(character)) return
    if (character === '#' && this.hashAllowed) {
      this.hashAllowed = false
      this.stage = 'word'
      this.wordCandidates = [
        { text: 'region', marker: 'start' },
        { text: 'endregion', marker: 'end' },
      ]
      return
    }
    this.stage = 'word'
    this.wordCandidates = [
      { text: 'region', marker: 'start' },
      { text: 'endregion', marker: 'end' },
    ]
    this.word(character)
  }

  private word(character: string): void {
    this.wordCandidates = this.wordCandidates.filter((word) => word.text[this.index] === character)
    this.index += 1
    if (this.wordCandidates.length === 0) this.stage = 'done'
    const complete = this.wordCandidates.find((word) => word.text.length === this.index)
    if (!complete) return
    this.result = complete.marker
    this.stage = 'boundary'
  }
}
