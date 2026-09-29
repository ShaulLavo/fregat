import type { TextContent } from './textContent'
import { nextGraphemeBoundary, previousGraphemeBoundary } from './graphemes'

export type TextOffsetRange = {
  readonly start: number
  readonly end: number
}

export type TextCharacterClass = 'word' | 'space' | 'punctuation' | 'newline'

const WORD_PATTERN = /^[\p{L}\p{N}_]$/u

/**
 * The characters that end a word for cursor motion.
 *
 * Naming the separators rather than testing for letters and digits makes every script we did not
 * think to enumerate — CJK, Cyrillic, emoji, currency signs — word material by default, and lets a
 * language whose identifiers carry a sigil keep that sigil attached by dropping it from its list.
 */
const DEFAULT_WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'

const WORD_SEPARATORS_BY_LANGUAGE: Record<string, string> = {
  // `--brand-color`, `@media` and `#fff` are each one name to anyone editing a stylesheet.
  css: '`~!$%^&*()=+[{]}\\|;:\'",.<>/?',
  scss: '`~!$%^&*()=+[{]}\\|;:\'",.<>/?',
}

export function wordSeparatorsForLanguage(languageId: string | null | undefined): string {
  if (!languageId) return DEFAULT_WORD_SEPARATORS
  return WORD_SEPARATORS_BY_LANGUAGE[languageId] ?? DEFAULT_WORD_SEPARATORS
}

export function clampTextOffset(text: TextContent, offset: number): number {
  return Math.min(Math.max(0, offset), text.length)
}

export function clampTextOffsetRange(text: TextContent, range: TextOffsetRange): TextOffsetRange {
  return {
    start: clampTextOffset(text, range.start),
    end: clampTextOffset(text, range.end),
  }
}

export function compareTextOffsetRanges(left: TextOffsetRange, right: TextOffsetRange): number {
  return left.start - right.start || left.end - right.end
}

export function normalizeTextOffsetRanges(
  text: TextContent,
  ranges: readonly TextOffsetRange[],
): readonly TextOffsetRange[] {
  return ranges
    .map((range) => clampTextOffsetRange(text, range))
    .filter((range) => range.start <= range.end)
    .toSorted(compareTextOffsetRanges)
}

export function lineRangeAtOffset(text: string, rawOffset: number): TextOffsetRange {
  const offset = clampTextOffset(text, rawOffset)
  // Clamping the backward search to 0 instead would let a leading line break — which sits behind no
  // character at all — answer for offset 0 and report the second line as the caret's own.
  const lineStart = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
  const nextLineBreak = text.indexOf('\n', offset)
  const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak
  return { start: lineStart, end: lineEnd }
}

export function previousCodePointOffset(text: TextContent, offset: number): number {
  return previousGraphemeBoundary(text, clampTextOffset(text, offset))
}

export function previousCodePointStart(text: TextContent, offset: number): number | null {
  if (offset <= 0) return null
  return previousCodePointOffset(text, offset)
}

export function nextCodePointOffset(text: TextContent, offset: number): number {
  return nextGraphemeBoundary(text, clampTextOffset(text, offset))
}

export function codePointSizeAt(text: TextContent, offset: number): number {
  const codePoint = text.codePointAt(offset)
  if (codePoint === undefined) return 0
  return codePoint > 0xffff ? 2 : 1
}

export function isWordCodePointAt(text: TextContent, offset: number): boolean {
  const codePoint = text.codePointAt(offset)
  if (codePoint === undefined) return false
  // ASCII is answered from the code point: a whole-word search asks this twice per
  // raw match, and a one-character string plus a property-class test is most of it.
  if (codePoint < 0x80) return isAsciiWordCodePoint(codePoint)
  return WORD_PATTERN.test(String.fromCodePoint(codePoint))
}

function isAsciiWordCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x61) return codePoint <= 0x7a
  if (codePoint >= 0x41) return codePoint <= 0x5a || codePoint === 0x5f
  return codePoint >= 0x30 && codePoint <= 0x39
}

export function isWordCodePointBefore(text: TextContent, offset: number): boolean {
  const previous = previousCodePointStart(text, offset)
  return previous !== null && isWordCodePointAt(text, previous)
}

export function characterClassAt(
  text: TextContent,
  offset: number,
  separators: string = DEFAULT_WORD_SEPARATORS,
): TextCharacterClass {
  const codePoint = text.codePointAt(offset)
  if (codePoint === undefined) return 'space'
  if (codePoint === 0x0a) return 'newline'

  const character = String.fromCodePoint(codePoint)
  if (/\s/u.test(character)) return 'space'
  if (separators.includes(character)) return 'punctuation'
  return 'word'
}

export function previousWordOffset(text: TextContent, offset: number, separators?: string): number {
  const cursor = skipBackward(text, clampTextOffset(text, offset), 'space', separators)
  const runClass = runClassAt(text, previousCodePointOffset(text, cursor), separators)
  if (runClass === null) return cursor

  return skipBackward(text, cursor, runClass, separators)
}

export function nextWordOffset(text: TextContent, offset: number, separators?: string): number {
  const cursor = skipForward(text, clampTextOffset(text, offset), 'space', separators)
  const runClass = runClassAt(text, cursor, separators)
  if (runClass === null) return cursor

  return skipForward(text, skipForward(text, cursor, runClass, separators), 'space', separators)
}

/** Where the previous word ends, leaving the whitespace in front of it for the caret to sit on. */
export function previousWordEndOffset(
  text: TextContent,
  offset: number,
  separators?: string,
): number {
  const cursor = clampTextOffset(text, offset)
  const beforeSpace = skipBackward(text, cursor, 'space', separators)
  if (beforeSpace !== cursor) return beforeSpace

  const runClass = runClassAt(text, previousCodePointOffset(text, cursor), separators)
  if (runClass === null) return cursor

  return skipBackward(text, skipBackward(text, cursor, runClass, separators), 'space', separators)
}

/** Where the next word begins, once the caret's run and the whitespace after it are skipped. */
export function nextWordStartOffset(
  text: TextContent,
  offset: number,
  separators?: string,
): number {
  const cursor = clampTextOffset(text, offset)
  const runClass = runClassAt(text, cursor, separators)
  if (runClass === null) return cursor

  return skipForward(text, skipForward(text, cursor, runClass, separators), 'space', separators)
}

export function wordRangeAtOffset(text: TextContent, rawOffset: number): TextOffsetRange {
  const offset = clampTextOffset(text, rawOffset)
  const probeOffset = wordProbeOffset(text, offset)
  if (probeOffset === null) return { start: offset, end: offset }

  let start = probeOffset
  let end = probeOffset + codePointSizeAt(text, probeOffset)

  while (start > 0) {
    const previous = previousCodePointStart(text, start)
    if (previous === null || !isWordCodePointAt(text, previous)) break
    start = previous
  }

  while (end < text.length && isWordCodePointAt(text, end)) {
    end = nextCodePointOffset(text, end)
  }

  return { start, end }
}

export function isWholeWordRange(text: TextContent, range: TextOffsetRange): boolean {
  const start = clampTextOffset(text, range.start)
  const end = clampTextOffset(text, range.end)
  if (start > end) return false

  const length = end - start
  return leftIsWordBoundary(text, start, length) && rightIsWordBoundary(text, end, length)
}

/**
 * The class of the run a word scan may consume, or null at a line break.
 *
 * Motion that runs past a line break puts the caret on a line the reader was not looking at, and
 * because no scan is ever asked for a run of newlines, refusing the class here is the whole guard.
 */
function runClassAt(
  text: TextContent,
  offset: number,
  separators?: string,
): TextCharacterClass | null {
  const characterClass = characterClassAt(text, offset, separators)
  return characterClass === 'newline' ? null : characterClass
}

function skipBackward(
  text: TextContent,
  offset: number,
  targetClass: TextCharacterClass,
  separators?: string,
): number {
  let cursor = offset

  while (cursor > 0) {
    const previous = previousCodePointOffset(text, cursor)
    if (characterClassAt(text, previous, separators) !== targetClass) return cursor
    cursor = previous
  }

  return cursor
}

function skipForward(
  text: TextContent,
  offset: number,
  targetClass: TextCharacterClass,
  separators?: string,
): number {
  let cursor = offset

  while (cursor < text.length) {
    if (characterClassAt(text, cursor, separators) !== targetClass) return cursor
    cursor = nextCodePointOffset(text, cursor)
  }

  return cursor
}

function wordProbeOffset(text: TextContent, offset: number): number | null {
  if (offset < text.length && isWordCodePointAt(text, offset)) return offset

  const previous = previousCodePointStart(text, offset)
  if (previous !== null && isWordCodePointAt(text, previous)) return previous

  return null
}

function leftIsWordBoundary(text: TextContent, start: number, length: number): boolean {
  if (start === 0) return true
  if (!isWordCodePointBefore(text, start)) return true
  if (length === 0) return false
  return !isWordCodePointAt(text, start)
}

function rightIsWordBoundary(text: TextContent, end: number, length: number): boolean {
  if (end === text.length) return true
  if (!isWordCodePointAt(text, end)) return true
  if (length === 0) return false
  return !isWordCodePointBefore(text, end)
}

/**
 * Subword boundaries: the transitions inside an identifier that camelCase and snake_case create.
 *
 * `parseHTTPResponse` reads as parse | HTTP | Response, and `read_file_sync` as read | file | sync.
 * An acronym run ends one character before the capital that starts the next word, which is what
 * keeps `HTTPResponse` from being read as `HTTPR | esponse`.
 */
export function nextWordPartOffset(text: string, offset: number): number {
  const limit = text.length
  let cursor = clampTextOffset(text, offset)
  if (cursor >= limit) return limit

  // Step off any run of separators first, so a caret before '_' lands on the next word.
  while (cursor < limit && isSubwordSeparator(text[cursor])) cursor += 1
  if (cursor >= limit) return limit

  cursor += 1
  while (cursor < limit) {
    const char = text[cursor]
    if (char === undefined || isSubwordSeparator(char)) break
    if (startsSubword(text, cursor)) break

    cursor += 1
  }

  return cursor
}

export function previousWordPartOffset(text: string, offset: number): number {
  let cursor = clampTextOffset(text, offset)
  if (cursor <= 0) return 0

  cursor -= 1
  while (cursor > 0 && isSubwordSeparator(text[cursor])) cursor -= 1
  if (cursor <= 0) return 0

  while (cursor > 0) {
    if (isSubwordSeparator(text[cursor - 1])) break
    if (startsSubword(text, cursor)) break

    cursor -= 1
  }

  return cursor
}

/** True when `index` begins a new subword: a capital after lower, or a letter after a digit. */
function startsSubword(text: string, index: number): boolean {
  const previous = text[index - 1]
  const current = text[index]
  if (previous === undefined || current === undefined) return false
  if (!isUpper(current)) return isLetter(current) && isDigit(previous)
  if (isLower(previous)) return true
  if (isDigit(previous)) return true

  // Inside an acronym, the boundary is the capital that a lowercase letter follows: HTTP|Response.
  return isUpper(previous) && isLower(text[index + 1] ?? '')
}

function isSubwordSeparator(char: string | undefined): boolean {
  if (char === undefined) return false

  return !/[\p{L}\p{N}]/u.test(char)
}

const isUpper = (char: string) => /\p{Lu}/u.test(char)
const isLower = (char: string) => /\p{Ll}/u.test(char)
const isDigit = (char: string) => /\p{Nd}/u.test(char)
const isLetter = (char: string) => /\p{L}/u.test(char)
