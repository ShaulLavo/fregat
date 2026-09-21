import { ok } from 'node:assert/strict'

import { selectors } from '../selectors'
import type { Scenario } from './index'

const writeRoute = /\/settings\/write$/

/** The shape a stale server returns when the web build offers a key it lacks. */
const REJECTION = {
  error: {
    code: 'settings.UNKNOWN_KEY',
    message: 'Unknown setting: workbench.surface.continuousSeams',
    why: 'The write named a setting this build does not register.',
    fix: 'A web build newer than the server offers settings the server cannot store — compare GET /platform/release.',
  },
}

export const settingsSaveRejected: Scenario = {
  name: 'settings-save-rejected',
  description: 'A rejected settings save shows the catalog message and its fix, not a bare title.',
  async run(page, { step }) {
    await page.route(writeRoute, (route) =>
      route.fulfill({ body: JSON.stringify(REJECTION), status: 400 }),
    )
    try {
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('seams')
      await selectors.settingsContinuousSeams(page).click()

      const toast = selectors.toast(page, 'Could not save settings')
      await toast.waitFor({ timeout: 10_000 })
      // Sonner fades and slides the toast in; screenshot after it settles.
      await toast.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(600)
      const text = await toast.innerText()
      ok(text.includes('Unknown setting'), `toast lost the server message: ${text}`)
      ok(text.includes('newer than the server'), `toast lost the catalog fix: ${text}`)
      await step('rejected')

      await selectors.toastAction(page, 'Could not save settings', 'Discard').click()
      await toast.waitFor({ state: 'hidden', timeout: 10_000 })
      await step('discarded')
    } finally {
      await page.unroute(writeRoute)
    }
  },
}
