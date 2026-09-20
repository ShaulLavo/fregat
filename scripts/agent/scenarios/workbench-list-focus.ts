import { strictEqual, ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import { openGitPanel, runPaletteCommand, selectors } from '../selectors'

export const workbenchListFocus: Scenario = {
  name: 'workbench-list-focus',
  description:
    'Walk titlebar, files, git, logs, terminal tabs and sessions with one Tab stop per list.',
  async run(page, { step }) {
    await selectors.projectMenu(page).focus()
    await step('titlebar')
    await tabThroughTree(page)
    await step('files-list')
    await openGitPanel(page)
    await selectors.worktreeFiles(page).first().waitFor()
    await tabInto(page, selectors.gitChangeTree(page))
    await step('git-list')
    await selectors.logsTab(page).click()
    await selectors.logRows(page).first().waitFor()
    await tabInto(page, selectors.logList(page))
    await step('log-list')
    await runPaletteCommand(page, 'Show terminal')
    await selectors.newTerminal(page).click()
    await tabInto(page, selectors.terminalList(page))
    await step('terminal-list')
    await runPaletteCommand(page, 'Chat mode')
    await selectors.sessionRows(page).first().waitFor()
    await tabInto(page, selectors.sessionRail(page))
    await step('session-list')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await step('session-project-collapsed')
    await page.keyboard.press('ArrowRight')
    await step('session-project-expanded')
  },
}

async function tabInto(page: Page, list: Locator) {
  await list.waitFor()
  await list.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  strictEqual(await hasFocus(list), true, 'Tab must land on the list container')
  const internalStops = await selectors
    .focusableContents(list)
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element instanceof HTMLElement &&
            element.tabIndex >= 0 &&
            element.getClientRects().length > 0,
        )
        .map((element) => element.outerHTML.slice(0, 180)),
    )
  strictEqual(internalStops.length, 0, `Rows must not add Tab stops: ${internalStops.join(', ')}`)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  strictEqual(await hasFocus(list), true, 'Arrow navigation must retain list focus')
  await page.keyboard.press('Tab')
  ok(
    await list.evaluate((element) => !element.contains(element.ownerDocument.activeElement)),
    'Tab must leave the list in one step',
  )
  await page.keyboard.press('Shift+Tab')
  strictEqual(await hasFocus(list), true)
}

async function hasFocus(list: Locator) {
  return list.evaluate((element) => {
    const root = element.getRootNode()
    return (
      element ===
      (root instanceof ShadowRoot ? root.activeElement : element.ownerDocument.activeElement)
    )
  })
}

async function tabThroughTree(page: Page) {
  const row = selectors.focusedTreeRow(page)
  await row.waitFor()
  await row.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  strictEqual(await hasFocus(row), true)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  strictEqual(await row.count(), 1)
  strictEqual(await hasFocus(row), true)
  await page.keyboard.press('Tab')
  strictEqual(await hasFocus(row), false)
}
