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

export const settingsOpenNavigation: Scenario = {
  name: 'settings-open-navigation',
  description:
    'Open Settings, search and clear, use a row menu from the keyboard, then reload a deeply scrolled page and keep its position.',
  capture: settingsOpen.capture,
  async run(page, context) {
    await settingsOpen.run(page, context)
    const { step } = context
    const actions = selectors.settingsRowActions(page, 'chat.planModeEnabled')
    await actions.focus()
    await page.keyboard.press('ArrowDown')
    await page
      .getByRole('menuitem', { name: 'Copy setting ID', exact: true })
      .waitFor({ timeout: 5000 })
    await step('settings-menu-keyboard')
    await page.keyboard.press('Escape')
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    ok(
      await actions.evaluate((element) => element === document.activeElement),
      'Escape restores focus to the row actions button',
    )
    await step('settings-menu-closed')

    await selectors.settingsSearch(page).focus()
    await selectors.settingsForm(page).hover()
    await page.mouse.wheel(0, 3000)
    await page.waitForFunction(
      (element) => element !== null && element.scrollTop > 1000,
      await selectors.settingsForm(page).elementHandle(),
    )
    await step('settings-scrolled')
    const scrollTop = await selectors.settingsForm(page).evaluate((element) => element.scrollTop)
    ok(scrollTop > 1000, 'the reload check starts well below the first mounting pass')
    await page.reload()
    await selectors.settingsRow(page, LAST_ROW).waitFor({ state: 'attached' })
    await page.waitForFunction(
      ({ element, offset }) => element !== null && Math.abs(element.scrollTop - offset) < 1,
      { element: await selectors.settingsForm(page).elementHandle(), offset: scrollTop },
    )
    await step('settings-scroll-restored')
    const restored = await selectors.settingsForm(page).evaluate((element) => element.scrollTop)
    ok(
      Math.abs(restored - scrollTop) < 1,
      `scroll restores after all rows mount: ${scrollTop} -> ${restored}`,
    )
  },
}
