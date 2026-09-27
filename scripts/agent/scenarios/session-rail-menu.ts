import { ok, strictEqual } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'

import { selectors, settleAnimations } from '../selectors'
import { dispatch, openChatWorkspace, readShell } from './chat-verification'
import { installMockProvider } from './mock-provider-session'
import type { Scenario } from './index'

async function assertFocused(locator: Locator) {
  strictEqual(await locator.evaluate((node) => node === document.activeElement), true)
}

async function dismiss(page: Page) {
  await page.keyboard.press('Escape')
  await selectors.menuSurface(page, 'chat.session').waitFor({ state: 'hidden' })
  await assertFocused(selectors.sessionRail(page))
}

export const sessionRailMenu: Scenario = {
  name: 'session-rail-menu',
  description:
    'Disposable metadata sessions exercise pointer targeting, both menu keys, list focus return, rename, project menus, scroll and row-removal dismissal, and desktop touch suppression. No provider turn.',
  async run(page, { step }) {
    const shell = await openChatWorkspace(page)
    const prefix = `Rail menu ${crypto.randomUUID().slice(0, 8)}`
    const mock = await installMockProvider(page, shell.base.replace(/\/orchestration$/, ''), {
      name: 'rail-menu',
      displayLabel: 'Rail menu fixture',
      config: {},
    })
    const ids = [crypto.randomUUID(), crypto.randomUUID()]
    for (const [index, sessionId] of ids.entries())
      await dispatch(page, shell.base, {
        type: 'session.create',
        sessionId,
        title: `${prefix} ${index + 1}`,
        modelSelection: { providerInstanceId: mock.providerInstanceId, model: 'gpt-5.5' },
        worktreeTarget: { kind: 'current', worktreeId: shell.worktree.id },
      })
    const first = selectors.sessionByTitle(page, `${prefix} 1`)
    const second = selectors.sessionByTitle(page, `${prefix} 2`)
    const rail = selectors.sessionRail(page)
    const menu = selectors.menuSurface(page, 'chat.session')
    try {
      await selectors.sessionSearch(page).fill(prefix)
      await first.click()
      await second.click({ button: 'right', position: { x: 24, y: 18 } })
      await menu.waitFor()
      strictEqual(await menu.count(), 1)
      await step('right-click-second-session')
      await selectors.menuItem(page, 'Pin').click()
      await selectors.sessionInShelf(page, `${prefix} 2`, 'Pinned').waitFor()
      const snapshot = await readShell(page, shell.base)
      ok(snapshot.sessions.find((session) => session.id === ids[1])?.pinnedAt)
      ok(!snapshot.sessions.find((session) => session.id === ids[0])?.pinnedAt)

      await first.click()
      await rail.press('Shift+F10')
      await menu.waitFor()
      const rowBox = await first.boundingBox()
      const menuBox = await menu.boundingBox()
      ok(rowBox && menuBox)
      ok(menuBox.x >= rowBox.x && menuBox.x < rowBox.x + rowBox.width)
      await step('shift-f10-cursor-row')
      await dismiss(page)
      await rail.press('ContextMenu')
      await menu.waitFor()
      await selectors.menuItem(page, 'Rename').click()
      const input = selectors.sessionTitleInput(page)
      await input.waitFor()
      await assertFocused(input)
      await input.fill(`${prefix} renamed`)
      await input.press('Enter')
      const renamed = selectors.sessionByTitle(page, `${prefix} renamed`)
      await renamed.waitFor()
      await step('context-menu-key-renamed')
      await renamed.click({ button: 'right' })
      await selectors.menuItem(page, 'Rename').click()
      await input.fill('Cancelled rename')
      await input.press('Escape')
      await renamed.waitFor()

      await renamed.click({ button: 'right' })
      await menu.waitFor()
      await page.mouse.move(12, 300)
      await page.mouse.wheel(0, 120)
      await menu.waitFor({ state: 'hidden' })
      await assertFocused(rail)
      await step('wheel-dismissed')
      await renamed.click({ button: 'right' })
      await menu.waitFor()
      await settleAnimations(menu)
      // Base UI gives externally opened context menus a 500ms long-press dismissal grace.
      await page.waitForTimeout(550)
      await page.mouse.click(600, 100)
      await menu.waitFor({ state: 'hidden' })
      await step('outside-click-dismissed')

      await renamed.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 })
      await renamed.dispatchEvent('contextmenu', { clientX: 24, clientY: 200 })
      strictEqual(await menu.count(), 0)
      await renamed.dispatchEvent('pointerup', { pointerType: 'touch', button: 0 })
      await step('desktop-touch-suppressed')

      await renamed.click({ button: 'right' })
      await menu.waitFor()
      await dispatch(page, shell.base, { type: 'session.delete', sessionId: ids[0] })
      await renamed.waitFor({ state: 'hidden' })
      await menu.waitFor({ state: 'hidden' })
      await assertFocused(rail)
      await step('removed-target-dismissed')

      await rail.press('Home')
      await rail.press('Shift+F10')
      const projectMenu = selectors.menuSurface(page, 'chat.project')
      await projectMenu.waitFor()
      await selectors.menuItem(page, 'Collapse Project').waitFor()
      await step('project-header-keyboard-menu')
      await page.keyboard.press('Escape')
      await projectMenu.waitFor({ state: 'hidden' })
      await assertFocused(rail)
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      const remaining = (await readShell(page, shell.base)).sessions
      for (const sessionId of ids)
        if (remaining.some((session) => session.id === sessionId))
          await dispatch(page, shell.base, { type: 'session.delete', sessionId })
      await mock.restore()
    }
  },
}
