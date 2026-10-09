import { scratchPath } from '../paths'
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'

import { openFolderPickerList, openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

export const filePickerNavigation: Scenario = {
  name: 'file-picker-navigation',
  description:
    'Leave empty folders with keyboard navigation and page above search section headers.',
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-picker-navigation-'))
    const prefix = `picker-${crypto.randomUUID()}`
    await Promise.all(
      ['empty', `${prefix}-a`, `${prefix}-b`].map((name) => mkdir(path.join(root, name))),
    )
    try {
      await openFolderPickerList(page)
      await selectors.pickerOptions(page).first().waitFor()
      await step('folder-picker-ready')
      for (const key of ['Backspace', 'ArrowLeft']) {
        await openFolderPath(page, path.join(root, 'empty'))
        await selectors.pickerEmpty(page).waitFor()
        await selectors.pickerList(page).focus()
        await step(`empty-folder-before-${key}`)
        await page.keyboard.press(key)
        await selectors
          .pickerOptions(page)
          .filter({ hasText: prefix })
          .first()
          .waitFor({ timeout: 5000 })
        await step(`parent-after-${key}`)
        await expectNoFadeWhenFits(selectors.pickerList(page))
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

/** A list whose rows all fit fades neither edge, whatever it showed before. */
async function expectNoFadeWhenFits(list: Locator) {
  const state = await list.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('[data-slot="virtual-list"]') ?? element
    const style = getComputedStyle(scroller)
    return {
      fits: scroller.scrollHeight <= scroller.clientHeight,
      top: style.getPropertyValue('--scroll-fade-top'),
      bottom: style.getPropertyValue('--scroll-fade-bottom'),
    }
  })
  ok(state.fits, 'The parent folder rows must fit without scrolling')
  deepStrictEqual({ top: state.top, bottom: state.bottom }, { top: '0px', bottom: '0px' })
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

async function openFolderPath(page: Page, folder: string) {
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(folder)
  await selectors.pickerFolderPath(page).press('Enter')
  await selectors.pickerFolderPath(page).waitFor({ state: 'hidden' })
}
