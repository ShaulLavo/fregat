import {
  rankFieldTokens,
  type FieldTokenCalibration,
} from '@/features/chat/utils/field-token-ranker'

/** The projection this module indexes — `ProviderModelOption` satisfies it. */
export type ModelPickerSearchable = {
  readonly driverKind: string
  readonly name: string
  readonly providerLabel: string
  readonly shortName: string | null
}

// Picker tiers deliberately overlap: a short provider hit can outrank a long model-name hit.
const CALIBRATION: FieldTokenCalibration = {
  fieldPenaltyStep: 10,
  offsets: { exact: 0, prefix: 2, boundary: 4, includes: 6, fuzzy: 100 },
  boundaryMarkers: ' -_/',
  maxPositionPenalty: Number.POSITIVE_INFINITY,
  positionPenaltyFactor: 2,
  maxLengthPenalty: 64,
  lengthPenaltyDivisor: 1,
  maxFuzzyPenalty: Number.POSITIVE_INFINITY,
  fuzzyIncludesLengthPenalty: true,
}

export function rankModelPickerOptions<T extends ModelPickerSearchable>(
  options: readonly T[],
  query: string,
): T[] {
  return rankFieldTokens({
    items: options,
    query,
    fieldsOf: searchFields,
    calibration: CALIBRATION,
  })
}

function searchFields(option: ModelPickerSearchable) {
  return [option.name, option.shortName, option.driverKind, option.providerLabel]
}
