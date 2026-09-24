import { ok, strictEqual } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import type { Scenario } from './index'

// The user layer is the one a browser can reach: the workspace layer belongs to the server's root.
const settingsFile =
  process.env.PLATFORM_SETTINGS_FILE ?? path.join(homedir(), '.platform', 'settings.json')
const PROBE_KEY = 'agent.probe.unknownKey'

export const settingsStaleDiagnostics: Scenario = {
  name: 'settings-stale-diagnostics',
  description:
    'Plant an unknown key in user settings, see its warning, watch it hide while the text is edited and return on undo; the file is restored afterwards.',
  async run(page, { step }) {
    const original = await readFile(settingsFile, 'utf8')
    ok(original.trimStart().startsWith('{'), 'user settings must be a JSON object')
    try {
      await writeFile(settingsFile, original.replace('{', `{\n  "${PROBE_KEY}": true,`))
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).waitFor()
      await selectors.settingsScopeTab(page, 'User').click()
      await selectors.settingsJsonView(page).click()
      await selectors.editorRows(page).filter({ hasText: PROBE_KEY }).waitFor({ timeout: 15_000 })
      const marked = await settledWarnings(page, (count) => count > 0)
      await step('diagnostic-marked')

      // Edited text no longer matches the file the diagnostics describe, so every mark goes. The
      // edit stays on line 1: a highlight holds only mounted rows, so the marked row must stay put.
      await page.locator('.editor-virtualized-viewport').first().click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('End')
      await page.keyboard.type(' ')
      strictEqual(await settledWarnings(page, (count) => count === 0), 0)
      await step('stale-diagnostics-hidden')

      await page.keyboard.press('Control+z')
      strictEqual(await settledWarnings(page, (count) => count === marked), marked)
      await step('diagnostics-restored')
    } finally {
      await writeFile(settingsFile, original)
    }
  },
}

/** Ranges painted by the settings warning highlight, once they satisfy `accept`. */
async function settledWarnings(page: Page, accept: (count: number) => boolean): Promise<number> {
  const deadline = Date.now() + 8000
  let count = -1
  while (Date.now() < deadline) {
    count = await page.evaluate(() => {
      let ranges = 0
      for (const [name, highlight] of CSS.highlights) {
        if (name.endsWith('-settings-diagnostics-warning')) ranges += highlight.size
      }
      return ranges
    })
    if (accept(count)) return count
    await page.waitForTimeout(100)
  }
  throw new Error(`settings warnings never settled; last count ${count}`)
}
