import { scratchPath } from '../paths'
import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { openFolderPickerList, openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

export const filePickerNavigation: Scenario = {
  name: 'file-picker-navigation',
  description:
    'Leave empty folders with keyboard navigation, keeping the folder left selected, and page above search section headers.',
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-picker-navigation-'))
    const prefix = `picker-${crypto.randomUUID()}`
    // Sorted last, so the list's fallback cursor on its first row cannot pass for its selection.
    const child = 'zz-empty'
    await Promise.all(
      [child, `${prefix}-a`, `${prefix}-b`].map((name) => mkdir(path.join(root, name))),
    )
    try {
      await openFolderPickerList(page)
      await selectors.pickerOptions(page).first().waitFor()
      await step('folder-picker-ready')
      for (const key of ['Backspace', 'ArrowLeft']) {
        await openFolderPath(page, path.join(root, child))
        await selectors.pickerEmpty(page).waitFor()
        await selectors.pickerList(page).focus()
        await step(`empty-folder-before-${key}`)
        await page.keyboard.press(key)
        await selectors
          .pickerOptions(page)
          .filter({ hasText: prefix })
          .first()
          .waitFor({ timeout: 5000 })
        await expectSelectedRow(page, child, path.join(root, child))
        await step(`parent-after-${key}`)
      }
      await selectors.pickerSearch(page).fill(prefix)
      const list = selectors.pickerList(page)
      await selectors.pickerCurrentFolderHeading(page).waitFor()
      await page.waitForFunction(
        (element) => element?.getAttribute('aria-busy') === 'false',
        await list.elementHandle(),
      )
      await selectors.pickerOptions(page).nth(1).waitFor()
      const first = await selectors.pickerOptions(page).first().getAttribute('id')
      ok(first, 'The first folder option must have an active-descendant target')
      await list.focus()
      await page.keyboard.press('Home')
      strictEqual(await list.getAttribute('aria-activedescendant'), first)
      await page.keyboard.press('ArrowDown')
      ok((await list.getAttribute('aria-activedescendant')) !== first)
      await step('grouped-search-second-entry')
      await page.keyboard.press('PageUp')
      strictEqual(await list.getAttribute('aria-activedescendant'), first)
      await step('grouped-search-page-up')
    } finally {
      await page.keyboard.press('Escape')
      await rm(root, { recursive: true, force: true })
    }
  },
}

export const gitHistoryScroll: Scenario = {
  name: 'git-history-scroll',
  description: 'Restore scrolled Git history after leaving the pane without selecting a commit.',
  async run(page, { step }) {
    await openGitPanel(page)
    await selectors.graphButton(page).click()
    const list = selectors.historyList(page)
    await selectors.historyRows(page).first().waitFor()
    await list.hover()
    await page.mouse.wheel(0, 650)
    await page.waitForFunction(
      (element) => element !== null && element.scrollTop > 100,
      await list.elementHandle(),
    )
    await page.waitForTimeout(300)
    const offset = await list.evaluate((element) => element.scrollTop)
    await step('history-scrolled-without-selection')
    await selectors.sidebarTab(page, 'Files').click()
    await openGitPanel(page)
    await list.waitFor()
    await page.waitForFunction(
      ({ element, offset }) => element !== null && Math.abs(element.scrollTop - offset) < 2,
      { element: await list.elementHandle(), offset },
      { timeout: 5000 },
    )
    await step('history-scroll-restored')
  },
}

/** The row is selected, painted as selected, the list's active row, and the previewed folder. */
async function expectSelectedRow(page: Page, name: string, folder: string) {
  const row = selectors.pickerRow(page, name)
  await row.and(page.locator('[aria-selected="true"]')).waitFor({ timeout: 5000 })
  await selectors.pickerPreviewPath(page, folder.replace(/^\//u, '')).waitFor({ timeout: 5000 })
  const id = await row.getAttribute('id')
  strictEqual(await selectors.pickerList(page).getAttribute('aria-activedescendant'), id)
  const paint = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
  ok(paint !== 'rgba(0, 0, 0, 0)', `The selected row must paint a highlight, got ${paint}`)
}

async function openFolderPath(page: Page, folder: string) {
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(folder)
  await selectors.pickerFolderPath(page).press('Enter')
  await selectors.pickerFolderPath(page).waitFor({ state: 'hidden' })
}
