import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

export const chatStashContext = isolatedNativeScenario({
  name: 'chat-stash-context',
  description:
    'Stash an image-only message, then swap a complete image/file draft and recover it after reload before native delivery.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    await selectors.chatComposerFileInput(page).setInputFiles({
      name: 'stash.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4gAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
    await selectors.chatSend(page).click({ trial: true })
    await selectors.chatMessage(page).click()
    await page.keyboard.press('Control+s')
    await selectors.chatStash(page, 1).waitFor()
    await selectors.chatStagedFile(page, 'stash.png').waitFor({ state: 'hidden' })
    await selectors.chatStash(page, 1).click()
    await selectors.chatStashEntry(page, 'stash.png').click()
    await selectors.chatStagedFile(page, 'stash.png').waitFor()
    await selectors.chatMessage(page).fill('Read this complete stashed message.')
    await selectors.chatComposerFileInput(page).setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('General file verification.\n'),
    })
    await selectors.chatSend(page).click({ trial: true })
    await selectors.chatMessage(page).click()
    await page.keyboard.press('Control+s')
    await selectors.chatStash(page, 1).waitFor()
    await selectors.chatStagedFile(page, 'notes.txt').waitFor({ state: 'hidden' })
    await selectors.chatMessage(page).fill('Keep this separate idea.')
    await page.reload()
    await selectors.chatStash(page, 1).click()
    await selectors.chatStashEntry(page, 'Read this complete stashed message.').click()
    await selectors.chatStagedFile(page, 'notes.txt').waitFor()
    await selectors.chatStagedFile(page, 'stash.png').waitFor()
    strictEqual(
      await selectors.chatMessage(page).textContent(),
      'Read this complete stashed message.',
    )
    await step('complete-stash-restored-after-reload')
    await selectors.chatSend(page).click()
    await selectors
      .chatMessages(page)
      .getByText('FILE_ATTACHMENT_VERIFIED', { exact: true })
      .waitFor({ timeout: 30_000 })
    await selectors.chatStash(page, 1).click()
    await selectors.chatStashEntry(page, 'Keep this separate idea.').click()
    strictEqual(await selectors.chatMessage(page).textContent(), 'Keep this separate idea.')
    await selectors.chatStagedFile(page, 'notes.txt').waitFor({ state: 'hidden' })
    await step('separate-message-preserved')
    await selectors.chatMessage(page).fill('')
  },
})
