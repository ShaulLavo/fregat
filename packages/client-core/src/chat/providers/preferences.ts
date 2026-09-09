import { modelRefKey, type ModelRef } from '@workspace/contracts'

import type { ProviderModelOption } from '@workspace/client-core/chat/providers/models'

export type ModelPreferences = {
  readonly hidden: readonly ModelRef[]
  readonly order: readonly ModelRef[]
}

/**
 * Applies the user's model preferences to a provider's options.
 *
 * Both lists are sparse — they name only the models the user has an opinion
 * about — so everything unmentioned stays visible, after the ordered ones, in
 * the order the provider advertised. That is the contract the schema has always
 * documented; until now nothing applied it, so hiding a model did nothing.
 */
export function applyModelPreferences(
  options: readonly ProviderModelOption[],
  preferences: ModelPreferences,
): ProviderModelOption[] {
  const hidden = new Set(preferences.hidden.map(modelRefKey))
  const visible = options.filter((option) => !hidden.has(modelRefKey(option.modelSelection)))
  if (preferences.order.length === 0) return visible

  const rank = new Map(preferences.order.map((ref, index) => [modelRefKey(ref), index]))

  // A stable partition rather than a sort over the whole list: unranked models
  // must keep provider order exactly, and a comparator that invents a rank for
  // them would quietly reorder a provider's own preferred sequence.
  const ranked = visible
    .filter((option) => rank.has(modelRefKey(option.modelSelection)))
    .sort(
      (left, right) =>
        (rank.get(modelRefKey(left.modelSelection)) ?? 0) -
        (rank.get(modelRefKey(right.modelSelection)) ?? 0),
    )
  const rest = visible.filter((option) => !rank.has(modelRefKey(option.modelSelection)))

  return [...ranked, ...rest]
}

export type ModelPreferenceRow = {
  readonly hidden: boolean
  readonly key: string
  readonly label: string
  readonly providerLabel: string
  readonly ref: ModelRef
}

/**
 * Every model the settings page should offer a row for, in the order it shows them.
 *
 * The union of three sources, and each one is load-bearing:
 *
 * - `preferences.order` first, so a ranked model keeps its position. Globally,
 *   not per provider: this list is flat, unlike the picker, which groups by
 *   provider and so ranks within each group.
 * - then the provider catalogue, which is what makes the section usable at all.
 *   Deriving rows from `hidden`/`order` alone meant the list could only contain
 *   models the user had already acted on, so it started empty and stayed empty.
 * - then anything left in `preferences.hidden`. A model whose provider has
 *   stopped reporting it is absent from the catalogue, and without this pass it
 *   would lose its row while staying hidden — permanently, with nothing left in
 *   the UI able to bring it back.
 *
 * `options` must be the *unfiltered* catalogue. Hiding is a flag here, never a
 * subtraction, because hiding is the decision this screen exists to take back.
 */
export function modelPreferenceRows(
  options: readonly ProviderModelOption[],
  preferences: ModelPreferences,
): ModelPreferenceRow[] {
  const hidden = new Set(preferences.hidden.map(modelRefKey))
  const catalogue = new Map(options.map((option) => [modelRefKey(option.modelSelection), option]))
  const rows = new Map<string, ModelPreferenceRow>()

  const addRow = (ref: ModelRef) => {
    const key = modelRefKey(ref)
    if (rows.has(key)) return

    const option = catalogue.get(key)
    rows.set(key, {
      hidden: hidden.has(key),
      key,
      // A ref the catalogue no longer carries has no label to borrow, so the
      // slug stands in rather than the row rendering blank.
      label: option?.label ?? ref.model,
      providerLabel: option?.providerLabel ?? ref.providerInstanceId,
      // Normalised rather than passed through: the row's ref is written straight
      // back into `models.hidden`/`models.order`, and a `ModelSelection` carries
      // fields the stored ref schema does not.
      ref: { model: ref.model, providerInstanceId: ref.providerInstanceId },
    })
  }

  for (const ref of preferences.order) addRow(ref)
  for (const option of options) addRow(option.modelSelection)
  for (const ref of preferences.hidden) addRow(ref)

  return Array.from(rows.values())
}
