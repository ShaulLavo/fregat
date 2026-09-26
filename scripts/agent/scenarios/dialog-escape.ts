import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createSession, dispatch, openChatWorkspace } from './chat-verification'

export const dialogEscape: Scenario = {
  name: 'dialog-escape',
  description:
    'Close dialogs with one Escape after initial focus, including settings and confirmation.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    await page.keyboard.press('Control+Shift+P')
    await selectors.paletteDialog(page).waitFor()
    await page.keyboard.press('Escape')
    await selectors.paletteDialog(page).waitFor({ state: 'hidden' })
    await step('palette-closed')

    const shell = await openChatWorkspace(page)
    const sessionId = crypto.randomUUID()
    const title = `Dialog Escape ${sessionId.slice(0, 8)}`
    await createSession(page, shell, sessionId, title)
    try {
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).click()
      await selectors.sessionActions(page).click()
      await selectors.deleteSession(page).click()
      await selectors.confirmSessionDelete(page).waitFor()
      await step('delete-confirmation')
      await page.keyboard.press('Escape')
      await selectors.confirmSessionDelete(page).waitFor({ state: 'hidden' })
      await step('confirmation-closed')
    } finally {
      await dispatch(page, shell.base, { type: 'session.delete', sessionId })
    }

    const home = new URL(page.url())
    home.pathname = '/'
    home.search = ''
    home.hash = ''
    await page.addInitScript(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto(home.href)
    await selectors.chooseFolder(page).waitFor()
    await page.keyboard.press('Control+,')
    await selectors.settingsDialog(page).waitFor()
    await selectors.settingsSearch(page).waitFor()
    await step('settings-dialog')
    await page.keyboard.press('Escape')
    await selectors.settingsDialog(page).waitFor({ state: 'hidden' })
    await step('settings-closed')

    home.pathname = '/dev/physical'
    await page.addInitScript(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto(home.href)
    await selectors.physicalGallery(page).waitFor()
    await selectors.physicalButton(page, 'Preview dialog').press('Enter')
    const dialog = selectors.physicalDialog(page)
    await dialog.waitFor()
    strictEqual(
      await selectors.dialogClose(dialog).evaluate((node) => node === document.activeElement),
      true,
    )
    await step('initial-close-focus')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await step('first-escape-closed')
  },
}
