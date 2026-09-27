import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

const LAST_ROW = 'keybindings.overrides'

async function shownRows(page: Page) {
  return page.locator('[data-setting-row]').count()
}

async function summaryCount(page: Page) {
  const text = await selectors.settingsSummaryCount(page).innerText()
  return Number(/(\d+) settings?/.exec(text)?.[1] ?? Number.NaN)
}

export const settingsOpen: Scenario = {
  name: 'settings-open',
  description:
    'Open Settings with Ctrl+, and wait for every row, down to the shortcut list at the bottom. Search for "font" and check a row is shown for every match, then clear the search so the whole page mounts again. Trace it to see what mounting the page costs the main thread.',
  capture: { width: 1440, height: 1000 },
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsRow(page, LAST_ROW).waitFor({ state: 'attached' })
    const all = await summaryCount(page)
    ok(all > 50, `the page counts every setting (${all})`)
    await step('settings-open')

    await selectors.settingsSearch(page).fill('font')
    await selectors
      .settingsSummaryCount(page)
      .filter({ hasNotText: `${all} settings` })
      .waitFor()
    const matched = await summaryCount(page)
    ok(matched > 0 && matched < all, `"font" narrows the page (${matched} of ${all})`)
    strictEqual(await shownRows(page), matched, 'search shows a row for every match')
    await step('settings-search')

    await selectors.settingsSearch(page).fill('')
    await selectors
      .settingsSummaryCount(page)
      .filter({ hasText: `${all} settings` })
      .waitFor()
    strictEqual(await shownRows(page), all, 'clearing the search shows every row again')
    await step('settings-search-cleared')
  },
}
