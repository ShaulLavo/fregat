export type FuzzyRankTarget = {
  label: string
  keywords?: readonly string[]
  path?: string
}

export type FuzzyRank = {
  exact: boolean
  firstIndex: number
  labelLength: number
  labelMatched: boolean
  pathLength: number
  score: number
  span: number
  tieBreaker: string
}

type FieldRank = {
  exact: boolean
  field: 'keyword' | 'label' | 'path'
  firstIndex: number
  score: number
  span: number
}

const LABEL_FIELD_BONUS = 3_000
const PATH_FIELD_BONUS = 1_000
const KEYWORD_FIELD_BONUS = 500
const EXACT_BASE_SCORE = 10_000
const PREFIX_BASE_SCORE = 8_000
const WORD_BASE_SCORE = 7_000
const SUBSTRING_BASE_SCORE = 6_000
const FUZZY_BASE_SCORE = 1_000

export function fuzzyRank(target: FuzzyRankTarget, query: string): FuzzyRank | null {
  const pieces = queryPieces(query)
  if (pieces.length === 0) return emptyRank(target)

  const ranks = ranksForPieces(target, pieces)
  if (!ranks) return null

  return combinedRank(target, ranks)
}

export function fuzzyRankScore(target: FuzzyRankTarget, query: string) {
  return fuzzyRank(target, query)?.score ?? 0
}

export function compareFuzzyRankedTargets(
  left: FuzzyRankTarget,
  right: FuzzyRankTarget,
  query: string,
) {
  const leftRank = fuzzyRank(left, query)
  const rightRank = fuzzyRank(right, query)
  if (leftRank && !rightRank) return -1
  if (!leftRank && rightRank) return 1
  if (!leftRank || !rightRank) return compareRankTargets(left, right)

  return compareFuzzyRanks(leftRank, rightRank)
}

function compareFuzzyRanks(left: FuzzyRank, right: FuzzyRank) {
  return (
    compareBooleans(left.exact, right.exact) ||
    compareNumbers(right.score, left.score) ||
    compareBooleans(left.labelMatched, right.labelMatched) ||
    compareNumbers(left.span, right.span) ||
    compareNumbers(left.labelLength, right.labelLength) ||
    compareNumbers(left.pathLength, right.pathLength) ||
    left.tieBreaker.localeCompare(right.tieBreaker)
  )
}

function ranksForPieces(target: FuzzyRankTarget, pieces: readonly string[]) {
  const ranks: FieldRank[] = []

  for (const piece of pieces) {
    const rank = bestPieceRank(target, piece)
    if (!rank) return null
    ranks.push(rank)
  }

  return ranks
}

function combinedRank(target: FuzzyRankTarget, ranks: readonly FieldRank[]): FuzzyRank {
  const firstIndex = Math.min(...ranks.map((rank) => rank.firstIndex))
  const span = ranks.reduce((total, rank) => total + rank.span, 0)
  const score = ranks.reduce((total, rank) => total + rank.score, 0)

  return {
    exact: ranks.some((rank) => rank.exact),
    firstIndex,
    labelLength: target.label.length,
    labelMatched: ranks.some((rank) => rank.field === 'label'),
    pathLength: target.path?.length ?? target.label.length,
    score,
    span,
    tieBreaker: target.path ?? target.label,
  }
}

function bestPieceRank(target: FuzzyRankTarget, piece: string) {
  const ranks = [
    textFieldRank(target.label, piece, 'label'),
    target.path ? textFieldRank(target.path, piece, 'path') : null,
    bestKeywordRank(target.keywords, piece),
  ].filter(isFieldRank)

  return ranks.sort(compareFieldRanks)[0] ?? null
}

function bestKeywordRank(keywords: readonly string[] | undefined, piece: string) {
  if (!keywords) return null

  const ranks = keywords
    .map((keyword) => textFieldRank(keyword, piece, 'keyword'))
    .filter(isFieldRank)

  return ranks.sort(compareFieldRanks)[0] ?? null
}

function textFieldRank(text: string, piece: string, field: FieldRank['field']): FieldRank | null {
  const normalized = text.toLocaleLowerCase()
  if (!normalized) return null

  const contiguous = contiguousRank(text, normalized, piece, field)
  if (contiguous) return contiguous

  return fuzzyFieldRank(text, normalized, piece, field)
}

function contiguousRank(
  text: string,
  normalized: string,
  piece: string,
  field: FieldRank['field'],
): FieldRank | null {
  const index = normalized.indexOf(piece)
  if (index < 0) return null

  const exact = normalized === piece
  const base = contiguousBaseScore(normalized, piece, index, exact)
  const coverage = piece.length / Math.max(1, text.length)
  const score = fieldBonus(field) + base + coverage * 500 - index

  return {
    exact,
    field,
    firstIndex: index,
    score,
    span: piece.length,
  }
}

function contiguousBaseScore(text: string, piece: string, index: number, exact: boolean) {
  if (exact) return EXACT_BASE_SCORE
  if (index === 0) return PREFIX_BASE_SCORE
  if (wordBoundaryBefore(text, index)) return WORD_BASE_SCORE

  return SUBSTRING_BASE_SCORE + piece.length / Math.max(1, text.length)
}

function fuzzyFieldRank(
  text: string,
  normalized: string,
  piece: string,
  field: FieldRank['field'],
): FieldRank | null {
  if (field === 'path') return fuzzyPathFieldRank(text, normalized, piece)

  const positions = fuzzyPositions(normalized, piece)
  if (!positions) return null

  return fuzzyRankFromPositions(text, piece, field, positions)
}

function fuzzyPathFieldRank(text: string, normalized: string, piece: string): FieldRank | null {
  if (piece.includes('/')) return null

  const ranks: FieldRank[] = []
  let offset = 0

  for (const segment of normalized.split('/')) {
    const positions = fuzzyPositions(segment, piece)
    if (positions)
      ranks.push(fuzzyRankFromPositions(text, piece, 'path', offsetPositions(positions, offset)))

    offset += segment.length + 1
  }

  return ranks.sort(compareFieldRanks)[0] ?? null
}

function fuzzyRankFromPositions(
  text: string,
  piece: string,
  field: FieldRank['field'],
  positions: readonly number[],
): FieldRank {
  const firstIndex = positions[0] ?? 0
  const lastIndex = positions.at(-1) ?? firstIndex
  const span = lastIndex - firstIndex + 1
  const compactness = piece.length / Math.max(1, span)
  const boundaryBoost = wordBoundaryBefore(text, firstIndex) ? 150 : 0
  const score =
    fieldBonus(field) + FUZZY_BASE_SCORE + compactness * 350 + boundaryBoost - firstIndex

  return {
    exact: false,
    field,
    firstIndex,
    score,
    span,
  }
}

function offsetPositions(positions: readonly number[], offset: number) {
  return positions.map((position) => position + offset)
}

function fuzzyPositions(text: string, piece: string) {
  const positions: number[] = []
  let fromIndex = 0

  for (const character of piece) {
    const index = text.indexOf(character, fromIndex)
    if (index < 0) return null

    positions.push(index)
    fromIndex = index + character.length
  }

  return positions
}

function fieldBonus(field: FieldRank['field']) {
  if (field === 'label') return LABEL_FIELD_BONUS
  if (field === 'path') return PATH_FIELD_BONUS

  return KEYWORD_FIELD_BONUS
}

function wordBoundaryBefore(text: string, index: number) {
  if (index <= 0) return true

  return /[./_\-\s]/u.test(text[index - 1] ?? '')
}

function queryPieces(query: string) {
  return query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean)
}

function emptyRank(target: FuzzyRankTarget): FuzzyRank {
  return {
    exact: false,
    firstIndex: 0,
    labelLength: target.label.length,
    labelMatched: true,
    pathLength: target.path?.length ?? target.label.length,
    score: 1,
    span: 0,
    tieBreaker: target.path ?? target.label,
  }
}

function compareFieldRanks(left: FieldRank, right: FieldRank) {
  return (
    compareNumbers(right.score, left.score) ||
    compareBooleans(left.exact, right.exact) ||
    compareNumbers(left.span, right.span) ||
    compareNumbers(left.firstIndex, right.firstIndex)
  )
}

function compareRankTargets(left: FuzzyRankTarget, right: FuzzyRankTarget) {
  return (
    left.label.localeCompare(right.label) ||
    (left.path ?? left.label).localeCompare(right.path ?? right.label)
  )
}

function compareNumbers(left: number, right: number) {
  return left === right ? 0 : left < right ? -1 : 1
}

function compareBooleans(left: boolean, right: boolean) {
  if (left === right) return 0

  return left ? -1 : 1
}

function isFieldRank(rank: FieldRank | null): rank is FieldRank {
  return rank !== null
}
