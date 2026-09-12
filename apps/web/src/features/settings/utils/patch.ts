import { modelRefKey, type ModelRef, type ProviderInstanceConfig } from '@workspace/contracts'

/**
 * Sections are replaced whole, so every edit rebuilds the list it touches
 * rather than sending a delta the server would have to merge.
 */
/**
 * Toggling a provider the document has never mentioned appends it rather than
 * doing nothing.
 *
 * The built-in instances live in the registry, not in settings, so an untouched
 * install has an empty list — and mapping over it silently dropped every toggle
 * of the only two providers that exist. The appended entry is the driver's own
 * configuration with `enabled` changed, which is exactly what layering over the
 * defaults expects to receive.
 */
export function withProviderEnabled(
  instances: readonly ProviderInstanceConfig[],
  instance: ProviderInstanceConfig,
  enabled: boolean,
): ProviderInstanceConfig[] {
  const known = instances.some((saved) => saved.providerInstanceId === instance.providerInstanceId)
  if (!known) return instances.concat({ ...instance, enabled })

  return instances.map((saved) => {
    if (saved.providerInstanceId !== instance.providerInstanceId) return saved

    return { ...saved, enabled }
  })
}

/**
 * Moves a model one place, and returns the order that produces that list.
 *
 * Takes the sequence the user is actually looking at rather than the stored
 * `order`, because the stored one is sparse and a move within it does not
 * correspond to a move on screen: appending an unranked model puts it last in
 * `order`, which puts it *first* on screen — so "move down" clamped to nothing
 * on the first row and jumped the model to the top everywhere else. Naming every
 * displayed model is what makes one click equal one place.
 */
export function withMovedModel(
  displayed: readonly ModelRef[],
  ref: ModelRef,
  direction: -1 | 1,
): ModelRef[] {
  const key = modelRefKey(ref)
  const next = [...displayed]
  const index = next.findIndex((entry) => modelRefKey(entry) === key)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.length) return next

  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved!)

  return next
}
