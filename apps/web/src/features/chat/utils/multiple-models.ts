import { modelRefKey, type ModelSelection } from '@workspace/contracts'

/** Adds or removes one extra model; the primary one is never an extra. */
export function toggledModelSelection(
  additional: readonly ModelSelection[],
  primary: ModelSelection | null,
  selection: ModelSelection,
): ModelSelection[] {
  const key = modelRefKey(selection)
  if (primary && modelRefKey(primary) === key) return [...additional]
  if (additional.some((entry) => modelRefKey(entry) === key)) {
    return additional.filter((entry) => modelRefKey(entry) !== key)
  }

  return [...additional, selection]
}

/** Every model a draft goes to, primary first. */
export function draftSendTargets(
  primary: ModelSelection,
  additional: readonly ModelSelection[],
): ModelSelection[] {
  const primaryKey = modelRefKey(primary)
  return [primary, ...additional.filter((entry) => modelRefKey(entry) !== primaryKey)]
}

export function backgroundModelError(
  models: readonly ModelSelection[],
  background: boolean,
): string | null {
  if (!background || models.length <= 1) return null
  return 'Background start supports one model. Select one model or use Send.'
}
