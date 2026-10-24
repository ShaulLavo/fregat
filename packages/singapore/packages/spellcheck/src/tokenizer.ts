export type SpellTextRange = {
  readonly start: number
  readonly end: number
}

export type SpellWord = SpellTextRange & {
  /** The word as the dictionary is asked about it: typographic apostrophes folded to `'`. */
  readonly word: string
}

/**
 * `prose` checks words as written and skips anything shaped like an identifier. `code` is for
 * comments and strings: it splits camelCase and snake_case and checks each part.
 */
export type SpellTokenizeMode = 'prose' | 'code'

export type SpellTokenizeOptions = {
  readonly mode?: SpellTokenizeMode
  /** Ranges never checked, such as inline replacements. Offsets are relative to the text. */
  readonly excluded?: readonly SpellTextRange[]
}

const MIN_PROSE_LENGTH = 2
// cSpell's default for code: shorter camelCase parts are mostly abbreviations.
const MIN_CODE_PART_LENGTH = 4
const MAX_STRUCTURED_LENGTH = 256
// Skip generated/minified lines before reading or caching their text on each keystroke.
export const MAX_SPELLCHECK_LINE_LENGTH = 16_384

const URL_PATTERN = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()"'`]+/gi
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const PATH_PATTERN = /(?:[\w.~@-]*[/\\])+[\w.@-]*/g
const DOTTED_PATTERN = /[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)+/gu
const RUN_PATTERN = /[\p{L}\p{M}\p{N}_'’]+/gu
const EDGE_APOSTROPHES = /^['’]+|['’]+$/g
const ENGLISH_WORD = /^[a-zA-Z]+(?:['’][a-zA-Z]+)*$/
const CAMEL_PART = /[A-Z]{2,}(?![a-z])|[A-Z]?[a-z]+(?:['’][a-z]+)*/g

/** Finds the words to check in `text`, with offsets relative to it. */
export function tokenizeSpellWords(
  text: string,
  options: SpellTokenizeOptions = {},
): readonly SpellWord[] {
  const words: SpellWord[] = []
  const excluded = sortedRanges(options.excluded ?? [])
  let cursor = 0
  for (const chunk of text.matchAll(/\S+/g)) {
    if (chunk[0].length > MAX_STRUCTURED_LENGTH) continue
    cursor = advancePast(excluded, cursor, chunk.index)
    const local = chunkExclusions(excluded, cursor, chunk.index, chunk[0].length)
    for (const word of tokenizeChunk(chunk[0], { ...options, excluded: local })) {
      words.push({ ...word, start: word.start + chunk.index, end: word.end + chunk.index })
    }
  }
  return words
}

function chunkExclusions(
  ranges: readonly SpellTextRange[],
  cursor: number,
  start: number,
  length: number,
): readonly SpellTextRange[] {
  const local: SpellTextRange[] = []
  for (let index = cursor; index < ranges.length; index++) {
    const range = ranges[index]!
    if (range.start >= start + length) break
    local.push({ start: range.start - start, end: range.end - start })
  }
  return local
}

function tokenizeChunk(text: string, options: SpellTokenizeOptions): readonly SpellWord[] {
  const skipped = sortedRanges((options.excluded ?? []).concat(structuredRanges(text)))
  const mode = options.mode ?? 'prose'
  const words: SpellWord[] = []
  let cursor = 0

  for (const match of text.matchAll(RUN_PATTERN)) {
    const run = trimmedRun(match[0], match.index)
    if (!run) continue
    cursor = advancePast(skipped, cursor, run.start)
    if (overlapsFrom(skipped, cursor, run)) continue
    if (mode === 'code') words.push(...codeWords(run))
    else pushProseWord(words, run)
  }

  return words
}

type Run = SpellTextRange & { readonly text: string }

function trimmedRun(raw: string, index: number): Run | null {
  const leading = raw.length - raw.replace(/^['’]+/, '').length
  const text = raw.replace(EDGE_APOSTROPHES, '')
  if (text.length === 0) return null
  const start = index + leading
  return { start, end: start + text.length, text }
}

function pushProseWord(words: SpellWord[], run: Run): void {
  if (run.text.length < MIN_PROSE_LENGTH) return
  if (!ENGLISH_WORD.test(run.text)) return
  if (isAcronym(run.text) || isCamelCase(run.text)) return
  words.push({ start: run.start, end: run.end, word: foldApostrophes(run.text) })
}

function codeWords(run: Run): readonly SpellWord[] {
  // The bundled English policy only submits ASCII letters and supported apostrophes.
  if (/[^\p{N}_'’a-zA-Z]/u.test(run.text)) return []

  const words: SpellWord[] = []
  for (const part of run.text.matchAll(CAMEL_PART)) {
    const text = part[0]
    if (text.length < MIN_CODE_PART_LENGTH || isAcronym(text)) continue
    const start = run.start + part.index
    words.push({ start, end: start + text.length, word: foldApostrophes(text) })
  }
  return words
}

function isAcronym(word: string): boolean {
  return !/[a-z]/.test(word)
}

/** An upper-case letter after the first one: `useState`, `iPhone`, `McDonald`. */
function isCamelCase(word: string): boolean {
  return /[A-Z]/.test(word.slice(1))
}

export function foldApostrophes(word: string): string {
  return word.replaceAll('’', "'")
}

function structuredRanges(text: string): readonly SpellTextRange[] {
  const ranges: SpellTextRange[] = []
  for (const pattern of [URL_PATTERN, EMAIL_PATTERN, PATH_PATTERN, DOTTED_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return ranges
}

function sortedRanges(ranges: readonly SpellTextRange[]): readonly SpellTextRange[] {
  return ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start)
}

/** Runs arrive in order, so ranges that end before one can never overlap a later one. */
function advancePast(ranges: readonly SpellTextRange[], cursor: number, offset: number): number {
  let next = cursor
  while (next < ranges.length && (ranges[next]?.end ?? 0) <= offset) next++
  return next
}

function overlapsFrom(
  ranges: readonly SpellTextRange[],
  cursor: number,
  run: SpellTextRange,
): boolean {
  for (let index = cursor; index < ranges.length; index++) {
    const range = ranges[index]
    if (!range || range.start >= run.end) return false
    if (range.end > run.start) return true
  }
  return false
}
