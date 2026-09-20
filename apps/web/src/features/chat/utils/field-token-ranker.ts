import { normalizeText as normalize } from '@workspace/utils/strings'
export type FieldTokenCalibration = {
  readonly fieldPenaltyStep: number
  readonly offsets: {
    readonly exact: number
    readonly prefix: number
    readonly boundary: number
    readonly includes: number
    readonly fuzzy: number
  }
  readonly boundaryMarkers: readonly string[]
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
  const { offsets } = calibration
  if (!field) return null
  if (field === token) return offsets.exact
  if (field.startsWith(token)) return offsets.prefix + lengthPenalty(field, token, calibration)

  const boundaryIndex = boundaryMatchIndex(field, token, calibration.boundaryMarkers)
  if (boundaryIndex !== null) {
    return (
      offsets.boundary +
      positionPenalty(boundaryIndex, calibration) +
      lengthPenalty(field, token, calibration)
    )
  }

  const includesIndex = field.indexOf(token)
  if (includesIndex !== -1) {
    return (
      offsets.includes +
      positionPenalty(includesIndex, calibration) +
      lengthPenalty(field, token, calibration)
    )
  }
  // Short subsequences match almost everything; one- and two-character tokens must be literal.
  if (token.length < 3) return null

  const fuzzy = subsequenceScore(field, token, calibration)
  return fuzzy === null ? null : offsets.fuzzy + fuzzy
}

function boundaryMatchIndex(
  field: string,
  token: string,
  markers: readonly string[],
): number | null {
  let best: number | null = null
  for (const marker of markers) {
    const index = field.indexOf(`${marker}${token}`)
    if (index === -1) continue
    const matchIndex = index + marker.length
    if (best !== null && matchIndex >= best) continue
    best = matchIndex
  }
  return best
}

function subsequenceScore(
  field: string,
  token: string,
  calibration: FieldTokenCalibration,
): number | null {
  let tokenIndex = 0
  let firstMatchIndex = -1
  let previousMatchIndex = -1
  let gapPenalty = 0

  for (let index = 0; index < field.length; index += 1) {
    if (field[index] !== token[tokenIndex]) continue
    if (firstMatchIndex === -1) firstMatchIndex = index
    if (previousMatchIndex !== -1) gapPenalty += index - previousMatchIndex - 1
    previousMatchIndex = index
    tokenIndex += 1
    if (tokenIndex < token.length) continue

    const spanPenalty = index - firstMatchIndex + 1 - token.length
    const length = calibration.fuzzyIncludesLengthPenalty
      ? lengthPenalty(field, token, calibration)
      : 0
    return Math.min(
      calibration.maxFuzzyPenalty,
      positionPenalty(firstMatchIndex, calibration) + gapPenalty * 3 + spanPenalty + length,
    )
  }
  return null
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
