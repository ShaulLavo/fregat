import { strictEqual } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import { selectors, settleAnimations } from '../selectors'

type Step = Parameters<Scenario['run']>[1]['step']
const PROMPT = 'Verify the stashed prompt hint'

const IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8VoRrnoH2PPOFgAET03NF/drCtAQdGhmiFsWdbxg2CMDtUMYcuyDiF80KJDNUPYssihCMY6HRwe1weCCwBbeEMuXAAAAABJRU5ErkJggg==',
  'base64',
)

async function captureHint(page: Page, control: Locator, label: string, step: Step, name: string) {
  await page.mouse.move(0, 0)
  await control.hover()
  await selectors.hint(page, label).waitFor({ timeout: 3_000 })
  strictEqual(await control.getAttribute('title'), null, `${label} must not also use native title`)
  await step(name)
}

async function driveComposer(
  page: Page,
  step: Step,
  image: { name: string; mimeType: string; buffer: Buffer },
) {
  await selectors.workspaceMode(page, 'Chat').click()
  await selectors.chatNewSession(page).click()
  const options = selectors.iconHintControl(page, 'Model options')
  await options.waitFor({ timeout: 20_000 })
  await captureHint(page, options, 'Model options:', step, 'model-options-hint')
  await options.click()
  await selectors.popupMenu(page).waitFor()
  await step('model-options-menu')
  await page.keyboard.press('Escape')

  const chooser = page.waitForEvent('filechooser')
  await selectors.iconHintControl(page, 'Attach').click()
  await selectors.chatAttachMenuItem(page, 'Attach files…').click()
  await (await chooser).setFiles(image)
  const attachment = selectors.iconHintControl(page, `Open ${image.name}`)
  await captureHint(page, attachment, `Open ${image.name}`, step, 'attachment-hint')
  await attachment.click()
  const lightbox = selectors.imageLightbox(page, image.name)
  await lightbox.waitFor()
  await settleAnimations(lightbox)
  await step('attachment-lightbox')
  await page.keyboard.press('Escape')
  await selectors.iconHintControl(page, `Remove ${image.name}`).click()
  await attachment.waitFor({ state: 'detached' })

  await selectors.chatMessage(page).fill(PROMPT)
  await page.keyboard.press('Control+s')
  const stash = selectors.iconHintControl(page, 'Stashed prompts: 1')
  await captureHint(page, stash, 'Stashed prompts: 1', step, 'stash-hint')
  await stash.click()
  const remove = selectors.iconHintControl(page, `Delete stashed prompt: ${PROMPT}`)
  await settleAnimations(page.locator('[data-slot="popover-content"]'))
  await step('stash-open')
  await captureHint(page, remove, `Delete stashed prompt: ${PROMPT}`, step, 'stash-delete-hint')
  await remove.click()
  await stash.waitFor({ state: 'detached' })
  await page.keyboard.press('Escape')
}

async function cleanupComposer(page: Page, imageName: string) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const removeImage = selectors.iconHintControl(page, `Remove ${imageName}`)
  if (await removeImage.isVisible()) await removeImage.click()
  const stash = selectors.iconHintControl(page, 'Stashed prompts: 1')
  if (await stash.isVisible()) {
    await stash.click()
    await selectors.iconHintControl(page, `Delete stashed prompt: ${PROMPT}`).click()
    await page.keyboard.press('Escape')
  }
  const message = selectors.chatMessage(page)
  if (await message.isVisible()) await message.fill('')
}

export const chatIconHints: Scenario = {
  name: 'chat-icon-hints',
  description:
    'Hover composer controls, open an attached image, and exercise the stash. Removes its draft image and prompt without sending a message.',
  async run(page, { step }) {
    const name = `icon-hints-${Date.now()}.png`
    const image = {
      name,
      mimeType: 'image/png',
      buffer: IMAGE_BYTES,
    }
    try {
      await driveComposer(page, step, image)
    } finally {
      await cleanupComposer(page, image.name)
    }
    await step('draft-cleared')
  },
}
