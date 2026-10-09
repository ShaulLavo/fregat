import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { bindSidebarPanelKeys } from '../preserve-settings'
import { chatComposerSelector, itemKeys, openFileByName, selectors } from '../selectors'
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

/** Item keys act from a pane; a tab switch leaves focus on the page until the editor takes it. */
async function pressForTab(page: Page, key: string, name: string, message: string) {
  await page.keyboard.press(key)
  await expectActiveTab(page, name, message)
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Editor input',
  )
}

/** A chat switched by key opens with its composer focused, so the next key reaches it too. */
async function pressForChat(page: Page, key: string, sessionId: string) {
  await page.keyboard.press(key)
  await page.waitForURL((url) => decodeURIComponent(url.href).includes(sessionId))
  await page.waitForFunction(
    (composer) => document.activeElement?.closest(composer) != null,
    chatComposerSelector,
  )
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
    'Default (Zed) keys: Alt+digit and Ctrl+PageUp/PageDown (Ctrl+digit and Cmd+Alt+arrows on macOS) move through editor tabs in the workbench and chats in chat mode; user-bound Mod+Alt+digit opens and closes sidebar panels.',
  async run(page, { step }) {
    const workspace = await openChatWorkspace(page)
    const keys = await itemKeys(page)
    const unbindPanels = await bindSidebarPanelKeys(page)
    try {
      await chats(page, step, keys, workspace)
      await workbench(page, step, keys)
    } finally {
      await unbindPanels()
    }
  },
}

type Step = Parameters<Scenario['run']>[1]['step']
type ItemKeys = Awaited<ReturnType<typeof itemKeys>>

async function chats(
  page: Page,
  step: Step,
  keys: ItemKeys,
  workspace: Awaited<ReturnType<typeof openChatWorkspace>>,
) {
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
    // Item keys apply in a pane; in chat mode that is the chat, not the rail's search.
    await selectors.chatMessage(page).click()

    await pressForChat(page, keys.select(1), displayed[0]!)
    await pressForChat(page, keys.select(2), displayed[1]!)
    await step('numbered-chats')

    await pressForChat(page, keys.next, displayed[0]!)
    await page.keyboard.press('ControlOrMeta+Alt+1')
    await page.waitForTimeout(300)
    strictEqual(selectedSessionId(page), displayed[0], 'Panel keys never select chats')
    await step('adjacent-chats')
  } finally {
    for (const sessionId of ids)
      await dispatch(page, workspace.base, { type: 'session.delete', sessionId })
  }
}

async function workbench(page: Page, step: Step, keys: ItemKeys) {
  await selectors.workspaceMode(page, 'Workbench').click()
  for (const name of FILES) await openFileByName(page, name)
  await expectActiveTab(page, 'README.md', 'The last opened file is active')

  await pressForTab(page, keys.select(1), 'AGENTS.md', 'Item 1 selects the first tab')
  await pressForTab(page, keys.select(3), 'README.md', 'Item 3 selects the third tab')
  await page.keyboard.press(keys.select(8))
  await page.waitForTimeout(300)
  strictEqual(await activeTab(page), 'README.md', 'An empty slot leaves the selection alone')
  await step('numbered-tabs')

  await pressForTab(page, keys.next, 'AGENTS.md', 'Next wraps from the last tab to the first')
  await pressForTab(
    page,
    keys.previous,
    'README.md',
    'Previous wraps from the first tab to the last',
  )
  await step('adjacent-tabs')

  await selectors.terminalSurface(page).first().click()
  await pressForTab(
    page,
    keys.select(2),
    'PLAN.md',
    'Item 2 reaches the tab strip from the terminal',
  )
  await step('from-terminal')

  await page.keyboard.press('ControlOrMeta+Alt+2')
  await selectors.gitPanel(page).waitFor()
  strictEqual(await selectors.sidebarTab(page, 'Git').getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => document.activeElement?.closest('[data-screen-sidebar]') != null)
  await step('panel-2-git')

  await page.keyboard.press('ControlOrMeta+Alt+2')
  await selectors.resizablePanel(page, 'sidebar').waitFor({ state: 'detached' })
  ok(!(await focusInSidebar(page)), 'Closing the focused panel hands focus back')
  await step('panel-2-again-hides')

  await page.keyboard.press('ControlOrMeta+Alt+1')
  await selectors.resizablePanel(page, 'sidebar').waitFor()
  strictEqual(await selectors.sidebarTab(page, 'Files').getAttribute('aria-pressed'), 'true')
  await page.keyboard.press('ControlOrMeta+Alt+9')
  await page.waitForTimeout(300)
  strictEqual(await selectors.sidebarTab(page, 'Files').getAttribute('aria-pressed'), 'true')
  await step('panel-1-files')
}
