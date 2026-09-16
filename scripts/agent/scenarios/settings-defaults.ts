import { strictEqual } from 'node:assert/strict'

import type { Scenario } from './index'
import { selectors } from '../selectors'

export const settingsDefaults: Scenario = {
  name: 'settings-defaults',
  description:
    'Open settings, switch to the Defaults tab, and check the generated document is shown read-only.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).waitFor()
    await selectors.settingsScopeTab(page, 'Defaults').click()
    await selectors.settingsDefaultsBanner(page).waitFor()
    const input = selectors.editorInput(page).first()
    await input.waitFor({ timeout: 15_000 })
    await page.getByText('Every setting this build knows about', { exact: false }).waitFor()
    await step('defaults-document')
    // A keystroke into the document must change nothing: the buffer is read-only.
    const before = await page.locator('.editor-virtualized-viewport').first().innerText()
    await page.locator('.editor-virtualized-viewport').first().click()
    await page.keyboard.type('x')
    await page.waitForTimeout(200)
    const after = await page.locator('.editor-virtualized-viewport').first().innerText()
    strictEqual(after, before, 'typing into the defaults document changed its text')
    await step('after-typing')
    await selectors.settingsScopeTab(page, 'User').click()
    await selectors.settingsDefaultsBanner(page).waitFor({ state: 'hidden' })
    await step('back-to-user')
  },
}
