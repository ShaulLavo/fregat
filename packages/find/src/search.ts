import {
  codePointSizeAt,
  compareTextOffsetRanges,
  isWholeWordRange,
  type TextOffsetRange,
  type TextReadSnapshot,
} from '@singapore-editor/core/document'

// Bounds the match set the widget counts and paints, so a pathological query
// on a huge file cannot stall the frame.
export const FIND_MATCHES_LIMIT = 19_999

// Replace All must never apply to a truncated match set: stopping early would
// silently rewrite part of the document and leave the rest, with no signal to
// the user. Searching is linear, so the only real cost of lifting the cap here
// is the edit batch itself.
export const FIND_REPLACE_ALL_LIMIT = 1_073_741_824

// How much text a windowed scan reads at once, rounded up to whole lines. Large
// enough that the tree descent per read is noise, small enough that a fragmented
// document is never joined into one string the size of the file.
export const FIND_WINDOW_UNITS = 65_536

// Escapes whose class cannot hold a line break, so a pattern built only from
// these can be answered a line at a time. A carriage return is among them: it
// sits inside a line, not between two.
const LINE_SAFE_ESCAPES = new Set(['d', 'w', 't', 'r', 'f', 'v', 'b', 'B', '0'])

export type FindRange = TextOffsetRange

// Read-only line-start access, structurally the view a document snapshot
// already hands out, so a search never asks for the array behind it.
export type FindLineStartsView = {
  readonly length: number
  at(index: number): number | undefined
  indexForOffset(offset: number): number
}

/**
 * The text a search reads, in ranges rather than as one string.
 *
 * A query that cannot match a line break is answered a line at a time, so a
 * keystroke in the find box costs the lines examined instead of a copy of the
 * whole document — and a chunked buffer gets searched where it lies.
 */
export type FindTextSource = {
  readonly length: number
  readRange(start: number, end: number): string
  readonly lineStartsView: FindLineStartsView
}

export function findTextSourceFromSnapshot(snapshot: TextReadSnapshot): FindTextSource {
  return {
    length: snapshot.length,
    readRange: (start, end) => snapshot.readRange(start, end),
    lineStartsView: {
      length: snapshot.lineCount,
      at: (index) =>
        index < 0 || index >= snapshot.lineCount ? undefined : snapshot.lineStart(index),
      indexForOffset: (offset) => snapshot.lineAt(offset),
    },
  }
}

export type FindQuery = {
  readonly searchString: string
  readonly isRegex: boolean
  readonly matchCase: boolean
  readonly wholeWord: boolean
}

export type FindMatch = FindRange & {
  readonly matches: readonly string[] | null
}

export type FindMatchFromOptions = {
  readonly captureMatches?: boolean
  readonly loop?: boolean
  readonly escapeEmptyMatchAtOffset?: boolean
}

/** What the two directions have in common, so one caller can hold either. */
export type FindMatchFromSearcher = (
  source: FindTextSource,
  query: FindQuery,
  offset: number,
  ranges: readonly FindRange[] | null,
  options: FindMatchFromOptions,
) => FindMatch | null

type CompiledFindQuery = {
  readonly regex: RegExp
  // Non-null only when a plain indexOf over the untouched text is exactly
  // equivalent to the regex; see compileFindQuery.
  readonly simpleSearch: string | null
  readonly wholeWord: boolean
  readonly plan: FindQueryPlan
}

/**
 * How much text one match can depend on, which is what decides how it is read.
 *
 * `lines` and `anchored-lines` cannot match a break, so they are read in windows
 * of whole lines. `literal-lines` is a literal holding breaks: it spans a known
 * number of lines, so it is windowed too. `range` is every pattern nothing here
 * can bound, read as one window because that is the only reading always correct.
 */
export type FindQueryPlan =
  | { readonly kind: 'lines' }
  | { readonly kind: 'anchored-lines' }
  | { readonly kind: 'literal-lines'; readonly lineBreaks: number }
  | { readonly kind: 'range'; readonly reason: 'pattern-may-match-line-break' }

// One stretch of the document already read: the text of
// `[start, start + text.length)`, to be searched from `from` onward.
type FindWindow = {
  readonly text: string
  readonly start: number
  readonly from: number
}

export function findMatches(
  source: FindTextSource,
  query: FindQuery,
  ranges: readonly FindRange[] | null = null,
  captureMatches = false,
  limit = FIND_MATCHES_LIMIT,
): readonly FindMatch[] {
  const compiled = compileFindQuery(query)
  if (!compiled || limit <= 0) return []

  const matches: FindMatch[] = []
  const collect: FindMatchVisitor = (start, end, captures) => {
    matches.push({ start, end, matches: captures })
    return matches.length < limit
  }
  for (const range of searchRanges(source, ranges)) {
    scanRange(source, compiled, range, captureMatches, collect)
    if (matches.length >= limit) break
  }

  return matches
}

/**
 * Every match counted, none kept: a total costs no record per match.
 *
 * With `before`, only the matches starting in front of that offset, which is the
 * position of a match the listing stopped short of.
 */
export function countMatches(
  source: FindTextSource,
  query: FindQuery,
  ranges: readonly FindRange[] | null = null,
  before = Number.POSITIVE_INFINITY,
): number {
  const compiled = compileFindQuery(query)
  if (!compiled) return 0

  let count = 0
  const tally: FindMatchVisitor = (start) => {
    if (start >= before) return false

    count += 1
    return true
  }
  for (const range of searchRanges(source, ranges)) {
    if (range.start >= before) break
    scanRange(source, compiled, range, false, tally)
  }

  return count
}

/** Null for a query that cannot be compiled, which is one that finds nothing. */
export function findQueryPlan(query: FindQuery): FindQueryPlan | null {
  return compileFindQuery(query)?.plan ?? null
}

/** The line holding `offset`, break excluded. */
export function findLineRange(source: FindTextSource, offset: number): FindRange {
  const index = source.lineStartsView.indexForOffset(offset)
  return { start: source.lineStartsView.at(index) ?? 0, end: lineEndAt(source, index) }
}

/**
 * One match, scanned for from an offset instead of picked out of a list.
 *
 * A listing stops at FIND_MATCHES_LIMIT, and past that every entry in it sits
 * behind the cursor: picking from it answers each press with the top of the
 * document. Scanning outward stops at the first match it reaches, so how far
 * navigation can go is not what a paint budget allowed.
 */
export function findNextMatchFrom(
  source: FindTextSource,
  query: FindQuery,
  offset: number,
  ranges: readonly FindRange[] | null = null,
  options: FindMatchFromOptions = {},
): FindMatch | null {
  const compiled = compileFindQuery(query)
  if (!compiled) return null

  const searched = searchRanges(source, ranges)
  const from = clampSourceOffset(source, offset)
  const ahead = firstMatchAfter(source, compiled, searched, from, options)
  if (ahead) return ahead
  if (options.loop === false) return null

  // Wrapping is a second bounded scan rather than a listing, so a cursor past
  // the last match still costs only the text up to the first one.
  return firstMatchAtOrAfter(source, compiled, searched, searched[0]?.start ?? 0, options)
}

export function findPreviousMatchFrom(
  source: FindTextSource,
  query: FindQuery,
  offset: number,
  ranges: readonly FindRange[] | null = null,
  options: FindMatchFromOptions = {},
): FindMatch | null {
  const compiled = compileFindQuery(query)
  if (!compiled) return null

  const searched = searchRanges(source, ranges)
  const from = clampSourceOffset(source, offset)
  const behind = lastMatchBefore(source, compiled, searched, from, options)
  if (behind) return behind
  if (options.loop === false) return null

  return lastMatchBefore(source, compiled, searched, source.length, {
    ...options,
    escapeEmptyMatchAtOffset: false,
  })
}

export function findMatchIndex(matches: readonly FindMatch[], range: FindRange): number {
  return matches.findIndex((match) => match.start === range.start && match.end === range.end)
}

export function escapeRegExpCharacters(value: string): string {
  return value.replace(/[\\{}*+?|^$.[\]()]/g, '\\$&')
}

// The break belongs to no line: a query that cannot match one would otherwise be
// handed a haystack whose `$` sits behind it.
function lineEndAt(source: FindTextSource, index: number): number {
  const nextLineStart = source.lineStartsView.at(index + 1)
  return nextLineStart === undefined ? source.length : nextLineStart - 1
}

function escapesEmptyMatch(match: FindMatch, offset: number, escape: boolean): boolean {
  return escape && match.start === match.end && match.start === offset
}

function firstMatchAfter(
  source: FindTextSource,
  query: CompiledFindQuery,
  ranges: readonly FindRange[],
  offset: number,
  options: FindMatchFromOptions,
): FindMatch | null {
  const found = firstMatchAtOrAfter(source, query, ranges, offset, options)
  if (!found) return null
  if (!escapesEmptyMatch(found, offset, options.escapeEmptyMatchAtOffset ?? false)) return found

  // Resumed past the offset itself, once: whatever stands there is the entry
  // after the one being escaped, empty or not.
  return firstMatchAtOrAfter(source, query, ranges, nextCodePointOffset(source, offset), options)
}

function firstMatchAtOrAfter(
  source: FindTextSource,
  query: CompiledFindQuery,
  ranges: readonly FindRange[],
  offset: number,
  options: FindMatchFromOptions,
): FindMatch | null {
  for (const range of ranges) {
    if (range.end < offset) continue

    const found = firstMatchInRange(source, query, range, offset, options.captureMatches ?? false)
    if (found) return found
  }

  return null
}

// The range is never cut at the offset: a pattern resumed there simply begins a
// fresh match at the cursor — 'pha' inside 'alpha' for `\w+` — and a range no
// listing of the document holds is one the reader was never shown and Replace
// must never rewrite. What the offset decides is which matches are kept, not
// where the scan starts. Uncapped, because what stands at the cursor is being
// asked for regardless of where the paint budget ran out.
function firstMatchInRange(
  source: FindTextSource,
  query: CompiledFindQuery,
  range: FindRange,
  offset: number,
  captureMatches: boolean,
): FindMatch | null {
  let found: FindMatch | null = null
  const scanned = { start: forwardScanStart(source, query, range, offset), end: range.end }
  scanRange(source, query, scanned, captureMatches, (start, end, captures) => {
    if (start < offset) return true

    found = { start, end, matches: captures }
    return false
  })

  return found
}

// Lines in front of the cursor are skipped rather than searched: a match that
// cannot hold a break cannot reach out of the line it starts on, so none of them
// could answer at or after the offset anyway.
function forwardScanStart(
  source: FindTextSource,
  query: CompiledFindQuery,
  range: FindRange,
  offset: number,
): number {
  if (!isLineLocalPlan(query.plan)) return range.start

  const lineStartsView = source.lineStartsView
  const line = lineStartsView.indexForOffset(Math.max(range.start, offset))
  return Math.max(range.start, lineStartsView.at(line) ?? 0)
}

function isLineLocalPlan(plan: FindQueryPlan): boolean {
  return plan.kind === 'lines' || plan.kind === 'anchored-lines'
}

function lastMatchBefore(
  source: FindTextSource,
  query: CompiledFindQuery,
  ranges: readonly FindRange[],
  offset: number,
  options: FindMatchFromOptions,
): FindMatch | null {
  for (const range of ranges.toReversed()) {
    if (range.start > offset) continue

    const found = lastMatchInRange(source, query, range, offset, options)
    if (found) return found
  }

  return null
}

// Walked back a window at a time, because the match before the cursor is the one
// being asked for and listing everything behind it to reach the last entry is
// the whole document on a search that started near its end.
function lastMatchInRange(
  source: FindTextSource,
  query: CompiledFindQuery,
  searched: FindRange,
  offset: number,
  options: FindMatchFromOptions,
): FindMatch | null {
  // A pattern that can run past a break is shown the text behind the cursor too:
  // cut at the cursor's line, `[^a]+$` would end there on a match no listing of
  // the document holds. The scan still stops at the first match past the cursor.
  if (!isLineLocalPlan(query.plan))
    return lastMatchInWindow(source, query, searched, offset, options)

  const range = { start: searched.start, end: Math.min(searched.end, offset) }
  const lineStartsView = source.lineStartsView
  let last = lineStartsView.indexForOffset(range.end)
  while (last >= 0) {
    const reach = Math.max(range.start, (lineStartsView.at(last) ?? 0) - FIND_WINDOW_UNITS)
    const first = lineStartsView.indexForOffset(reach)
    const firstStart = lineStartsView.at(first) ?? 0
    const window = {
      start: Math.max(range.start, firstStart),
      end: Math.min(range.end, lineEndAt(source, last)),
    }
    const found =
      window.end < window.start ? null : lastMatchInWindow(source, query, window, offset, options)
    if (found) return found
    if (firstStart <= range.start) return null

    last = first - 1
  }

  return null
}

// The last match in one window, escaping the same way stepping an ordered list
// does: what stands before a zero-width match parked on the cursor is the entry
// the search is being asked for, and it may be in an earlier window. Uncapped,
// and only the last two are kept: a listing that stopped at the paint cap would
// answer every press behind the cursor with the 19,999th match.
function lastMatchInWindow(
  source: FindTextSource,
  query: CompiledFindQuery,
  range: FindRange,
  offset: number,
  options: FindMatchFromOptions,
): FindMatch | null {
  let last: FindMatch | null = null
  let beforeLast: FindMatch | null = null
  scanRange(source, query, range, options.captureMatches ?? false, (start, end, captures) => {
    if (end > offset) return false

    beforeLast = last
    last = { start, end, matches: captures }
    return true
  })
  if (!last) return null
  if (!escapesEmptyMatch(last, offset, options.escapeEmptyMatchAtOffset ?? false)) return last

  return beforeLast
}

// A pattern compiled with the unicode flag may not be resumed inside a surrogate
// pair, so stepping off an empty match steps a code point rather than a unit.
function nextCodePointOffset(source: FindTextSource, offset: number): number {
  const text = source.readRange(offset, Math.min(source.length, offset + 2))
  return offset + Math.max(1, codePointSizeAt(text, 0))
}

// True when the query contains at least one character whose case can differ,
// which is the only situation where matchCase changes what a plain search
// finds. Digits, punctuation and CJK are caseless, so an untouched indexOf is
// still exact for them even with matchCase off.
function queryIsCaseSensitiveByContent(searchString: string): boolean {
  return searchString.toLowerCase() !== searchString.toUpperCase()
}

/**
 * Whether every part of a pattern is provably unable to match a line break.
 *
 * Asked the safe way round. Listing the constructs that CAN hold a break means
 * one nobody thought of routes a query to the windowed path, where it answers
 * "no results" for text that is plainly there — the one wrong answer a search
 * must never give. So a query is windowed only when every part of it is provably
 * break-free, and anything unrecognized takes the slower path that is always
 * correct.
 */
function isLineSafePattern(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '\n') return false
    if (char === '[') {
      const end = characterClassEnd(pattern, index)
      if (end === null || !isLineSafeCharacterClass(pattern.slice(index + 1, end))) return false

      index = end
      continue
    }

    if (char === '(' && !isLineSafeGroupOpener(pattern, index)) return false
    if (char !== '\\') continue

    index += 1
    const escaped = pattern[index]
    if (escaped === undefined) return false
    // A hex or unicode escape can spell the break itself, and reading which one
    // it spells is more machinery than routing it to the correct path costs.
    if (!LINE_SAFE_ESCAPES.has(escaped) && /[\p{L}\p{N}]/u.test(escaped)) return false
  }

  return true
}

/**
 * Only a group that bundles what is written inside it, leaving its meaning alone.
 *
 * A capture, a non-capture and either lookaround are all of those. A modifier
 * group is not: it can switch on the flag under which a dot spans a break, so the
 * characters inside it stop saying what they say anywhere else — and reading back
 * which flags one names is more machinery than routing it to the correct path
 * costs. Every other spelling is one nobody here recognized, which is the same
 * answer.
 */
function isLineSafeGroupOpener(pattern: string, index: number): boolean {
  if (pattern[index + 1] !== '?') return true

  const kind = pattern[index + 2]
  // '<' opens a lookbehind or names a capture, and neither changes what matches.
  return kind === ':' || kind === '=' || kind === '!' || kind === '<'
}

// Only a positive class naming its members outright: a negated one holds a break
// unless it names it, and an escape inside one can bring a whole class with it.
function isLineSafeCharacterClass(body: string): boolean {
  if (body.startsWith('^')) return false
  return !body.includes('\\') && !body.includes('\n')
}

function characterClassEnd(pattern: string, from: number): number | null {
  for (let index = from + 1; index < pattern.length; index += 1) {
    if (pattern[index] === '\\') index += 1
    else if (pattern[index] === ']') return index
  }

  return null
}

function compileFindQuery(query: FindQuery): CompiledFindQuery | null {
  if (query.searchString.length === 0) return null

  const source = query.isRegex ? query.searchString : escapeRegExpCharacters(query.searchString)
  const plan = planFindQuery(query)
  const lineCrossing = plan.kind === 'range' || plan.kind === 'literal-lines'
  // Flags describe the haystack, and only a line-crossing search is ever handed
  // one holding a break: a per-line slice bounds `^` and `$` by itself, so `m`
  // there would only claim breaks the slice does not contain.
  const flags = `g${query.matchCase ? '' : 'i'}${lineCrossing ? 'm' : ''}`

  // The fast path may never case-fold the haystack: folding is not
  // length-preserving (U+0130 'İ' lowercases to two code units), so an index
  // into folded text does not address the original text, and a match reported
  // from it slices the wrong characters — Replace would then overwrite them.
  // Fall back to the case-insensitive regex, which reports original indices.
  const canUseSimpleSearch =
    !query.isRegex && (query.matchCase || !queryIsCaseSensitiveByContent(query.searchString))

  const regex = compileRegex(source, flags)
  if (!regex) return null

  return {
    regex,
    simpleSearch: canUseSimpleSearch ? query.searchString : null,
    wholeWord: query.wholeWord,
    plan,
  }
}

function planFindQuery(query: FindQuery): FindQueryPlan {
  if (!query.isRegex) {
    const lineBreaks = query.searchString.split('\n').length - 1
    return lineBreaks === 0 ? { kind: 'lines' } : { kind: 'literal-lines', lineBreaks }
  }

  if (!isLineSafePattern(query.searchString))
    return { kind: 'range', reason: 'pattern-may-match-line-break' }
  return hasLineAnchor(query.searchString) ? { kind: 'anchored-lines' } : { kind: 'lines' }
}

// Asked of a pattern already known to be line-safe, so a class cannot be negated
// and a `^` inside one is a member rather than an anchor.
function hasLineAnchor(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '\\') index += 1
    else if (char === '[') index = characterClassEnd(pattern, index) ?? pattern.length
    else if (char === '^' || char === '$') return true
  }

  return false
}

/**
 * The pattern under the unicode flag where it takes it, and without it where it
 * does not.
 *
 * Wanted, because `u` is what makes a surrogate pair one character to a dot and
 * `\p{...}` mean anything at all. Not required, because its grammar rejects
 * spellings the flagless one accepts — an identity escape of a character that
 * needs none (`\-`, `\ `), a brace or bracket standing for itself, a legacy
 * back-reference — and every one of those is what escaping a search by hand
 * produces. A rejected pattern is not reported anywhere the user can see it: it
 * reaches them as "No results", indistinguishable from text that is not there.
 */
function compileRegex(source: string, flags: string): RegExp | null {
  try {
    return new RegExp(source, `${flags}u`)
  } catch {
    // Ignored: whether the pattern is invalid outright or only invalid under the
    // stricter grammar is what the second construction answers.
  }

  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

function searchRanges(
  source: FindTextSource,
  ranges: readonly FindRange[] | null,
): readonly FindRange[] {
  if (!ranges || ranges.length === 0) return [{ start: 0, end: source.length }]

  const clamped = ranges
    .map((range) => ({
      start: clampSourceOffset(source, range.start),
      end: clampSourceOffset(source, range.end),
    }))
    .filter((range) => range.start <= range.end)
    .toSorted(compareTextOffsetRanges)

  // Scopes are followed through edits, and an edit spanning the seam between two
  // of them leaves them overlapping. Searching both would report the text they
  // share twice, which a Replace All then tries to rewrite twice.
  const merged: FindRange[] = []
  for (const range of clamped) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) }
      continue
    }

    merged.push(range)
  }

  return merged
}

function clampSourceOffset(source: FindTextSource, offset: number): number {
  return Math.min(Math.max(0, offset), source.length)
}

// Visited in document order; false stops the scan where it stands.
type FindMatchVisitor = (start: number, end: number, captures: RegExpExecArray | null) => boolean

/** False once the range is spent or the visitor stopped: nothing later in it is read. */
function scanRange(
  source: FindTextSource,
  query: CompiledFindQuery,
  range: FindRange,
  captureMatches: boolean,
  visit: FindMatchVisitor,
): boolean {
  if (query.plan.kind === 'range')
    return scanWholeRange(source, query, range, captureMatches, visit)
  if (query.plan.kind === 'literal-lines')
    return scanSpanningLiteral(source, query, range, query.plan.lineBreaks, visit)

  return scanLines(source, query, range, captureMatches, visit)
}

// Whole lines, even where the range was cut inside one: the anchors and the word
// boundaries have to answer for the line the reader sees rather than for where
// the range happens to end, so the range only decides which matches are kept.
//
// Read many lines to a window. A match that cannot hold a break cannot leave its
// line, and a break is no word character, so a pattern with no `^` or `$` finds in
// the window exactly what it finds line by line, without a tree descent per line.
function scanLines(
  source: FindTextSource,
  query: CompiledFindQuery,
  range: FindRange,
  captureMatches: boolean,
  visit: FindMatchVisitor,
): boolean {
  const lineStartsView = source.lineStartsView
  let index = lineStartsView.indexForOffset(range.start)
  while (index < lineStartsView.length) {
    const start = lineStartsView.at(index)
    if (start === undefined || start > range.end) return true

    const last = lastWindowLine(source, index, start, range.end)
    const window = readWindow(source, start, lineEndAt(source, last), range)
    if (!scanLineWindow(window, query, range, captureMatches, visit)) return false
    index = last + 1
  }

  return true
}

function lastWindowLine(
  source: FindTextSource,
  first: number,
  start: number,
  rangeEnd: number,
): number {
  const reach = Math.min(rangeEnd, start + FIND_WINDOW_UNITS)
  return Math.max(first, source.lineStartsView.indexForOffset(reach))
}

function scanLineWindow(
  window: FindWindow,
  query: CompiledFindQuery,
  range: FindRange,
  captureMatches: boolean,
  visit: FindMatchVisitor,
): boolean {
  if (query.plan.kind !== 'anchored-lines')
    return scanWindow(window, query, range, captureMatches, visit)

  // `^` and `$` answer for the ends of the haystack, so each line is its own.
  let lineStart = 0
  while (lineStart <= window.text.length) {
    const found = window.text.indexOf('\n', lineStart)
    const lineEnd = found === -1 ? window.text.length : found
    const line = {
      text: window.text.slice(lineStart, lineEnd),
      start: window.start + lineStart,
      from: Math.max(0, window.from - lineStart),
    }
    if (lineEnd >= window.from && !scanWindow(line, query, range, captureMatches, visit))
      return false

    lineStart = lineEnd + 1
  }

  return true
}

// A literal holding breaks spans exactly that many lines past the one it starts
// on, so windows overlapping by that many lines show every match whole to at
// least one of them. The cursor is carried across: restarting the greedy scan at
// an overlap's first character would change which of two overlapping candidates
// wins, and with it every match after them.
function scanSpanningLiteral(
  source: FindTextSource,
  query: CompiledFindQuery,
  range: FindRange,
  lineBreaks: number,
  visit: FindMatchVisitor,
): boolean {
  const lineStartsView = source.lineStartsView
  const finalLine = lineStartsView.indexForOffset(range.end)
  let first = lineStartsView.indexForOffset(range.start)
  const cursor = { offset: range.start }
  while (first <= finalLine) {
    const start = lineStartsView.at(first) ?? 0
    const last = Math.min(
      finalLine,
      Math.max(first + lineBreaks, lastWindowLine(source, first, start, range.end)),
    )
    const text = source.readRange(start, Math.max(start, lineEndAt(source, last)))
    const window = { text, start, from: Math.max(0, cursor.offset - start) }
    if (!scanWindow(window, query, range, false, visit, cursor)) return false
    if (last === finalLine) return true

    first = last + 1 - lineBreaks
  }

  return true
}

// Listing every match of a pattern that can span the range's ends has to look at
// every character between them, so the range is read as one window: a window
// grown in steps would only re-run the pattern over text it already scanned. The
// window still stops on line boundaries, or `^` and `$` would answer for its cut
// ends instead of for real ones.
function scanWholeRange(
  source: FindTextSource,
  query: CompiledFindQuery,
  range: FindRange,
  captureMatches: boolean,
  visit: FindMatchVisitor,
): boolean {
  const lineStartsView = source.lineStartsView
  const start = lineStartsView.at(lineStartsView.indexForOffset(range.start)) ?? 0
  const end = lineEndAt(source, lineStartsView.indexForOffset(range.end))
  const window = readWindow(source, start, Math.max(start, end), range)
  return scanWindow(window, query, range, captureMatches, visit)
}

function readWindow(
  source: FindTextSource,
  start: number,
  end: number,
  range: FindRange,
): FindWindow {
  return { text: source.readRange(start, end), start, from: Math.max(0, range.start - start) }
}

// Where the next raw match may begin. It moves past every raw match, including
// one the whole-word filter rejects, so the scan keeps one non-overlap phase.
type FindCursor = { offset: number }

/** False once the range is spent or the visitor stopped, so no later window can add anything. */
function scanWindow(
  window: FindWindow,
  query: CompiledFindQuery,
  range: FindRange,
  captureMatches: boolean,
  visit: FindMatchVisitor,
  cursor?: FindCursor,
): boolean {
  if (query.simpleSearch && !captureMatches)
    return scanSimpleMatches(window, query.simpleSearch, query.wholeWord, range, visit, cursor)

  return scanRegexMatches(window, query, range, captureMatches, visit, cursor)
}

function scanSimpleMatches(
  window: FindWindow,
  searchString: string,
  wholeWord: boolean,
  range: FindRange,
  visit: FindMatchVisitor,
  cursor?: FindCursor,
): boolean {
  // Searched as-is: no folded copy of the text is allocated, and every index
  // returned addresses the window it came from.
  let index = window.text.indexOf(searchString, window.from)
  while (index !== -1) {
    const start = window.start + index
    const end = start + searchString.length
    if (end > range.end) return false
    if (cursor) cursor.offset = end
    if (validWholeWordMatch(window.text, index, searchString.length, wholeWord)) {
      if (!visit(start, end, null)) return false
    }

    index = window.text.indexOf(searchString, index + searchString.length)
  }

  return true
}

function scanRegexMatches(
  window: FindWindow,
  query: CompiledFindQuery,
  range: FindRange,
  captureMatches: boolean,
  visit: FindMatchVisitor,
  cursor?: FindCursor,
): boolean {
  query.regex.lastIndex = window.from
  while (true) {
    const match = query.regex.exec(window.text)
    if (!match) return true

    const start = window.start + match.index
    const end = start + match[0].length
    if (start > range.end || end > range.end) return false
    if (cursor) cursor.offset = end
    if (validWholeWordMatch(window.text, match.index, match[0].length, query.wholeWord)) {
      if (!visit(start, end, captureMatches ? match : null)) return false
    }

    if (match[0].length === 0) advancePastEmptyMatch(query.regex, window.text)
  }
}

function advancePastEmptyMatch(regex: RegExp, text: string): void {
  const current = regex.lastIndex
  if (current > text.length) return

  const size = codePointSizeAt(text, current)
  regex.lastIndex = current + Math.max(1, size)
}

function validWholeWordMatch(
  text: string,
  start: number,
  length: number,
  wholeWord: boolean,
): boolean {
  if (!wholeWord) return true
  return isWholeWordRange(text, { start, end: start + length })
}
