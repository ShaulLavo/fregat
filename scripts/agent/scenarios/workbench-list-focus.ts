import { strictEqual, ok } from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import {
  createModifiedFileFixture,
  fixtureApiBase,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, runPaletteCommand, selectors } from '../selectors'
import { createSession, dispatch, readShell } from './chat-verification'

export const workbenchListFocus: Scenario = {
  name: 'workbench-list-focus',
  description:
    'In a disposable repository with one changed file and two idle sessions, walk titlebar, files, git, logs, terminal tabs and sessions with one Tab stop per list.',
  async run(page, { step }) {
    // A throwaway server has no sessions, and a clean checkout has no changes to list.
    const fixture = await createModifiedFileFixture(
      'workbench-list-focus',
      'a.txt',
      ['one'],
      ['two'],
    )
    const sessions: { base: string; ids: string[] } = { base: '', ids: [] }
    try {
      await openFixtureWorkspace(page, fixture)
      Object.assign(sessions, await createFixtureSessions(page, fixture))
      await walkLists(page, step)
    } finally {
      for (const sessionId of sessions.ids)
        await dispatch(page, sessions.base, { type: 'session.delete', sessionId })
      await releaseFixture(fixture)
    }
  },
}

async function walkLists(page: Page, step: (name: string) => Promise<void>) {
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
}

/** Two sessions that never run a turn, on the fixture's checkout. */
async function createFixtureSessions(page: Page, fixture: string) {
  const base = `${fixtureApiBase(page)}/orchestration`
  const root = await realpath(fixture)
  const deadline = Date.now() + 20_000
  for (;;) {
    const shell = await readShell(page, base)
    const worktree = shell.worktrees.find((item) => item.canonicalPath === root)
    if (worktree) {
      const project = shell.projects.find((item) => item.id === worktree.projectId)
      const ids = [crypto.randomUUID(), crypto.randomUUID()]
      for (const [index, sessionId] of ids.entries())
        await createSession(page, { base, project, worktree }, sessionId, `List focus ${index + 1}`)
      return { base, ids }
    }
    ok(Date.now() < deadline, `The fixture checkout must be registered: ${root}`)
    await page.waitForTimeout(200)
  }
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
