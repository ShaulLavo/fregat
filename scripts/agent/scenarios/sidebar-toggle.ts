import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { chords, focusEditor, openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

function focusInEditor(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Editor input')
}

async function sidebarHidden(page: Page) {
  await selectors.resizablePanel(page, 'sidebar').waitFor({ state: 'detached' })
  strictEqual(
    await selectors.workspaceRail(page, 'Workbench').count(),
    0,
    'The rail hides with the sidebar',
  )
}

export const sidebarToggle: Scenario = {
  name: 'sidebar-toggle',
  description:
    'Mod+B hides and restores the whole current sidebar: the workbench keeps its selected panel and outside focus, chat toggles the session rail.',
  async run(page, { step }) {
    await openFileFromTree(page, 'package.json')
    await selectors.sidebarTab(page, 'Git').click()
    await focusEditor(page)
    await step('git-selected')

    await page.keyboard.press(chords.toggleSidebar)
    await sidebarHidden(page)
    ok(await focusInEditor(page), 'Hiding the sidebar leaves outside focus where it was')
    await step('hidden-from-editor')

    await page.keyboard.press(chords.toggleSidebar)
    await selectors.resizablePanel(page, 'sidebar').waitFor()
    strictEqual(await selectors.sidebarTab(page, 'Git').getAttribute('aria-pressed'), 'true')
    ok(await focusInEditor(page), 'Showing the sidebar leaves outside focus where it was')
    await step('restored-git')

    await selectors.sidebarTab(page, 'Files').click()
    await selectors.folderTree(page).getByRole('treeitem', { name: 'package.json' }).first().click()
    await page.keyboard.press(chords.toggleSidebar)
    await sidebarHidden(page)
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Editor input',
    )
    await step('hidden-from-tree')

    await selectors.sidebarToggle(page, 'Workbench').click()
    await selectors.resizablePanel(page, 'sidebar').waitFor()
    strictEqual(await selectors.sidebarTab(page, 'Files').getAttribute('aria-pressed'), 'true')
    await step('restored-by-titlebar')

    await selectors.sidebarTab(page, 'Files').click()
    await selectors.resizablePanel(page, 'sidebar').waitFor({ state: 'detached' })
    strictEqual(
      await selectors.workspaceRail(page, 'Workbench').count(),
      1,
      'A rail click keeps the rail',
    )
    await page.keyboard.press(chords.toggleSidebar)
    await selectors.resizablePanel(page, 'sidebar').waitFor()
    strictEqual(await selectors.sidebarTab(page, 'Files').getAttribute('aria-pressed'), 'true')
    await step('rail-click-then-mod-b')

    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.resizablePanel(page, 'sessions').waitFor()
    await page.keyboard.press(chords.toggleSidebar)
    await selectors.resizablePanel(page, 'sessions').waitFor({ state: 'detached' })
    strictEqual(await selectors.sidebarToggle(page, 'Chat').getAttribute('aria-pressed'), 'false')
    strictEqual(await page.locator('[data-chat-mode]').count(), 1, 'Mod+B stays in chat mode')
    await step('chat-rail-hidden')

    await page.keyboard.press(chords.toggleSidebar)
    await selectors.resizablePanel(page, 'sessions').waitFor()
    await step('chat-rail-restored')
  },
}
