import {
  DEFAULT_AUTO_CLOSING_PAIRS,
  editorLanguageConfiguration,
  type EditorAutoClosingPair,
  type EditorBlockCommentTokens,
  type EditorLanguageConfiguration,
} from './languageConfiguration'

/**
 * Characters a pair may be auto-closed *before*: whitespace and the closers of
 * other pairs, so typing a quote mid-word does not wrap the rest of the word.
 *
 * The point is that `(` typed immediately before a word should not close: you are almost always
 * wrapping the word that follows, and an inserted `)` would land in the middle of it.
 */
const AUTO_CLOSE_BEFORE = new Set([';', ':', '.', ',', '=', '}', ']', ')', '>', ' ', '\t'])

/** Stand-ins for the character being typed, in the order the probe below prefers them. */
const NEUTRAL_CHARACTERS = '0123456789abcdefghijklmnopqrstuvwxyz'

export function autoClosingPairsForLanguage(
  languageId: string | null | undefined,
): readonly EditorAutoClosingPair[] {
  return editorLanguageConfiguration(languageId)?.autoClosingPairs ?? DEFAULT_AUTO_CLOSING_PAIRS
}

export function autoClosingPairForOpen(
  pairs: readonly EditorAutoClosingPair[],
  typed: string,
): EditorAutoClosingPair | null {
  return pairs.find((pair) => pair.open === typed) ?? null
}

export function autoClosingPairForClose(
  pairs: readonly EditorAutoClosingPair[],
  typed: string,
): EditorAutoClosingPair | null {
  return pairs.find((pair) => pair.close === typed) ?? null
}

/**
 * Where the keystroke is going: the line it lands on, split at the caret.
 *
 * A line rather than the two adjacent characters, because whether the caret stands in code or in the
 * middle of a literal is a question about the text leading up to it.
 */
export type AutoCloseContext = {
  readonly languageId: string | null | undefined
  /** The current line from its start up to the caret. */
  readonly textBefore: string
  /** The rest of the current line, from the caret to the line's end. */
  readonly textAfter: string
}

/**
 * Whether typing `pair.open` at a collapsed caret should insert the closer too.
 *
 * Three rules, all about not getting in the way:
 * - only close before whitespace, end of line, or a character that ends an expression — never
 *   directly before a word, where the closer would land mid-identifier
 * - for quotes, additionally never close right after a word character, so an apostrophe in `don't`
 *   or `it's` stays an apostrophe
 * - never close inside a string or a comment, where the text is prose and the delimiter nobody asked
 *   for has to be deleted again by hand
 */
export function shouldAutoClose(pair: EditorAutoClosingPair, context: AutoCloseContext): boolean {
  const delimiters = literalDelimiters(editorLanguageConfiguration(context.languageId))
  const charAfter = context.textAfter.at(0) ?? null
  const charBefore = context.textBefore.at(-1) ?? null

  if (charAfter !== null && !closesBefore(pair, delimiters, charAfter)) return false
  if (pair.quote) {
    // `''` and `""` would otherwise nest endlessly as you type a second quote to close the first.
    if (charBefore === pair.open) return false
    if (isWordCharacter(charBefore)) return false
  }

  const neutral = neutralCharacter(pair, delimiters)
  // Without a stand-in there is nothing to ask the question with, and not closing leaves the user a
  // character to type rather than one to delete.
  if (neutral === undefined) return false

  return tokenTypeAtCaret(delimiters, context, neutral) === 'other'
}

/** What a typed opener would be wrapping. */
export type SurroundContext = {
  readonly languageId: string | null | undefined
  /** The text one selection covers. */
  readonly selectedText: string
}

/**
 * Whether typing `pair.open` over a selection should wrap it rather than replace it.
 *
 * Replacing is what was meant when the selection holds nothing but whitespace — those spaces are
 * being typed over, and wrapping them would leave a pair around nothing — and when a quote is typed
 * over a lone quote, which is the same correction written in one character: that delimiter is being
 * replaced, not quoted.
 */
export function shouldSurroundSelection(
  pair: EditorAutoClosingPair,
  context: SurroundContext,
): boolean {
  if (context.selectedText.trim().length === 0) return false
  if (!pair.quote) return true

  return !isQuoteDelimiter(context.languageId, context.selectedText)
}

/**
 * Whether typing `pair.close` should step over an existing closer instead of inserting one.
 *
 * Only true when the character at the caret is that closer AND this editor put it there — typing
 * `)` before a hand-written `)` must still insert, or deleting text you meant to keep becomes
 * impossible.
 */
export function shouldTypeOverCloser(options: {
  readonly charAfter: string | null
  readonly close: string
  readonly trackedAtCaret: boolean
}): boolean {
  if (!options.trackedAtCaret) return false

  return options.charAfter === options.close
}

/**
 * Whether backspacing at a collapsed caret should delete a whole pair.
 *
 * Same rule as type-over: only a pair this editor inserted, still intact, with the caret still
 * between its halves.
 */
export function shouldDeletePair(options: {
  readonly charAfter: string | null
  readonly charBefore: string | null
  readonly pair: EditorAutoClosingPair | null
  readonly trackedAtCaret: boolean
}): boolean {
  if (!options.trackedAtCaret) return false
  if (!options.pair) return false

  return options.charBefore === options.pair.open && options.charAfter === options.pair.close
}

/** The delimiters that begin a run of text the language does not read as code. */
type LiteralDelimiters = {
  readonly quotes: readonly string[]
  readonly line: string | null
  readonly block: EditorBlockCommentTokens | null
}

type AutoCloseTokenType = 'string' | 'comment' | 'other'

/**
 * A registered language is data an embedder wrote, so an empty delimiter can reach here. One would
 * match at every position and never move the scan below along, hanging the keystroke that asked.
 */
function literalDelimiters(configuration: EditorLanguageConfiguration | null): LiteralDelimiters {
  const block = configuration?.comments?.block
  const line = configuration?.comments?.line

  return {
    block: block && block.open.length > 0 && block.close.length > 0 ? block : null,
    line: line && line.length > 0 ? line : null,
    quotes: (configuration?.autoClosingPairs ?? DEFAULT_AUTO_CLOSING_PAIRS)
      .filter((pair) => pair.quote === true && pair.open.length > 0)
      .map((pair) => pair.open),
  }
}

/**
 * Whether a pair may close directly before `char`.
 *
 * A bracket may also close before a quote where a quote may not: `("x")` is written by typing the
 * bracket in front of the literal, so refusing there would be refusing the ordinary case, while a
 * quote typed in front of a quote is a delimiter being replaced and a closer would only be in the way.
 */
function closesBefore(
  pair: EditorAutoClosingPair,
  delimiters: LiteralDelimiters,
  char: string,
): boolean {
  if (AUTO_CLOSE_BEFORE.has(char)) return true

  return !pair.quote && delimiters.quotes.includes(char)
}

/**
 * What the language makes of a harmless character standing where the typed one would go.
 *
 * Whether a quote opens a literal or ends the one the caret is already in cannot be read off the
 * characters around it, and scanning the line with that quote in place answers for a document the
 * user has not got — the quote would terminate the very run being asked about. A character the
 * language gives no meaning to leaves the runs as they are, so the only question left is which of
 * them owns the caret's position. That also settles the edges without a rule for each: an
 * unterminated literal owns the position at the end of the line, a closed one does not own the
 * position past its closer.
 *
 * The scan starts at the line, so a literal opened on an earlier row is invisible to it. Typing is
 * the one path where the work per keystroke has to be bounded, and searching back for an opener that
 * may be thousands of rows up is not.
 */
function tokenTypeAtCaret(
  delimiters: LiteralDelimiters,
  context: AutoCloseContext,
  neutral: string,
): AutoCloseTokenType {
  const probe = context.textBefore + neutral + context.textAfter
  const caret = context.textBefore.length
  let index = 0

  while (index < probe.length) {
    const start = index
    const quote = delimiters.quotes.find((candidate) => probe.startsWith(candidate, index))
    let type: AutoCloseTokenType

    if (delimiters.block && probe.startsWith(delimiters.block.open, index)) {
      index = offsetPast(probe, index + delimiters.block.open.length, delimiters.block.close)
      type = 'comment'
    } else if (delimiters.line && probe.startsWith(delimiters.line, index)) {
      index = probe.length
      type = 'comment'
    } else if (quote !== undefined && !continuesWord(probe, index)) {
      index = offsetPastQuoted(probe, index, quote)
      type = 'string'
    } else {
      index += 1
      continue
    }

    if (start <= caret && caret < index) return type
  }

  return 'other'
}

/**
 * Whether a delimiter standing here is really the tail of a word.
 *
 * `It's` in markup text content is the case that matters: read as a literal still being typed, that
 * apostrophe owns the rest of the line and every pair typed after it is refused. A literal does not
 * open against a word character — which is the reading `shouldAutoClose` already applies to the
 * apostrophe as it is typed, so the two agree on `don't` whether the caret is before it or after it.
 *
 * A prefixed literal does open against one: a tagged template, a Python f-string. Those read as
 * ordinary text here, which costs a pair offered inside a literal on the row that opens it, against
 * a suppression withheld on every line of prose that contains an apostrophe.
 */
function continuesWord(text: string, index: number): boolean {
  return isWordCharacter(text[index - 1] ?? null)
}

/**
 * A character to stand in for the typed one, chosen so the scan reads it as ordinary text.
 *
 * It has to appear in none of the delimiters, the pair's own included, or the stand-in could complete
 * one and invent the run it was meant to leave undisturbed. Digits are preferred because a language
 * whose delimiters are words is one an embedder can register, and letters are what those are made of.
 */
function neutralCharacter(
  pair: EditorAutoClosingPair,
  delimiters: LiteralDelimiters,
): string | undefined {
  const reserved =
    pair.open +
    pair.close +
    delimiters.quotes.join('') +
    (delimiters.line ?? '') +
    (delimiters.block?.open ?? '') +
    (delimiters.block?.close ?? '')

  return [...NEUTRAL_CHARACTERS].find((char) => !reserved.includes(char))
}

/** Just past `token`, or the end of the line for a run nothing closes. */
function offsetPast(text: string, from: number, token: string): number {
  const found = text.indexOf(token, from)

  return found === -1 ? text.length : found + token.length
}

/**
 * Just past the closing delimiter, or the end of the line for a run nothing closes.
 *
 * An unpartnered delimiter reads as a string still being typed, which is what it is in a language
 * whose quotes only ever delimit strings. An apostrophe in markup text content would read the same
 * way and suppress auto-close for the rest of that line, which is why the scan above never brings
 * one that continues a word this far.
 */
function offsetPastQuoted(text: string, from: number, quote: string): number {
  for (let index = from + quote.length; index < text.length; index += 1) {
    // A backslash spends the character behind it, delimiter or not.
    if (text[index] === '\\') index += 1
    else if (text.startsWith(quote, index)) return index + quote.length
  }

  return text.length
}

function isQuoteDelimiter(languageId: string | null | undefined, text: string): boolean {
  return autoClosingPairsForLanguage(languageId).some(
    (pair) => pair.quote === true && pair.open === text,
  )
}

function isWordCharacter(char: string | null): boolean {
  if (char === null) return false

  return /[\p{L}\p{N}_$]/u.test(char)
}
