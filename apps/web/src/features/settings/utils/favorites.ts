import { modelRefKey, type ModelRef } from '@workspace/contracts'

/** Stars or unstars one model; a new favorite goes last so earlier stars keep their rank. */
export function toggledFavorite(
  favorites: readonly ModelRef[],
  ref: ModelRef,
  favorite: boolean,
): ModelRef[] {
  const key = modelRefKey(ref)
  const rest = favorites.filter((entry) => modelRefKey(entry) !== key)

  return favorite ? [...rest, ref] : rest
}
