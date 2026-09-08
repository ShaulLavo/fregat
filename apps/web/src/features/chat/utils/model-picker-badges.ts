import type { ProviderModelOption } from '@workspace/client-core/chat/providers/models'

/** One chip on a picker row. `title` is the hover text; the label is the chip. */
export type ModelPickerBadge = {
  readonly key: string
  readonly label: string
  readonly title: string
}

/**
 * Models worth flagging as newly added, keyed `driverKind:slug`. A hand-kept set
 * because no provider tells us a release date: the snapshot carries a slug, a
 * name and capabilities, and nothing that orders two models in time. Codex pages
 * its catalog live, so only the hardcoded Claude catalog can be flagged here.
 * Emptying this set is the correct edit once a model stops being news.
 */
const NEW_MODEL_KEYS = new Set<string>(['claude:claude-opus-5', 'claude:claude-opus-5[1m]'])

export function isNewProviderModel(option: ProviderModelOption): boolean {
  return NEW_MODEL_KEYS.has(`${option.driverKind}:${option.modelSelection.model}`)
}

/**
 * The metadata chips for one row, most specific first. These are properties of
 * the model itself — the chosen reasoning level lives on the composer's own
 * options control, never in this list.
 */
export function modelPickerRowBadges(option: ProviderModelOption): ModelPickerBadge[] {
  const badges: ModelPickerBadge[] = []
  if (option.isCustom) {
    badges.push({ key: 'custom', label: 'Custom', title: 'Model added by your configuration' })
  }
  if (option.supportsThinking) {
    badges.push({ key: 'thinking', label: 'Thinks', title: 'Supports extended thinking' })
  }

  return badges
}
