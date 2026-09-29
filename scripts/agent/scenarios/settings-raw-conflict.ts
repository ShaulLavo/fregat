import { ok } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

import { platformHomePath } from '../../../apps/server/src/home'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const EXTERNAL_KEY = '"editor.lineHeight": 31'

export const settingsRawConflict: Scenario = {
  name: 'settings-raw-conflict',
  description:
    'Edit user settings.json in the app, change the file on disk, save: the conflict banner offers Use the latest version, Compare and Keep my changes. The file is restored afterwards.',
  async run(page, { step }) {
    // `agent:browser` points PLATFORM_HOME at the server under test.
    const settingsFile = platformHomePath('settings.json')
    const original = await readFile(settingsFile, 'utf8').catch(() => '{}\n')
    ok(original.trimStart().startsWith('{'), 'user settings must be a JSON object')
    try {
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).waitFor()
      await selectors.settingsScopeTab(page, 'User').click()
      await selectors.settingsJsonView(page).click()
      await page.locator('.editor-virtualized-viewport').first().click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.type(' ')
      await step('edited')

      await writeFile(settingsFile, original.replace('{', `{\n  ${EXTERNAL_KEY},`))
      await page.keyboard.press('Control+s')
      const banner = selectors.settingsRawConflictBanner(page)
      await banner.waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Keep my changes', exact: true }).waitFor()
      await step('conflict')

      await page.getByRole('button', { name: 'Compare', exact: true }).click()
      await page.getByText('Latest version', { exact: true }).waitFor()
      await page.getByText(EXTERNAL_KEY).last().waitFor({ timeout: 10_000 })
      await step('compare')
    } finally {
      await writeFile(settingsFile, original)
    }
  },
}
