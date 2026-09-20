import { strictEqual, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openGitPanel, runPaletteCommand, selectors } from '../selectors'

export const gitChanges: Scenario = {
  name: 'git-changes',
  description:
    'Navigate changed files and groups from one focus target and open the active file menu.',
  async run(page, { step }) {
    await openGitPanel(page)
    const toggle = selectors.changesToggle(page)
    if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click()
    await selectors.worktreeFiles(page).first().waitFor()
    const tree = selectors.gitChangeTree(page)
    strictEqual(
      await selectors.listTabStops(tree).count(),
      0,
      'Only the tree container is a Tab stop',
    )
    await step('changes-list')
    await selectors.worktreeFiles(page).first().click()
    await step('selected-file')
    await tree.focus()
    const first = await tree.getAttribute('aria-activedescendant')
    await page.keyboard.press('ArrowDown')
    ok((await tree.getAttribute('aria-activedescendant')) !== first)
    strictEqual(
      await tree.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    await step('next-file')
    await page.keyboard.press('Shift+F10')
    await selectors.menuSurface(page, 'git.file').waitFor()
    await step('active-file-menu')
    await page.keyboard.press('Escape')
    await tree.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await step('collapsed-group')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('End')
    await step('last-file')
    await page.keyboard.press('ArrowUp')
    await step('cursor-only-previous-file')
    strictEqual(
      await tree.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
  },
}

export const logsPanel: Scenario = {
  name: 'logs-panel',
  description:
    'Inspect filesystem log events and move the keyboard selection through the measured list.',
  async run(page, { step }) {
    await selectors.logsTab(page).click()
    await selectors.logsSearch(page).fill('fs')
    await selectors.logRows(page).first().waitFor({ timeout: 20_000 })
    const list = selectors.logList(page)
    strictEqual(
      await selectors.listTabStops(list).count(),
      0,
      'Only the log container is a Tab stop',
    )
    await step('log-events')
    await selectors.logRows(page).first().click()
    await step('inspected-event')
    const first = await list.getAttribute('aria-activedescendant')
    await page.keyboard.press('ArrowDown')
    ok((await list.getAttribute('aria-activedescendant')) !== first)
    strictEqual(
      await list.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    await step('next-event')
    await page.keyboard.press('Enter')
    await step('keyboard-inspected-event')
  },
}

export const sessionRail: Scenario = {
  name: 'session-rail',
  description: 'Open the session rail and select an existing session without sending a message.',
  async run(page, { step }) {
    await runPaletteCommand(page, 'Chat mode')
    await selectors.chatNewSession(page).waitFor()
    await step('session-rail')
    const row = selectors.sessionRows(page).first()
    if (!(await row.isVisible())) return
    await row.click()
    await step('selected-session')
    await selectors.sessionRail(page).focus()
    await page.keyboard.press('ArrowDown')
    strictEqual(
      await selectors
        .sessionRail(page)
        .evaluate((element) => element === element.ownerDocument.activeElement),
      true,
      await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 600)),
    )
    await step('next-session')
    const list = selectors.sessionRail(page)
    const before = await selectors
      .sessionRows(page)
      .evaluateAll((rows) => rows.map((row) => row.id))
    const activeId = await list.getAttribute('aria-activedescendant')
    await page.keyboard.press('Space')
    await selectors.sessionDraggingRow(page).waitFor()
    await step('session-picked-up')
    await page.keyboard.press('ArrowDown')
    await step('session-drag-moved')
    strictEqual(await list.getAttribute('aria-activedescendant'), activeId)
    await page.keyboard.press('Escape')
    await selectors.sessionDraggingRow(page).waitFor({ state: 'hidden' })
    const settled = await selectors.sessionRows(page).evaluateAll(async (rows) => {
      for (let frame = 0; frame < 60; frame++) {
        if (rows.every((row) => Math.abs(new DOMMatrix(getComputedStyle(row).transform).m42) < 0.5))
          return true
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      return false
    })
    strictEqual(settled, true, 'Cancelled drag transforms must settle')
    strictEqual(
      await list.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    strictEqual(
      JSON.stringify(
        await selectors.sessionRows(page).evaluateAll((rows) => rows.map((row) => row.id)),
      ),
      JSON.stringify(before),
    )
    await step('session-drag-cancelled')
  },
}

export const filesTree: Scenario = {
  name: 'files-tree',
  description: 'Inspect file tree row paint while moving the keyboard cursor.',
  async run(page, { step }) {
    await selectors.folderTree(page).waitFor()
    await selectors.focusedTreeRow(page).focus()
    await page.keyboard.press('Home')
    await step('first-file')
    await page.keyboard.press('ArrowDown')
    await step('next-file')
  },
}

export const filePicker: Scenario = {
  name: 'file-picker',
  description:
    'Open the folder picker, navigate its single focus target, and verify virtual row semantics.',
  async run(page, { step }) {
    await selectors.projectMenu(page).click()
    await selectors.openFolderMenu(page).click()
    await selectors.pickerOptions(page).first().waitFor()
    await step('folder-picker')
    const list = selectors.pickerList(page)
    await list.focus()
    await page.keyboard.press('Home')
    const first = await list.getAttribute('aria-activedescendant')
    await page.keyboard.press('ArrowDown')
    const second = await list.getAttribute('aria-activedescendant')
    ok(first && second && first !== second, 'ArrowDown must select another entry')
    strictEqual(
      await list.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    for (const option of await selectors.pickerOptions(page).all()) {
      strictEqual(await option.getAttribute('tabindex'), '-1')
      ok(Number(await option.getAttribute('aria-posinset')) > 0)
      ok(Number(await option.getAttribute('aria-setsize')) > 0)
    }
    await step('picker-keyboard-selection')
    await page.keyboard.press('End')
    await step('picker-last-entry')
    await page.keyboard.press('Escape')
  },
}

export const searchResults: Scenario = {
  name: 'search-results',
  description:
    'Search the workspace, walk results and collapse a file group from the list container.',
  async run(page, { step }) {
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.workspaceSearch(page).fill('useListbox')
    const tree = selectors.searchResultTree(page)
    await tree.waitFor({ timeout: 20_000 })
    strictEqual(
      await selectors
        .focusableContents(tree)
        .evaluateAll(
          (elements) =>
            elements.filter((element) => element instanceof HTMLElement && element.tabIndex >= 0)
              .length,
        ),
      0,
    )
    await tree.focus()
    await page.keyboard.press('Home')
    await step('search-first-result')
    const first = await tree.getAttribute('aria-activedescendant')
    await page.keyboard.press('ArrowDown')
    ok((await tree.getAttribute('aria-activedescendant')) !== first)
    strictEqual(
      await tree.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    await step('search-next-result')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await step('search-collapsed')
    await selectors.replaceToggle(page).click()
    await tree.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('F2')
    strictEqual(
      await selectors
        .activeResultReplace(page)
        .evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    await step('search-replace-action-focused')
    await page.keyboard.press('Escape')
    strictEqual(
      await tree.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
  },
}

export const terminalTabs: Scenario = {
  name: 'terminal-tabs',
  description: 'Navigate terminal tabs from their one list focus target.',
  async run(page, { step }) {
    await runPaletteCommand(page, 'Show terminal')
    await selectors.newTerminal(page).click()
    const list = selectors.terminalList(page)
    await list.waitFor()
    await list.focus()
    await page.keyboard.press('Home')
    await step('terminal-first-tab')
    await page.keyboard.press('End')
    strictEqual(
      await list.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    await step('terminal-last-tab')
    await page.keyboard.press('F2')
    await selectors.terminalName(page).waitFor()
    await selectors.terminalName(page).fill('Pattern verification')
    await page.keyboard.press('Enter')
    await list.focus()
    await step('terminal-renamed')
    const before = await selectors
      .terminalRows(page)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-terminal-tab-id')))
    const selected = await list.getAttribute('aria-activedescendant')
    await page.keyboard.press('Space')
    const dragging = selectors.terminalDraggingRow(page)
    await dragging.waitFor()
    await step('terminal-picked-up')
    await page.keyboard.press('ArrowUp')
    await page.waitForFunction(
      (row) => row && new DOMMatrix(getComputedStyle(row).transform).m42 < 0,
      await dragging.elementHandle(),
    )
    strictEqual(
      await list.getAttribute('aria-activedescendant'),
      selected,
      'Dragging must preserve the selected terminal',
    )
    await page.keyboard.press('Space')
    await step('terminal-keyboard-reordered')
    const after = await selectors
      .terminalRows(page)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-terminal-tab-id')))
    ok(JSON.stringify(before) !== JSON.stringify(after), 'Keyboard drag must reorder tabs')
    strictEqual(
      await list.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
      'Dropping returns focus to the terminal list',
    )
    await page.keyboard.press('Enter')
    await expectTerminalFocus(page)
    await step('terminal-keyboard-activated')
    await list.focus()
    await selectors.terminalRows(page).first().click()
    await step('terminal-tab-clicked')
    await expectTerminalFocus(page)
    await step('terminal-input-focused')
  },
}

async function expectTerminalFocus(page: Page) {
  await page.waitForFunction(
    (element) => element?.contains(element.ownerDocument.activeElement),
    await selectors.terminalSurface(page).elementHandle(),
    { timeout: 5000 },
  )
}

export const gitGraphKeyboard: Scenario = {
  name: 'git-graph-keyboard',
  description: 'Navigate the graph and open a historical changed file entirely from list focus.',
  async run(page, { step }) {
    await openGitPanel(page)
    await selectors.graphButton(page).click()
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    const list = selectors.historyList(page)
    await list.focus()
    await page.keyboard.press('Home')
    const first = await list.getAttribute('aria-activedescendant')
    await page.keyboard.press('ArrowDown')
    ok((await list.getAttribute('aria-activedescendant')) !== first)
    strictEqual(
      await list.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
    await step('graph-keyboard-next')
    await page.keyboard.press('PageDown')
    await step('graph-keyboard-page')
    await page.keyboard.press('Home')
    await selectors.historyFiles(page).first().waitFor({ timeout: 15_000 })
    await selectors.commitFilesTree(page).focus()
    await page.keyboard.press('Home')
    await step('commit-files-keyboard')
    await page.keyboard.press('Enter')
    await page.waitForURL(/historical/, { timeout: 15_000 })
    await step('historical-diff')
  },
}
