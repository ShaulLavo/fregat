import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createSession, dispatch, openChatWorkspace } from './chat-verification'

export const dialogEscape: Scenario = {
  name: 'dialog-escape',
  description:
    'One Escape closes a dialog (general smoke: palette, delete confirmation, settings) and, ' +
    "specifically, a dialog whose close button gets the opening focus — the close button's " +
    'tooltip must not swallow that first Escape.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    // General smoke: these dialogs close on one Escape, but none of them lands
    // opening focus on a close button (the regression check is further down).
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

    // Regression check: the physical gallery's preview dialog has no other
    // focusable content, so Base UI's opening focus lands on the close button
    // and its tooltip is the one that can eat the first Escape.
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
    await step('regression-initial-close-focus')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await step('regression-first-escape-closed')
  },
}
