import { normalizeText as normalize } from '@workspace/utils/strings'
import { matchToken, type TokenMatch } from '@workspace/utils/token-match'

// Short subsequences match almost everything; one- and two-character tokens must be literal.
const MIN_FUZZY_LENGTH = 3

export type FieldTokenCalibration = {
  readonly fieldPenaltyStep: number
  readonly offsets: {
    readonly exact: number
    readonly prefix: number
    readonly boundary: number
    readonly includes: number
    readonly fuzzy: number
  }
  readonly boundaryMarkers: string
  readonly maxPositionPenalty: number
  readonly positionPenaltyFactor: number
  readonly maxLengthPenalty: number
  readonly lengthPenaltyDivisor: number
  readonly maxFuzzyPenalty: number
  readonly fuzzyIncludesLengthPenalty: boolean
}

export function rankFieldTokens<T>({
  items,
  query,
  fieldsOf,
  calibration,
  limit = Number.POSITIVE_INFINITY,
}: {
  items: readonly T[]
  query: string
  fieldsOf: (item: T) => readonly (string | null | undefined)[]
  calibration: FieldTokenCalibration
  limit?: number
}): T[] {
  const tokens = normalize(query).split(/\s+/u).filter(Boolean)
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : undefined
  if (tokens.length === 0) return items.slice(0, boundedLimit)

  const ranked: { item: T; order: number; score: number }[] = []
  for (const [order, item] of items.entries()) {
    const fields = fieldsOf(item).map((field) => normalize(field ?? ''))
    const score = itemScore(fields, tokens, calibration)
    if (score === null) continue
    ranked.push({ item, order, score })
  }

  ranked.sort((left, right) => left.score - right.score || left.order - right.order)
  return ranked.slice(0, boundedLimit).map((entry) => entry.item)
}

function itemScore(
  fields: readonly string[],
  tokens: readonly string[],
  calibration: FieldTokenCalibration,
): number | null {
  let total = 0
  for (const token of tokens) {
    const score = tokenScore(fields, token, calibration)
    if (score === null) return null
    total += score
  }
  return total
}

function tokenScore(
  fields: readonly string[],
  token: string,
  calibration: FieldTokenCalibration,
): number | null {
  let best: number | null = null
  for (const [index, field] of fields.entries()) {
    const score = fieldTokenScore(field, token, calibration)
    if (score === null) continue
    const weighted = index * calibration.fieldPenaltyStep + score
    if (best !== null && weighted >= best) continue
    best = weighted
  }
  return best
}

function fieldTokenScore(
  field: string,
  token: string,
  calibration: FieldTokenCalibration,
): number | null {
  const match = matchToken(field, token, {
    boundaryMarkers: calibration.boundaryMarkers,
    minFuzzyLength: MIN_FUZZY_LENGTH,
  })
  if (!match) return null
  if (match.kind === 'fuzzy')
    return calibration.offsets.fuzzy + fuzzyPenalty(field, token, match, calibration)

  return (
    calibration.offsets[match.kind] +
    positionPenalty(match.index, calibration) +
    lengthPenalty(field, token, calibration)
  )
}

function fuzzyPenalty(
  field: string,
  token: string,
  match: TokenMatch,
  calibration: FieldTokenCalibration,
) {
  const gaps = match.span - token.length
  const length = calibration.fuzzyIncludesLengthPenalty
    ? lengthPenalty(field, token, calibration)
    : 0

  return Math.min(
    calibration.maxFuzzyPenalty,
    positionPenalty(match.index, calibration) + gaps * 4 + length,
  )
}

function positionPenalty(index: number, calibration: FieldTokenCalibration) {
  return Math.min(calibration.maxPositionPenalty, index * calibration.positionPenaltyFactor)
}

function lengthPenalty(field: string, token: string, calibration: FieldTokenCalibration) {
  return (
    Math.min(calibration.maxLengthPenalty, Math.max(0, field.length - token.length)) /
    calibration.lengthPenaltyDivisor
  )
}
