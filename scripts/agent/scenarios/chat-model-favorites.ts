import { ok } from 'node:assert/strict'
import * as v from 'valibot'
import { providerListResultSchema } from '../../../packages/contracts/src/index'
import type { Scenario } from './index'
import { settleAnimations } from '../selectors'
import { openChat, openModelPickerInNewSession } from './chat-verification'
import {
  restoreUserSettings,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

const MISSING_MODEL = 'retired-model-for-favorites'

/**
 * Plan 126 INTERACTION-14: favorites written through `model.setFavorite` gather under the
 * picker's Favorites rail entry, and one whose model left the catalogue stays, unavailable.
 */
export const chatModelFavorites: Scenario = {
  name: 'chat-model-favorites',
  description:
    'Star an offered model and one the provider no longer lists, then open the model picker: both show under Favorites, the missing one as No longer offered. Restores models.favorites.',
  async run(page, { step }) {
    const base = (await openChat(page)).replace(/\/orchestration$/, '')
    const providers = await page.request.get(`${base}/providers`, {
      headers: { Origin: new URL(page.url()).origin },
    })
    const provider = v
      .parse(providerListResultSchema, await providers.json())
      .providers.find((entry) => entry.models.length > 0)
    ok(provider, 'A provider offers at least one model')
    const offered = {
      providerInstanceId: provider.providerInstanceId,
      model: provider.models[0].slug,
    }
    const missing = { providerInstanceId: provider.providerInstanceId, model: MISSING_MODEL }
    const before = await settingsSnapshot(page, base)
    await writeSettings(page, base, [
      { kind: 'model.setFavorite', ref: offered, favorite: true },
      { kind: 'model.setFavorite', ref: missing, favorite: true },
    ])
    try {
      const panel = await openModelPickerInNewSession(page)
      await panel.getByRole('button', { name: 'Favorites', exact: true }).click()
      await panel.getByText('No longer offered', { exact: true }).waitFor()
      await panel.getByText(MISSING_MODEL, { exact: true }).waitFor()
      await settleAnimations(panel)
      await step('favorites-rail')
      await page.keyboard.press('Escape')
    } finally {
      await restoreUserSettings(page, base, before, ['models.favorites'])
    }
  },
}
