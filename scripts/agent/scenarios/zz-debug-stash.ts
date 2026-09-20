import type { Scenario } from './index'
import { selectors } from '../selectors'

export const zzDebugStash: Scenario = {
  name: 'zz-debug-stash',
  description: 'debug',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.chatNewSession(page).click()
    await selectors.iconHintControl(page, 'Model options').waitFor({ timeout: 20_000 })
    const stale = selectors.iconHintControl(page, 'Stashed prompts: 1')
    if (await stale.isVisible()) {
      await stale.click()
      await selectors
        .iconHintControl(page, 'Delete stashed prompt: Verify the stashed prompt hint')
        .click()
      await page.keyboard.press('Escape')
    }
    const image = {
      name: 'dbg.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8VoRrnoH2PPOFgAET03NF/drCtAQdGhmiFsWdbxg2CMDtUMYcuyDiF80KJDNUPYssihCMY6HRwe1weCCwBbeEMuXAAAAABJRU5ErkJggg==',
        'base64',
      ),
    }
    const chooser = page.waitForEvent('filechooser')
    await selectors.iconHintControl(page, 'Attach files').click()
    await (await chooser).setFiles(image)
    const attachment = selectors.iconHintControl(page, `Open ${image.name}`)
    await attachment.waitFor()
    if (process.env.DBG_LIGHTBOX) {
      await attachment.click()
      await selectors.imageLightbox(page, image.name).waitFor()
      await page.waitForTimeout(500)
      await page.keyboard.press('Escape')
    }
    await selectors.iconHintControl(page, `Remove ${image.name}`).click()
    await attachment.waitFor({ state: 'detached' })
    const message = selectors.chatMessage(page)
    await message.fill('Verify the stashed prompt hint')
    const read = () =>
      page.evaluate(() => ({
        text: document.querySelector('[role="textbox"][aria-label="Message"]')?.textContent,
        active:
          document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
        buttons: [...document.querySelectorAll('button[aria-label]')]
          .map((b) => b.getAttribute('aria-label'))
          .filter((l) => /stash/i.test(l ?? '')),
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent),
      }))
    console.log('DBG after-fill', JSON.stringify(await read()))
    if (process.env.DBG_WAIT) await page.waitForTimeout(Number(process.env.DBG_WAIT))
    await page.keyboard.press('Control+s')
    for (const wait of [50, 300, 1500]) {
      await page.waitForTimeout(wait)
      console.log('DBG after-chord', wait, JSON.stringify(await read()))
    }
    await step('after')
    const left = selectors.iconHintControl(page, 'Stashed prompts: 1')
    if (await left.isVisible()) {
      await left.click()
      await selectors
        .iconHintControl(page, 'Delete stashed prompt: Verify the stashed prompt hint')
        .click()
      await page.keyboard.press('Escape')
    }
    await message.fill('')
  },
}
