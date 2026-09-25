import { equal } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

/**
 * The OS share picker cannot be scripted, so the page's `getDisplayMedia` hands back a
 * painted canvas stream (or the picker's dismissal); the menu, mutation and staging are real.
 */
async function stubScreenPicker(page: Page, outcome: 'frame' | 'dismissed') {
  await page.evaluate((mode) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (mode === 'dismissed') throw new DOMException('Permission denied', 'NotAllowedError')
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 200
      const context = canvas.getContext('2d')
      if (context) {
        context.fillStyle = '#3a6ea5'
        context.fillRect(0, 0, 320, 200)
      }
      return canvas.captureStream()
    }
  }, outcome)
}

async function takeScreenshot(page: Page) {
  await selectors.iconHintControl(page, 'Attach').click()
  await selectors.chatAttachMenuItem(page, 'Screenshot…').click()
}

export const chatScreenshot: Scenario = {
  name: 'chat-screenshot',
  description:
    'Take a screenshot from the composer attach menu: a frame stages one PNG, a dismissed picker stages nothing and raises no toast. Removes its draft image.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.chatNewSession(page).click()
    await selectors.iconHintControl(page, 'Attach').waitFor({ timeout: 20_000 })

    await stubScreenPicker(page, 'dismissed')
    await selectors.iconHintControl(page, 'Attach').click()
    await selectors.chatAttachMenuItem(page, 'Screenshot…').waitFor()
    await step('attach-menu')
    await selectors.chatAttachMenuItem(page, 'Screenshot…').click()
    await page.waitForTimeout(500)
    const staged = page.getByRole('button', { name: /^Open screenshot-.*\.png$/ })
    equal(await staged.count(), 0, 'A dismissed picker stages nothing')
    equal(
      await page.locator('[data-sonner-toast]').count(),
      0,
      'A dismissed picker raises no toast',
    )

    await stubScreenPicker(page, 'frame')
    await takeScreenshot(page)
    await staged.waitFor({ timeout: 10_000 })
    await step('screenshot-staged')

    const name = (await staged.getAttribute('aria-label'))?.replace(/^Open /, '') ?? ''
    await selectors.iconHintControl(page, `Remove ${name}`).click()
    await staged.waitFor({ state: 'detached' })
  },
}
