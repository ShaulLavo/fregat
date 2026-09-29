/*
 * Fuzzy matching of the word being typed against one candidate string.
 *
 * Two things come back from a match rather than one: how well it matched, and where. The positions
 * are what lets a list mark the characters an entry owes its place to, so the ranking can be read off
 * the screen instead of taken on trust.
 *
 * Scoring is a table walk, and its cost is bounded on both axes. Strings are matched up to a fixed
 * length, so a minified bundle arriving as one enormous label costs what any other label costs. And
 * each row only visits the positions its character could possibly match at — no earlier than a
 * forward subsequence scan reaches it, no later than a backward one does — which on a long candidate
 * is a narrow band rather than the whole string.
 */

export type FuzzyMatch = {
  readonly score: number
  /** Indices into the candidate that the pattern matched, ascending. */
  readonly positions: readonly number[]
}

const MAX_PATTERN_LENGTH = 64
const MAX_CANDIDATE_LENGTH = 128
/** How many leading pattern characters a loose match may give up before it stops trying. */
const MAX_LOOSE_ATTEMPTS = 13

const NO_MATCH = Number.MIN_SAFE_INTEGER

/** A character where the user's typing meets the candidate's own structure. */
const POSITION_PREFIX = 0
const POSITION_CAMEL = 1
const POSITION_SEPARATOR = 2
const POSITION_AFTER_SEPARATOR = 3
const POSITION_INSIDE_WORD = 4

const STEP_MATCH = 1
const STEP_SKIP_ONE = 2
const STEP_SKIP_TWO = 3

const TABLE_COLUMNS = MAX_CANDIDATE_LENGTH + 1
const TABLE_CELLS = (MAX_PATTERN_LENGTH + 1) * TABLE_COLUMNS

/*
 * Every item of a list is scored on every keystroke, so the tables are reused across calls instead of
 * allocated per candidate. Row zero is never written, and every read of it is a boundary read that
 * wants the zero it was created with.
 */
const cellScores = new Int32Array(TABLE_CELLS)
const cellRunLengths = new Int32Array(TABLE_CELLS)
const cellSteps = new Uint8Array(TABLE_CELLS)
const earliestPositions = new Int32Array(MAX_PATTERN_LENGTH)
const latestPositions = new Int32Array(MAX_PATTERN_LENGTH)

/** Where a candidate visibly breaks, and so where a match may resume without reading as scattered. */
const SEPARATORS = new Set('_-. /\\\'":$<>()[]{}#@')

/**
 * The match of the whole pattern, or null when there is none.
 *
 * The first character has to land somewhere the candidate begins something — its start, a camel-case
 * hump, the far side of a separator. A pattern that only turns up in the middle of a word is a
 * coincidence rather than what the user was reaching for.
 */
export function fuzzyMatch(pattern: string, candidate: string): FuzzyMatch | null {
  return matchFrom(pattern, pattern.toLowerCase(), 0, candidate, candidate.toLowerCase(), false)
}

/**
 * The match of the pattern, or of what is left of it after dropping leading characters, at any
 * alignment at all.
 *
 * For a string the pattern was never ranked against there is no reason for all of it to be present,
 * and marking the part that is beats marking nothing.
 */
export function looseFuzzyMatch(pattern: string, candidate: string): FuzzyMatch | null {
  const patternLow = pattern.toLowerCase()
  const candidateLow = candidate.toLowerCase()
  const attempts = Math.min(pattern.length, MAX_LOOSE_ATTEMPTS)
  for (let start = 0; start < attempts; start += 1) {
    const match = matchFrom(pattern, patternLow, start, candidate, candidateLow, true)
    if (match) return match
  }

  return null
}

function matchFrom(
  pattern: string,
  patternLow: string,
  patternStart: number,
  candidate: string,
  candidateLow: string,
  allowWeakStart: boolean,
): FuzzyMatch | null {
  const patternEnd = Math.min(pattern.length, MAX_PATTERN_LENGTH)
  const candidateEnd = Math.min(candidate.length, MAX_CANDIDATE_LENGTH)
  const patternLength = patternEnd - patternStart
  if (patternLength <= 0 || patternLength > candidateEnd) return null
  if (!fillEarliestPositions(patternLow, patternStart, patternEnd, candidateLow, candidateEnd)) {
    return null
  }

  fillLatestPositions(patternLow, patternStart, patternEnd, candidateLow, candidateEnd)

  let startsAtBoundary = false
  for (let patternPos = patternStart, row = 1; patternPos < patternEnd; patternPos += 1, row += 1) {
    const earliest = earliestPositions[patternPos] ?? 0
    const latest = latestPositions[patternPos] ?? 0
    // A row runs past its own last matchable position up to the next character's, because that is the
    // cell the next row reads to its left.
    const rowEnd =
      patternPos + 1 < patternEnd ? (latestPositions[patternPos + 1] ?? 0) : candidateEnd
    const isFirst = patternPos === patternStart

    for (let position = earliest; position < rowEnd; position += 1) {
      const cell = row * TABLE_COLUMNS + position + 1
      const diagonal = cell - TABLE_COLUMNS - 1

      let matched = NO_MATCH
      if (position <= latest && patternLow[patternPos] === candidateLow[position]) {
        const kind = positionKind(candidate, candidateLow, position, patternPos - patternStart)
        matched = characterScore(
          kind,
          isGapPosition(kind, candidate, candidateLow, position),
          pattern[patternPos] === candidate[position],
          isFirst,
          position,
          candidateEnd,
          (cellRunLengths[diagonal] ?? 0) === 0,
        )
        if (isFirst && kind !== POSITION_INSIDE_WORD) startsAtBoundary = true
      }

      const matchScore = matched === NO_MATCH ? 0 : matched + (cellScores[diagonal] ?? 0)
      const canSkipOne = position > earliest
      const skipOneScore = canSkipOne ? (cellScores[cell - 1] ?? 0) - gapStartPenalty(cell - 1) : 0
      const canSkipTwo = position > earliest + 1 && (cellRunLengths[cell - 1] ?? 0) > 0
      const skipTwoScore = canSkipTwo ? (cellScores[cell - 2] ?? 0) - gapStartPenalty(cell - 2) : 0

      // Skipping is preferred on a tie because it leaves the match earlier in the candidate, and
      // skipping over a run of matches is preferred over skipping one character for the same reason.
      if (
        canSkipTwo &&
        skipTwoScore >= skipOneScore &&
        (matched === NO_MATCH || skipTwoScore >= matchScore)
      ) {
        cellScores[cell] = skipTwoScore
        cellSteps[cell] = STEP_SKIP_TWO
        cellRunLengths[cell] = 0
      } else if (canSkipOne && (matched === NO_MATCH || skipOneScore >= matchScore)) {
        cellScores[cell] = skipOneScore
        cellSteps[cell] = STEP_SKIP_ONE
        cellRunLengths[cell] = 0
      } else {
        // The earliest position of a row is a match by construction, so a row always has a diagonal
        // to fall back on here.
        cellScores[cell] = matchScore
        cellSteps[cell] = STEP_MATCH
        cellRunLengths[cell] = (cellRunLengths[diagonal] ?? 0) + 1
      }
    }
  }

  if (!startsAtBoundary && !allowWeakStart) return null

  return traceMatch(patternLow, patternStart, patternEnd, candidate, candidateLow, candidateEnd)
}

/**
 * A score cannot say where a match landed, so the positions are recovered by walking the filled table
 * back from its last cell — and the score is settled here too, where the reach of the match is
 * finally known.
 */
function traceMatch(
  patternLow: string,
  patternStart: number,
  patternEnd: number,
  candidate: string,
  candidateLow: string,
  candidateEnd: number,
): FuzzyMatch {
  const positions: number[] = []
  let row = patternEnd - patternStart
  let column = candidateEnd
  let score = cellScores[row * TABLE_COLUMNS + column] ?? 0
  let runLength = 0
  let lastMatchColumn = 0

  while (row >= 1) {
    let matchColumn = column
    while (matchColumn >= 1) {
      const step = cellSteps[row * TABLE_COLUMNS + matchColumn]
      if (step === STEP_SKIP_TWO) matchColumn -= 2
      else if (step === STEP_SKIP_ONE) matchColumn -= 1
      else break
    }

    // The table was filled left to right and is being read right to left; where the two disagree, the
    // longer unbroken run of matched characters is the one a reader of the list will see.
    if (
      runLength > 1 &&
      patternLow[patternStart + row - 1] === candidateLow[column - 1] &&
      !isUpperCaseAt(candidate, candidateLow, matchColumn - 1) &&
      runLength + 1 > (cellRunLengths[row * TABLE_COLUMNS + matchColumn] ?? 0)
    ) {
      matchColumn = column
    }

    runLength = matchColumn === column ? runLength + 1 : 1
    if (lastMatchColumn === 0) lastMatchColumn = matchColumn
    row -= 1
    column = matchColumn - 1
    positions.push(column)
  }

  positions.reverse()
  const patternLength = patternEnd - patternStart
  // A candidate the pattern covers entirely is what the user typed, so it comes ahead of anything the
  // pattern is only part of; every candidate character the match stepped over costs it a point.
  if (candidateEnd === patternLength) score += 2
  score -= lastMatchColumn - patternLength
  return { positions, score }
}

/**
 * Records, per pattern character, the earliest candidate position it can match at, and reports
 * whether the pattern occurs in the candidate at all.
 *
 * A candidate the pattern is not a subsequence of cannot match however it is scored, and this is a
 * linear scan against a table walk.
 */
function fillEarliestPositions(
  patternLow: string,
  patternStart: number,
  patternEnd: number,
  candidateLow: string,
  candidateEnd: number,
): boolean {
  let patternPos = patternStart
  let position = 0
  while (patternPos < patternEnd && position < candidateEnd) {
    if (patternLow[patternPos] === candidateLow[position]) {
      earliestPositions[patternPos] = position
      patternPos += 1
    }
    position += 1
  }

  return patternPos === patternEnd
}

/** Records, per pattern character, the latest candidate position it can match at. */
function fillLatestPositions(
  patternLow: string,
  patternStart: number,
  patternEnd: number,
  candidateLow: string,
  candidateEnd: number,
): void {
  let patternPos = patternEnd - 1
  let position = candidateEnd - 1
  while (patternPos >= patternStart && position >= 0) {
    if (patternLow[patternPos] === candidateLow[position]) {
      latestPositions[patternPos] = position
      patternPos -= 1
    }
    position -= 1
  }
}

function positionKind(
  candidate: string,
  candidateLow: string,
  position: number,
  prefixPosition: number,
): number {
  if (position === prefixPosition) return POSITION_PREFIX
  if (
    isUpperCaseAt(candidate, candidateLow, position) &&
    !isUpperCaseAt(candidate, candidateLow, position - 1)
  ) {
    return POSITION_CAMEL
  }
  if (isSeparatorAt(candidateLow, position) && !isSeparatorAt(candidateLow, position - 1)) {
    return POSITION_SEPARATOR
  }
  if (isSeparatorAt(candidateLow, position - 1) || isWhitespaceAt(candidateLow, position - 1)) {
    return POSITION_AFTER_SEPARATOR
  }

  return POSITION_INSIDE_WORD
}

/**
 * Whether a gap would be forgivable at this position: the reader's eye already breaks the candidate
 * here, so a match that resumes here does not read as scattered.
 */
function isGapPosition(
  kind: number,
  candidate: string,
  candidateLow: string,
  position: number,
): boolean {
  if (kind === POSITION_CAMEL || kind === POSITION_AFTER_SEPARATOR) return true

  return (
    isUpperCaseAt(candidate, candidateLow, position) ||
    isSeparatorAt(candidateLow, position - 1) ||
    isWhitespaceAt(candidateLow, position - 1)
  )
}

/**
 * What one matched character is worth, which is most of the signal in a score.
 *
 * A character matched where the candidate begins something counts for several times one matched in
 * the middle of a word, and matching the case it is written in counts for more again: both are
 * things the user could only have typed deliberately.
 */
function characterScore(
  kind: number,
  isGap: boolean,
  sameCase: boolean,
  isFirst: boolean,
  position: number,
  candidateEnd: number,
  startsRun: boolean,
): number {
  let score = 1
  if (kind === POSITION_PREFIX || kind === POSITION_CAMEL) score = sameCase ? 7 : 5
  else if (kind === POSITION_SEPARATOR || kind === POSITION_AFTER_SEPARATOR) score = 5

  if (isFirst) {
    // What sits between the start of the candidate and the first matched character is the distance
    // between what was typed and what is being offered.
    if (position > 0) score -= isGap ? 3 : 5
  } else if (startsRun) {
    score += isGap ? 2 : 0
  } else {
    score += isGap ? 0 : 1
  }
  // Gaps are penalized everywhere, which would otherwise hand a free advantage to a match that runs
  // to the end of the candidate and has no room left to leave one.
  if (position + 1 === candidateEnd) score -= isGap ? 3 : 5

  return score
}

function gapStartPenalty(cell: number): number {
  return (cellRunLengths[cell] ?? 0) > 0 ? 5 : 0
}

function isUpperCaseAt(candidate: string, candidateLow: string, position: number): boolean {
  if (position < 0 || position >= candidate.length) return false

  return candidate[position] !== candidateLow[position]
}

function isSeparatorAt(candidateLow: string, position: number): boolean {
  if (position < 0 || position >= candidateLow.length) return false

  return SEPARATORS.has(candidateLow[position] ?? '')
}

function isWhitespaceAt(candidateLow: string, position: number): boolean {
  if (position < 0 || position >= candidateLow.length) return false

  const character = candidateLow[position]
  return character === ' ' || character === '\t'
}
