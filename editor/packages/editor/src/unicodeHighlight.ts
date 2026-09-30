import type { TextContent } from './textContent'
import { clampTextOffset, type TextOffsetRange, wordRangeAtOffset } from './textRanges'
import { CONFUSABLE_CODE_POINT_DATA, INVISIBLE_CODE_POINT_DATA } from './unicodeHighlightData'

/**
 * Characters that read as something they are not.
 *
 * Two families, one scan. A confusable character draws the same as an ASCII one, so the Cyrillic а
 * in `pаssword` names a different identifier than the one the reviewer read. An invisible one draws
 * nothing at all, so a bidirectional override can reorder a line until the code the compiler sees
 * and the line the reviewer sees disagree. Both are how hostile source survives review, which is
 * why this is something the editor points at rather than something it renders faithfully and
 * leaves at that.
 */

export type SuspiciousCharacterKind = 'ambiguous' | 'invisible'

export type SuspiciousCharacterRange = TextOffsetRange & {
  readonly kind: SuspiciousCharacterKind
}

export type EditorSuspiciousCharactersOptions = {
  readonly ambiguous?: boolean
  readonly invisible?: boolean
  /**
   * Natural languages the text is allowed to be written in. Each one excuses the confusables its
   * own script needs, so a file of Russian identifiers stops reporting its Cyrillic а while the
   * fullwidth Latin ａ — which no language needs — keeps reporting everywhere.
   *
   * Naming several excuses what any one of them writes ordinarily.
   */
  readonly allowedLocales?: readonly string[]
  /** Code points this document may use whatever they look like. */
  readonly allowedCodePoints?: readonly number[]
}

export type ResolvedSuspiciousCharactersOptions = {
  readonly ambiguous: boolean
  readonly invisible: boolean
  readonly allowedLocales: readonly string[]
  readonly allowedCodePoints: readonly number[]
}

/** Both families report until a host says otherwise: an attack nobody enabled the check for wins. */
const DEFAULT_SUSPICIOUS_CHARACTERS: ResolvedSuspiciousCharactersOptions = {
  ambiguous: true,
  invisible: true,
  allowedLocales: [],
  allowedCodePoints: [],
}

/** The bucket every locale is measured against, and the one that answers when none was named. */
const COMMON_BUCKET = '_common'
const DEFAULT_BUCKET = '_default'

type SuspiciousCharacterTables = {
  readonly confusable: ReadonlySet<number>
  readonly invisible: ReadonlySet<number>
}

let confusableBuckets: ReadonlyMap<string, readonly number[]> | null = null
let invisibleCodePoints: ReadonlySet<number> | null = null
// Resolving a locale list walks the whole common bucket, and a scan asks for the tables once per
// row it rebuilds; the answer depends on nothing but the list, so it is worked out once per list.
const tablesByLocaleKey = new Map<string, SuspiciousCharacterTables>()

export function normalizeSuspiciousCharactersOptions(
  input: EditorSuspiciousCharactersOptions | undefined,
): ResolvedSuspiciousCharactersOptions {
  if (!input) return DEFAULT_SUSPICIOUS_CHARACTERS

  return {
    ambiguous: input.ambiguous ?? DEFAULT_SUSPICIOUS_CHARACTERS.ambiguous,
    invisible: input.invisible ?? DEFAULT_SUSPICIOUS_CHARACTERS.invisible,
    allowedLocales: normalizedLocales(input.allowedLocales),
    allowedCodePoints: normalizedCodePoints(input.allowedCodePoints),
  }
}

/**
 * Compares what two settings mean rather than which objects they are, because the shape a host
 * rebuilds inline on every render is never the same object twice and re-applying it would overrule
 * whatever was set in between.
 */
export function sameSuspiciousCharactersOptions(
  left: EditorSuspiciousCharactersOptions | undefined,
  right: EditorSuspiciousCharactersOptions | undefined,
): boolean {
  const resolvedLeft = normalizeSuspiciousCharactersOptions(left)
  const resolvedRight = normalizeSuspiciousCharactersOptions(right)
  if (resolvedLeft.ambiguous !== resolvedRight.ambiguous) return false
  if (resolvedLeft.invisible !== resolvedRight.invisible) return false
  if (!sameList(resolvedLeft.allowedLocales, resolvedRight.allowedLocales)) return false

  return sameList(resolvedLeft.allowedCodePoints, resolvedRight.allowedCodePoints)
}

export function suspiciousCharactersEnabled(options: ResolvedSuspiciousCharactersOptions): boolean {
  return options.ambiguous || options.invisible
}

/**
 * Every suspicious character in `text`, or in the slice of it `range` names.
 *
 * The range exists because a row of a long line mounts only the columns on screen, and a column
 * that is not mounted has no geometry a marker could be drawn against. Word context is still read
 * from the whole text: the word a character sits in is what decides whether it is worth reporting,
 * and that word does not stop at the edge of the viewport.
 */
export function suspiciousCharacterRanges(
  text: TextContent,
  options: ResolvedSuspiciousCharactersOptions,
  range?: TextOffsetRange,
): readonly SuspiciousCharacterRange[] {
  if (!suspiciousCharactersEnabled(options)) return []

  const end = clampTextOffset(text, range ? range.end : text.length)
  const allowed = new Set(options.allowedCodePoints)
  const tables = suspiciousCharacterTables(options.allowedLocales)
  const ranges: SuspiciousCharacterRange[] = []
  let index = codePointStartAt(text, clampTextOffset(text, range ? range.start : 0))
  while (index < end) {
    const codePoint = text.codePointAt(index) ?? 0
    // A pair that opens just inside the range closes just outside it, and half a code point is not
    // a character anyone can be shown.
    const size = codePoint > 0xffff ? 2 : 1
    const kind = suspiciousKindAt(text, index, codePoint, options, allowed, tables)
    if (kind) ranges.push({ start: index, end: index + size, kind })
    index += size
  }

  return ranges
}

function suspiciousKindAt(
  text: TextContent,
  index: number,
  codePoint: number,
  options: ResolvedSuspiciousCharactersOptions,
  allowed: ReadonlySet<number>,
  tables: SuspiciousCharacterTables,
): SuspiciousCharacterKind | null {
  if (isPlainAsciiCodePoint(codePoint)) return null
  if (allowed.has(codePoint)) return null

  const kind = candidateKind(codePoint, options, tables)
  if (!kind) return null
  // Asked last because reading the surrounding word costs more than either table lookup, and only
  // a character one of them already claimed can be excused.
  if (isExcusedByItsWord(text, index, tables)) return null

  return kind
}

function candidateKind(
  codePoint: number,
  options: ResolvedSuspiciousCharactersOptions,
  tables: SuspiciousCharacterTables,
): SuspiciousCharacterKind | null {
  if (options.invisible && tables.invisible.has(codePoint)) return 'invisible'
  if (options.ambiguous && tables.confusable.has(codePoint)) return 'ambiguous'

  return null
}

/**
 * A character is left alone when the word around it is plainly not written in Latin script.
 *
 * Cyrillic or Greek prose is not an attack on anything, and marking every letter of it is what
 * makes a security feature the first thing its user switches off. The tell is the mix rather than
 * the script: a word with no ASCII in it has no ASCII word to be mistaken for, while `pаssword` is
 * ASCII with one letter swapped and that letter is the whole of the attack. So both have to hold —
 * nothing ASCII anywhere in the word, and at least one character too foreign to imitate anything.
 */
function isExcusedByItsWord(
  text: TextContent,
  index: number,
  tables: SuspiciousCharacterTables,
): boolean {
  const word = wordRangeAtOffset(text, index)
  // A character no word claims — punctuation, or the gap between two words — is judged alone. The
  // helper answers such a position with the word before it, which has nothing to say about it.
  if (word.end <= index) return false

  let hasAscii = false
  let hasUnmistakable = false
  for (let cursor = word.start; cursor < word.end;) {
    const codePoint = text.codePointAt(cursor) ?? 0
    cursor += codePoint > 0xffff ? 2 : 1
    if (isPlainAsciiCodePoint(codePoint)) {
      hasAscii = true
      continue
    }
    if (tables.confusable.has(codePoint)) continue
    if (tables.invisible.has(codePoint)) continue

    hasUnmistakable = true
  }

  return !hasAscii && hasUnmistakable
}

/**
 * Printable ASCII and the three characters that lay text out. Skipping them is what makes an
 * English-language file cost one range check per character, and it is also what keeps a carriage
 * return out of the invisible family: where a line ends is the buffer's business, decided when the
 * text was read in, and a stray one is left over from that rather than hidden by anyone.
 */
function isPlainAsciiCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true
  return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
}

/** Back up onto the high surrogate a range edge landed after, so the pair is read as one. */
function codePointStartAt(text: TextContent, index: number): number {
  if (index <= 0) return index
  const code = text.charCodeAt(index)
  if (code < 0xdc00 || code > 0xdfff) return index

  const previous = text.charCodeAt(index - 1)
  return previous >= 0xd800 && previous <= 0xdbff ? index - 1 : index
}

function suspiciousCharacterTables(allowedLocales: readonly string[]): SuspiciousCharacterTables {
  const key = allowedLocales.join(',')
  const cached = tablesByLocaleKey.get(key)
  if (cached) return cached

  const tables: SuspiciousCharacterTables = {
    confusable: confusableCodePoints(allowedLocales),
    invisible: (invisibleCodePoints ??= new Set(JSON.parse(INVISIBLE_CODE_POINT_DATA) as number[])),
  }
  tablesByLocaleKey.set(key, tables)
  return tables
}

/**
 * What is still confusable once every allowed locale has had its say.
 *
 * Each bucket lists what stays suspicious under that language, so intersecting them leaves only
 * what every allowed language finds suspicious: declaring both Japanese and Russian excuses
 * whatever either of them writes without a second thought. The common bucket joins on top because
 * nothing excuses a fullwidth Latin letter in source code.
 */
function confusableCodePoints(allowedLocales: readonly string[]): ReadonlySet<number> {
  const buckets = (confusableBuckets ??= new Map(
    Object.entries(JSON.parse(CONFUSABLE_CODE_POINT_DATA) as Record<string, number[]>),
  ))
  const [first, ...rest] = allowedLocales.filter((locale) => buckets.has(locale))
  const codePoints = new Set(buckets.get(COMMON_BUCKET) ?? [])
  if (first === undefined) {
    for (const codePoint of buckets.get(DEFAULT_BUCKET) ?? []) codePoints.add(codePoint)
    return codePoints
  }

  for (const codePoint of buckets.get(first) ?? []) {
    if (rest.every((locale) => buckets.get(locale)?.includes(codePoint))) codePoints.add(codePoint)
  }

  return codePoints
}

function normalizedLocales(locales: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(locales)) return DEFAULT_SUSPICIOUS_CHARACTERS.allowedLocales
  return locales.filter((locale) => typeof locale === 'string' && locale.length > 0)
}

function normalizedCodePoints(codePoints: readonly number[] | undefined): readonly number[] {
  if (!Array.isArray(codePoints)) return DEFAULT_SUSPICIOUS_CHARACTERS.allowedCodePoints
  return codePoints.filter((codePoint) => Number.isInteger(codePoint))
}

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
