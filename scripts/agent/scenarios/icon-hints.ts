import { strictEqual } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

async function checkHint(page: Page, control: Locator, label: string) {
  await page.mouse.move(0, 0)
  await control.hover()
  await selectors.hint(page, label).waitFor({ timeout: 3_000 })
  strictEqual(await control.getAttribute('title'), null, `${label} must have only one hint`)
}

export const iconHints: Scenario = {
  name: 'icon-hints',
  description: 'Hover shared toolbar and input actions, then exercise their click behavior.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Workbench').click()
    await selectors.sidebarTab(page, 'Git').click()
    await selectors.gitPanel(page).waitFor()
    await selectors.graphButton(page).click()
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    await selectors.historyCurrent(page).hover()
    await step('history-current-hover')
    await checkHint(page, selectors.historyCurrent(page), 'Go to current commit')
    await step('history-current-hint')
    await page.mouse.move(0, 0)
    await selectors.historySearch(page).click()
    await selectors.historySearch(page).fill('tooltip')
    await checkHint(page, selectors.historyClearSearch(page), 'Clear history search')
    await step('history-clear-hint')
    await selectors.historyClearSearch(page).click()
    strictEqual(await selectors.historySearch(page).inputValue(), '')
    await checkHint(page, selectors.historyExpand(page), 'Expand commit graph')
    await selectors.historyExpand(page).click()
    await selectors.historyDialog(page).waitFor()
    const close = selectors.iconHintControl(selectors.historyDialog(page), 'Close')
    await checkHint(page, close, 'Close')
    await step('dialog-close-hint')
    await close.click()
    await selectors.historyDialog(page).waitFor({ state: 'hidden' })
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.workspaceSearch(page).fill('useListbox')
    await selectors.searchResultTree(page).waitFor({ timeout: 20_000 })
    for (const label of [
      'Expand all search results',
      'Collapse all search results',
      'Previous match',
      'Next match',
    ]) {
      await checkHint(page, selectors.iconHintControl(page, label), label)
      await step(label.toLowerCase().replaceAll(' ', '-'))
    }
    await selectors.iconHintControl(page, 'Collapse all search results').click()
    await checkHint(
      page,
      selectors.iconHintControl(page, 'Expand all search results'),
      'Expand all search results',
    )
    await selectors.iconHintControl(page, 'Expand all search results').click()
    await step('search-expanded')
    const expand = selectors.iconHintControl(page, 'Expand all search results')
    strictEqual(await expand.isDisabled(), true)
    const disabledFill = await expand.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    await checkHint(page, expand, 'Expand all search results')
    strictEqual(await expand.evaluate((element) => getComputedStyle(element).opacity), '0.5')
    strictEqual(
      await expand.evaluate((element) => getComputedStyle(element).backgroundColor),
      disabledFill,
    )
    await page.mouse.move(0, 0)
    await expand.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await selectors.hint(page, 'Expand all search results').waitFor()
    await step('disabled-search-keyboard-hint')
  },
}
