import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const providersRoute = /\/providers(\?|$)/

export const settingsModelsPending: Scenario = {
  name: 'settings-models-pending',
  description: 'The model list holds its "No models" verdict while providers are being read.',
  async run(page, { step }) {
    // Hold the provider read, then reload so no cached list answers first.
    await page.route(providersRoute, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      await route.continue()
    })
    try {
      await page.reload()
      await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('models')
      await selectors.settingsModelsLoading(page).waitFor({ timeout: 2_400 })
      strictEqual(await selectors.settingsNoModels(page).count(), 0, 'No verdict while pending')
      await step('pending')
      await selectors.settingsModelsLoading(page).waitFor({ state: 'detached', timeout: 10_000 })
      await step('loaded')
    } finally {
      await page.unroute(providersRoute)
    }
  },
}
