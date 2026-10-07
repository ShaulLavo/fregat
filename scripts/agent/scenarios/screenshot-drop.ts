import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { openChat } from './chat-verification'

export const screenshotDrop: Scenario = {
  name: 'screenshot-drop',
  description:
    'Pick and recover a screenshot, then drop a standard screenshot, a raster requiring conversion, and an untyped screenshot into the composer.',
  async run(page, { step }) {
    await openChat(page)
    await selectors.chatNewSession(page).click()
    await selectors.chatMessage(page).waitFor()
    const screenshot = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 48
      canvas.height = 32
      canvas.getContext('2d')!.fillRect(0, 0, 48, 32)
      return canvas.toDataURL().split(',')[1]!
    })
    await selectors.chatComposerFileInput(page).setInputFiles({
      name: 'Picked screenshot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(screenshot, 'base64'),
    })
    const picked = selectors.iconHintControl(page, 'Open Picked screenshot.png')
    await picked.click({ trial: true })
    await step('picked-screenshot-uploaded')
    await page.reload()
    await picked.click({ trial: true })
    ok(
      await picked.locator('img').evaluate(async (image) => {
        if (!(image instanceof HTMLImageElement)) return false
        await image.decode()
        return image.naturalWidth > 0
      }),
      'The recovered screenshot decodes',
    )
    await step('picked-screenshot-recovered')
    await selectors.iconHintControl(page, 'Remove Picked screenshot.png').click()
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        IDBObjectStore.prototype.put = put
        const request = put.apply(this, args)
        this.transaction.abort()
        return request
      }
    })
    await selectors.chatComposerFileInput(page).setInputFiles({
      name: 'Storage failure.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('retry bytes'),
    })
    await page.getByText('Upload failed', { exact: true }).waitFor()
    await page
      .getByText('The attachment could not be saved for recovery. Remove it and attach it again.', {
        exact: true,
      })
      .waitFor()
    await step('storage-failure-explained')
    await selectors.iconHintControl(page, 'Remove Storage failure.txt').click()
    await selectors.chatComposerFileInput(page).setInputFiles({
      name: 'Storage failure.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('retry bytes'),
    })
    await selectors.iconHintControl(page, 'Open Storage failure.txt').click({ trial: true })
    await step('storage-failure-retried')
    await selectors.iconHintControl(page, 'Remove Storage failure.txt').click()
    for (const type of ['image/png', 'image/bmp', '']) {
      const name = type === 'image/bmp' ? 'Screenshot.bmp' : 'Screenshot.png'
      await selectors.chatMessage(page).evaluate(
        (composer, { type, name }) => {
          const canvas = document.createElement('canvas')
          canvas.width = 48
          canvas.height = 32
          const context = canvas.getContext('2d')!
          context.fillStyle = 'green'
          context.fillRect(0, 0, 48, 32)
          const png = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]!), (c) =>
            c.charCodeAt(0),
          )
          // A real 24-bit BMP exercises conversion in browsers without Apple's HEIC decoder.
          const bmp = new Uint8Array(54 + 48 * 32 * 3)
          const header = new DataView(bmp.buffer)
          bmp.set([66, 77])
          header.setUint32(2, bmp.length, true)
          header.setUint32(10, 54, true)
          header.setUint32(14, 40, true)
          header.setInt32(18, 48, true)
          header.setInt32(22, 32, true)
          header.setUint16(26, 1, true)
          header.setUint16(28, 24, true)
          bmp.fill(120, 54)
          if (type === 'image/bmp')
            Object.defineProperty(window, 'createImageBitmap', {
              value: undefined,
              configurable: true,
            })
          const transfer = new DataTransfer()
          transfer.items.add(new File([type === 'image/bmp' ? bmp : png], name, { type }))
          composer.dispatchEvent(
            new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }),
          )
          composer.dispatchEvent(
            new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
          )
        },
        { type, name },
      )
      const expected = type === 'image/bmp' ? 'Screenshot.webp' : name
      const preview = selectors.iconHintControl(page, `Open ${expected}`)
      await preview.waitFor({ timeout: 15_000 })
      await preview.click()
      const lightbox = selectors.imageLightbox(page, expected)
      await lightbox.waitFor()
      strictEqual(
        await lightbox.getByRole('img', { name: expected, exact: true }).evaluate(async (image) => {
          if (!(image instanceof HTMLImageElement)) return false
          await image.decode()
          return image.naturalWidth > 0
        }),
        true,
      )
      await step(type.replace('/', '-') || 'untyped-png')
      await page.keyboard.press('Escape')
      await selectors.iconHintControl(page, `Remove ${expected}`).click()
    }
  },
}
