import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'

export const screenshotDrop: Scenario = {
  name: 'screenshot-drop',
  description:
    'Drop a standard screenshot, a browser-readable raster requiring conversion, and an untyped screenshot into the composer.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.chatNewSession(page).click()
    await selectors.chatMessage(page).waitFor()
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
