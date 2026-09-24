import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { expectClipboard, readClipboard } from '../clipboard'
import { runPaletteCommand, selectors } from '../selectors'

const SETTING_ID = 'workbench.density'

async function clearClipboard(page: Page) {
  await page.evaluate(() => navigator.clipboard.writeText(''))
}

/** Both async methods refuse, as in a webview without clipboard access; execCommand is left. */
async function refuseAsyncClipboard(page: Page) {
  await page.evaluate(() => {
    const refuse = () => Promise.reject(new DOMException('', 'NotAllowedError'))
    Object.assign(Clipboard.prototype, { write: refuse, writeText: refuse })
  })
}

async function copySettingId(page: Page) {
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('density')
  await selectors.settingsRowActions(page, SETTING_ID).click()
  await selectors.menuItem(page, 'Copy setting ID').click()
  await selectors.toast(page, 'Copied setting ID').first().waitFor()
}

async function copyTreePath(page: Page) {
  await selectors.treeItem(page, 'package.json').click({ button: 'right' })
  await selectors.menuItem(page, 'Copy Relative Path').click()
  await selectors.toast(page, 'Copied relative path').waitFor()
}

async function openTranscriptWithCopy(page: Page) {
  await runPaletteCommand(page, 'Chat mode')
  const sessions = selectors.sessionRows(page)
  await sessions.first().waitFor()
  const count = await sessions.count()
  for (let index = 0; index < count; index += 1) {
    await sessions.nth(index).click()
    await selectors.timelineRows(page).first().waitFor()
    const copy = selectors.copyButton(page, 'response').last()
    if ((await copy.count()) > 0) return copy
  }
  ok(false, 'An existing session needs a completed assistant response to copy')
}

export const copyFeedback: Scenario = {
  name: 'copy-feedback',
  description:
    'Copy from a settings menu, a file-tree menu and a chat response button, then again with only the execCommand fallback left.',
  async run(page, { step }) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    await clearClipboard(page)
    await copySettingId(page)
    await expectClipboard(page, SETTING_ID, 'Copy setting ID wrote the id')
    await step('settings-menu-copy')
    await page.keyboard.press('Escape')

    await clearClipboard(page)
    await copyTreePath(page)
    await expectClipboard(page, 'package.json', 'Copy Relative Path wrote the path')
    await step('file-menu-copy')

    await clearClipboard(page)
    const copy = await openTranscriptWithCopy(page)
    // The copy action is revealed by hovering its message.
    await copy.locator('xpath=ancestor::article[1]').hover()
    await copy.click()
    await selectors.copiedButton(page, 'response').last().waitFor()
    ok((await readClipboard(page)).length > 0, 'The response reached the clipboard')
    strictEqual(
      await selectors.toast(page, 'Copied response').count(),
      0,
      'Inline copy never toasts',
    )
    await step('chat-inline-copy')

    await clearClipboard(page)
    await refuseAsyncClipboard(page)
    await copySettingId(page)
    await expectClipboard(page, SETTING_ID, 'execCommand fallback wrote the text')
    await step('execcommand-fallback')
  },
}
