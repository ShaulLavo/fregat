import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { openFileByName, selectors } from '../selectors'
import { createIdleSessions, dispatch, openChatWorkspace } from './chat-verification'
import type { Scenario } from './index'

const FILES = ['AGENTS.md', 'PLAN.md', 'README.md'] as const

async function activeTab(page: Page) {
  const path = await selectors
    .editorGroupTabs(page, 0)
    .and(page.locator('[aria-selected="true"]'))
    .getAttribute('data-editor-tab-path')
  return path?.split('/').at(-1) ?? null
}

async function expectActiveTab(page: Page, name: string, message: string) {
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-editor-tab-path][aria-selected="true"]')
        ?.getAttribute('data-editor-tab-path')
        ?.endsWith(`/${expected}`) === true,
    name,
  )
  strictEqual(await activeTab(page), name, message)
}

function focusInSidebar(page: Page) {
  return page.evaluate(() => document.activeElement?.closest('[data-screen-sidebar]') != null)
}

function selectedSessionId(page: Page) {
  return decodeURIComponent(new URL(page.url()).pathname).split('/t/')[1] ?? null
}

export const itemNavigation: Scenario = {
  name: 'item-navigation',
  description:
    'Platform keys: Mod+digit and Mod+Alt+[ ] move through editor tabs in the workbench and chats in chat mode; Mod+Alt+digit opens and closes sidebar panels.',
  async run(page, { step }) {
    const workspace = await openChatWorkspace(page)
    const prefix = `Item navigation ${crypto.randomUUID().slice(0, 8)}`
    const ids = await createIdleSessions(page, workspace, prefix, 2)
    try {
      await selectors.sessionSearch(page).fill(prefix)
      for (const [index] of ids.entries())
        await selectors.sessionByTitle(page, `${prefix} ${index + 1}`).waitFor()
      const order = await page.evaluate(
        (titlePrefix) => [
          ...new Set(
            [...document.querySelectorAll<HTMLElement>('[title]')]
              .map((element) => element.getAttribute('title') ?? '')
              .filter((title) => title.startsWith(titlePrefix)),
          ),
        ],
        prefix,
      )
      const displayed = order.map((title) => ids[Number(title.at(-1)) - 1]!)

      await page.keyboard.press('Control+1')
      await page.waitForURL((url) => decodeURIComponent(url.href).includes(displayed[0]!))
      await page.keyboard.press('Control+2')
      await page.waitForURL((url) => decodeURIComponent(url.href).includes(displayed[1]!))
      await step('numbered-chats')

      await page.keyboard.press('Control+Alt+]')
      await page.waitForURL((url) => decodeURIComponent(url.href).includes(displayed[0]!))
      await page.keyboard.press('Control+Alt+1')
      await page.waitForTimeout(300)
      strictEqual(selectedSessionId(page), displayed[0], 'Panel keys never select chats')
      await step('adjacent-chats')
    } finally {
      for (const sessionId of ids)
        await dispatch(page, workspace.base, { type: 'session.delete', sessionId })
    }

    await selectors.workspaceMode(page, 'Workbench').click()
    for (const name of FILES) await openFileByName(page, name)
    await expectActiveTab(page, 'README.md', 'The last opened file is active')

    await page.keyboard.press('Control+1')
    await expectActiveTab(page, 'AGENTS.md', 'Mod+1 selects the first tab')
    await page.keyboard.press('Control+3')
    await expectActiveTab(page, 'README.md', 'Mod+3 selects the third tab')
    await page.keyboard.press('Control+9')
    await page.waitForTimeout(300)
    strictEqual(await activeTab(page), 'README.md', 'An empty slot leaves the selection alone')
    await step('numbered-tabs')

    await page.keyboard.press('Control+Alt+]')
    await expectActiveTab(page, 'AGENTS.md', 'Next wraps from the last tab to the first')
    await page.keyboard.press('Control+Alt+[')
    await expectActiveTab(page, 'README.md', 'Previous wraps from the first tab to the last')
    await step('adjacent-tabs')

    await selectors.terminalSurface(page).first().click()
    await page.keyboard.press('Control+2')
    await expectActiveTab(page, 'PLAN.md', 'Mod+2 reaches the tab strip from the terminal')
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Editor input',
    )
    await step('from-terminal')

    await page.keyboard.press('Control+Alt+2')
    await selectors.gitPanel(page).waitFor()
    strictEqual(await selectors.sidebarTab(page, 'Git').getAttribute('aria-pressed'), 'true')
    await page.waitForFunction(
      () => document.activeElement?.closest('[data-screen-sidebar]') != null,
    )
    await step('panel-2-git')

    await page.keyboard.press('Control+Alt+2')
    await selectors.resizablePanel(page, 'sidebar').waitFor({ state: 'detached' })
    ok(!(await focusInSidebar(page)), 'Closing the focused panel hands focus back')
    await step('panel-2-again-hides')

    await page.keyboard.press('Control+Alt+1')
    await selectors.resizablePanel(page, 'sidebar').waitFor()
    strictEqual(await selectors.sidebarTab(page, 'Files').getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('Control+Alt+9')
    await page.waitForTimeout(300)
    strictEqual(await selectors.sidebarTab(page, 'Files').getAttribute('aria-pressed'), 'true')
    await step('panel-1-files')
  },
}
