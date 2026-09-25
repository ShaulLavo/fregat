import { compareValues } from '@workspace/utils/compare'
import {
  contiguousMatch,
  matchToken,
  startsWord,
  subsequenceMatch,
  type TokenMatch,
  type TokenMatchKind,
} from '@workspace/utils/token-match'

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
const BASE_SCORE: Record<TokenMatchKind, number> = {
  exact: 10_000,
  prefix: 8_000,
  boundary: 7_000,
  includes: 6_000,
  fuzzy: 1_000,
}
const BOUNDARY_MARKERS = './_- '
// File and command queries stay fuzzy from the first character.
const MATCH_OPTIONS = { boundaryMarkers: BOUNDARY_MARKERS, minFuzzyLength: 1 }

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
    compareValues(right.score, left.score) ||
    compareBooleans(left.labelMatched, right.labelMatched) ||
    compareValues(left.span, right.span) ||
    compareValues(left.labelLength, right.labelLength) ||
    compareValues(left.pathLength, right.pathLength) ||
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
  const normalized = text.toLowerCase()
  if (field === 'path') return pathFieldRank(normalized, piece)

  const match = matchToken(normalized, piece, MATCH_OPTIONS)
  return match ? fieldRank(normalized, piece, field, match) : null
}

function pathFieldRank(normalized: string, piece: string): FieldRank | null {
  const contiguous = contiguousMatch(normalized, piece, BOUNDARY_MARKERS)
  if (contiguous) return fieldRank(normalized, piece, 'path', contiguous)
  if (piece.includes('/')) return null

  return bestSegmentRank(normalized, piece)
}

// One fuzzy piece never spans two path segments.
function bestSegmentRank(normalized: string, piece: string): FieldRank | null {
  const ranks: FieldRank[] = []
  let offset = 0

  for (const segment of normalized.split('/')) {
    const match = subsequenceMatch(segment, piece)
    if (match) ranks.push(fieldRank(normalized, piece, 'path', offsetMatch(match, offset)))

    offset += segment.length + 1
  }

  return ranks.sort(compareFieldRanks)[0] ?? null
}

function offsetMatch(match: TokenMatch, offset: number): TokenMatch {
  return { kind: match.kind, index: match.index + offset, span: match.span }
}

function fieldRank(
  text: string,
  piece: string,
  field: FieldRank['field'],
  match: TokenMatch,
): FieldRank {
  return {
    exact: match.kind === 'exact',
    field,
    firstIndex: match.index,
    score: fieldBonus(field) + matchScore(text, piece, match),
    span: match.span,
  }
}

function matchScore(text: string, piece: string, match: TokenMatch) {
  if (match.kind === 'fuzzy') return fuzzyScore(text, piece, match)

  const coverage = piece.length / text.length
  const base = BASE_SCORE[match.kind] + (match.kind === 'includes' ? coverage : 0)

  return base + coverage * 500 - match.index
}

function fuzzyScore(text: string, piece: string, match: TokenMatch) {
  const compactness = piece.length / match.span
  const boundaryBoost = startsWord(text, match.index, BOUNDARY_MARKERS) ? 150 : 0

  return BASE_SCORE.fuzzy + compactness * 350 + boundaryBoost - match.index
}

function fieldBonus(field: FieldRank['field']) {
  if (field === 'label') return LABEL_FIELD_BONUS
  if (field === 'path') return PATH_FIELD_BONUS

  return KEYWORD_FIELD_BONUS
}

export function queryPieces(query: string) {
  return query.toLowerCase().trim().split(/\s+/u).filter(Boolean)
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
    compareValues(right.score, left.score) ||
    compareBooleans(left.exact, right.exact) ||
    compareValues(left.span, right.span) ||
    compareValues(left.firstIndex, right.firstIndex)
  )
}

function compareRankTargets(left: FuzzyRankTarget, right: FuzzyRankTarget) {
  return (
    left.label.localeCompare(right.label) ||
    (left.path ?? left.label).localeCompare(right.path ?? right.label)
  )
}

function compareBooleans(left: boolean, right: boolean) {
  if (left === right) return 0

  return left ? -1 : 1
}

function isFieldRank(rank: FieldRank | null): rank is FieldRank {
  return rank !== null
}
