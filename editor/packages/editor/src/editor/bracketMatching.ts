import type { BracketInfo } from '../syntax/session'

/**
 * Closing character for each opening bracket. The tree-sitter worker uses the same table to *tag*
 * bracket nodes; this one *pairs* them, so the two are separate concerns rather than shared state.
 */
const CLOSING_FOR_OPENING: Record<string, string | undefined> = {
  '(': ')',
  '[': ']',
  '{': '}',
}

const OPENING_FOR_CLOSING: Record<string, string | undefined> = {
  ')': '(',
  ']': '[',
  '}': '{',
}

/**
 * How many brackets a match scan may visit before giving up. A caret inside a very large scope
 * would otherwise walk every bracket in the file on each selection change; an unmatched result
 * paints nothing, which is the same outcome as an honestly missing partner.
 */
const DEFAULT_SCAN_BUDGET = 2_000

/**
 * Nesting depth at which levels stop being reported. A file nested deeper than this was written by a
 * program, and no reader can tell one depth from another down there, so the entries would be built
 * and shipped for nobody.
 */
const DEFAULT_MAX_BRACKET_LEVEL = 200

export type BracketMatch = {
  /** Text offset of the opening bracket. */
  readonly openOffset: number
  /** Text offset of the closing bracket. */
  readonly closeOffset: number
}

export type BracketLevel = {
  /** Text offset of the bracket character. */
  readonly offset: number
  readonly char: string
  /** Nesting depth of the pair this bracket belongs to, counted from 0 at the outermost pair. */
  readonly level: number
  /** A closer with no opener to close, so it heads no pair whatever depth it sits at. */
  readonly unexpected: boolean
}

export type BracketLevelOptions = {
  /** Deepest nesting a level is reported for; anything nested deeper is left out entirely. */
  readonly maxLevel?: number
}

function isOpeningBracket(char: string): boolean {
  return CLOSING_FOR_OPENING[char] !== undefined
}

function isClosingBracket(char: string): boolean {
  return OPENING_FOR_CLOSING[char] !== undefined
}

/**
 * Index of the bracket occupying `offset`, or -1. Brackets are single characters, so a bracket at
 * `index` covers `[index, index + 1)`. Assumes `brackets` is sorted by index, which is how the
 * syntax layer ships it.
 */
function bracketIndexAtOffset(brackets: readonly BracketInfo[], offset: number): number {
  let low = 0
  let high = brackets.length - 1

  while (low <= high) {
    const middle = (low + high) >> 1
    const candidate = brackets[middle]
    if (!candidate) return -1

    if (candidate.index === offset) return middle
    if (candidate.index < offset) low = middle + 1
    else high = middle - 1
  }

  return -1
}

/**
 * The bracket the caret is touching, following the editor convention that a caret sitting directly
 * after a bracket belongs to that bracket. The character *before* the caret wins so that typing a
 * closer immediately highlights the pair it just completed.
 */
function touchedBracketIndex(brackets: readonly BracketInfo[], caretOffset: number): number {
  const before = bracketIndexAtOffset(brackets, caretOffset - 1)
  if (before !== -1) return before

  return bracketIndexAtOffset(brackets, caretOffset)
}

/**
 * Partner of the bracket at list position `position`, scanning outward with its own nesting
 * counter. The worker's `depth` field is deliberately not used: unbalanced text (`{ ]`) can give a
 * closer the same depth as an unrelated opener, so depth alone pairs the wrong characters.
 */
function matchFromPosition(
  brackets: readonly BracketInfo[],
  position: number,
  scanBudget: number,
): BracketMatch | null {
  const origin = brackets[position]
  if (!origin) return null

  if (isOpeningBracket(origin.char)) {
    return scanForward(brackets, position, origin, scanBudget)
  }
  if (isClosingBracket(origin.char)) {
    return scanBackward(brackets, position, origin, scanBudget)
  }

  return null
}

function scanForward(
  brackets: readonly BracketInfo[],
  position: number,
  origin: BracketInfo,
  scanBudget: number,
): BracketMatch | null {
  const expected = CLOSING_FOR_OPENING[origin.char]
  const limit = Math.min(brackets.length, position + 1 + scanBudget)
  let nesting = 0

  for (let index = position + 1; index < limit; index += 1) {
    const candidate = brackets[index]
    if (!candidate) return null

    if (isOpeningBracket(candidate.char)) {
      nesting += 1
      continue
    }
    if (!isClosingBracket(candidate.char)) continue

    if (nesting > 0) {
      nesting -= 1
      continue
    }
    // The first closer at our own nesting level is the only candidate. If its character disagrees
    // the source is unbalanced, and reporting no match beats painting a wrong pair.
    if (candidate.char !== expected) return null

    return { closeOffset: candidate.index, openOffset: origin.index }
  }

  return null
}

function scanBackward(
  brackets: readonly BracketInfo[],
  position: number,
  origin: BracketInfo,
  scanBudget: number,
): BracketMatch | null {
  const expected = OPENING_FOR_CLOSING[origin.char]
  const limit = Math.max(0, position - scanBudget)
  let nesting = 0

  for (let index = position - 1; index >= limit; index -= 1) {
    const candidate = brackets[index]
    if (!candidate) return null

    if (isClosingBracket(candidate.char)) {
      nesting += 1
      continue
    }
    if (!isOpeningBracket(candidate.char)) continue

    if (nesting > 0) {
      nesting -= 1
      continue
    }
    if (candidate.char !== expected) return null

    return { closeOffset: origin.index, openOffset: candidate.index }
  }

  return null
}

/**
 * Matching bracket pair for a caret, or null when the caret touches no bracket, the partner is
 * missing, or the source is unbalanced at that point.
 *
 * Brackets come from the syntax worker, so string and comment contents are already excluded — the
 * reason this is not a text scan.
 */
export function findBracketMatchAtCaret(
  brackets: readonly BracketInfo[],
  caretOffset: number,
  scanBudget: number = DEFAULT_SCAN_BUDGET,
): BracketMatch | null {
  if (brackets.length === 0) return null

  const position = touchedBracketIndex(brackets, caretOffset)
  if (position === -1) return null

  return matchFromPosition(brackets, position, scanBudget)
}

/**
 * Offset to move a caret to when jumping to the matching bracket. Mirrors the editor convention of
 * landing *after* the partner, so a second jump returns to where the first one started.
 */
export function bracketJumpTargetOffset(
  brackets: readonly BracketInfo[],
  caretOffset: number,
  scanBudget: number = DEFAULT_SCAN_BUDGET,
): number | null {
  const match = findBracketMatchAtCaret(brackets, caretOffset, scanBudget)
  if (!match) return null

  const touching = touchedBracketIndex(brackets, caretOffset)
  const origin = brackets[touching]
  if (!origin) return null

  const jumpingToClose = origin.index === match.openOffset
  return jumpingToClose ? match.closeOffset + 1 : match.openOffset + 1
}

/**
 * Nesting level of every bracket in the list, paired with a stack for the same reason a caret match
 * is. The worker's `depth` counts openers it never saw closed, so one stray `{` inflates the depth
 * of every bracket after it for the rest of the file, and a mismatched closer is reported one level
 * deeper than the opener it belongs to. A level that drifts is worse than no level: anything painting
 * it would recolour the file below the caret while a pair is still half-typed.
 *
 * Unbalanced text resolves the way a reader resolves it — a closer takes the nearest opener it can
 * legally close, which re-syncs the depth of everything after it rather than carrying the mistake
 * forward. An opener whose closer never arrives still reports the level it was written at, because
 * that is where it sits on screen; only a closer with nothing to close is called out.
 */
export function collectBracketLevels(
  brackets: readonly BracketInfo[],
  options: BracketLevelOptions = {},
): readonly BracketLevel[] {
  const maxLevel = options.maxLevel ?? DEFAULT_MAX_BRACKET_LEVEL
  const levels: BracketLevel[] = []
  const open: string[] = []

  for (const bracket of brackets) {
    if (isOpeningBracket(bracket.char)) {
      appendBracketLevel(levels, bracket, open.length, false, maxLevel)
      open.push(bracket.char)
      continue
    }
    if (!isClosingBracket(bracket.char)) continue

    const level = openerIndexForCloser(open, bracket.char)
    if (level === -1) {
      appendBracketLevel(levels, bracket, open.length, true, maxLevel)
      continue
    }

    // Truncating to the matched opener drops the openers it was hiding: those are the ones still
    // half-written, and leaving them on the stack is what would shift every level after them.
    open.length = level
    appendBracketLevel(levels, bracket, level, false, maxLevel)
  }

  return levels
}

function appendBracketLevel(
  levels: BracketLevel[],
  bracket: BracketInfo,
  level: number,
  unexpected: boolean,
  maxLevel: number,
): void {
  if (level >= maxLevel) return

  levels.push({ offset: bracket.index, char: bracket.char, level, unexpected })
}

function openerIndexForCloser(open: readonly string[], char: string): number {
  for (let index = open.length - 1; index >= 0; index -= 1) {
    const opener = open[index]
    if (opener && CLOSING_FOR_OPENING[opener] === char) return index
  }

  return -1
}
