import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { chords, openFileByName, selectors } from '../selectors'
import { createIdleSessions, dispatch, openChatWorkspace } from './chat-verification'
import type { Scenario } from './index'

function hints(page: Page, scope: string) {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll(`${selector} [data-shortcut-hint]`)].map(
        (element) => element.getAttribute('data-shortcut-hint') ?? '',
      ),
    scope,
  )
}

function tabBoxes(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-tab-path]')].map((element) => {
      const box = element.getBoundingClientRect()
      return [box.x, box.y, box.width, box.height].map(Math.round)
    }),
  )
}

async function release(page: Page, ...keys: string[]) {
  for (const key of keys.toReversed()) await page.keyboard.up(key)
}

export const shortcutHints: Scenario = {
  name: 'shortcut-hints',
  description:
    'Holding Mod badges editor tabs (workbench) and session rows (chat); Mod+Alt badges sidebar panels, or a strip where the hidden sidebar was. Releasing clears them and nothing moves.',
  async run(page, { step }) {
    const workspace = await openChatWorkspace(page)
    const prefix = `Shortcut hints ${crypto.randomUUID().slice(0, 8)}`
    const ids = await createIdleSessions(page, workspace, prefix, 3)
    try {
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionByTitle(page, `${prefix} 3`).waitFor()
      await page.keyboard.down('Control')
      deepStrictEqual(await hints(page, '[data-screen-sidebar]'), ['1', '2', '3'])
      await step('chat-rows-held')
      await release(page, 'Control')
      deepStrictEqual(await hints(page, 'body'), [])
    } finally {
      for (const sessionId of ids)
        await dispatch(page, workspace.base, { type: 'session.delete', sessionId })
    }

    await selectors.workspaceMode(page, 'Workbench').click()
    for (const name of ['AGENTS.md', 'PLAN.md', 'README.md']) await openFileByName(page, name)
    const before = await tabBoxes(page)
    await page.keyboard.down('Control')
    deepStrictEqual(await hints(page, '[role="tablist"][aria-label="Editor tabs"]'), [
      '1',
      '2',
      '3',
    ])
    deepStrictEqual(await hints(page, '[aria-label="Sidebar tabs"]'), [])
    deepStrictEqual(await tabBoxes(page), before, 'Badges must not move the tabs')
    await step('tabs-held')

    await page.keyboard.down('Alt')
    deepStrictEqual(await hints(page, '[aria-label="Sidebar tabs"]'), ['1', '2', '3', '4', '5'])
    deepStrictEqual(await hints(page, '[role="tablist"][aria-label="Editor tabs"]'), [])
    await step('panels-held')

    await page.keyboard.down('Shift')
    deepStrictEqual(await hints(page, 'body'), [], 'An extra modifier hides every hint')
    await release(page, 'Control', 'Alt', 'Shift')
    deepStrictEqual(await hints(page, 'body'), [])

    await page.keyboard.press(chords.toggleSidebar)
    await selectors.resizablePanel(page, 'sidebar').waitFor({ state: 'detached' })
    await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    deepStrictEqual(await hints(page, '[data-closed-sidebar-hints]'), ['1', '2', '3', '4', '5'])
    strictEqual(
      await selectors.resizablePanel(page, 'sidebar').count(),
      0,
      'Holding reopens nothing',
    )
    await step('closed-strip-held')
    await release(page, 'Control', 'Alt')
    strictEqual(await page.locator('[data-closed-sidebar-hints]').count(), 0)
    await step('released')
  },
}
