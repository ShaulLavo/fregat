import { strictEqual } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

export const fileAttachments = isolatedNativeScenario({
  name: 'file-attachments',
  description:
    'Upload and recover a general file draft, send through a native provider, preview and download exact bytes.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    const content = 'General file verification.\n'
    const prompt = 'Read the attached verification file.'
    await selectors.fillChatMessage(page, prompt)
    await selectors
      .chatComposerFileInput(page)
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(content) })
    await selectors.chatStagedFile(page, 'notes.txt').waitFor()
    await selectors.chatSend(page).click({ trial: true })
    await step('general-file-upload-ready')
    await page.reload()
    await selectors.chatStagedFile(page, 'notes.txt').waitFor()
    strictEqual(await selectors.chatMessage(page).textContent(), prompt)
    await step('general-file-draft-recovered')
    await selectors.chatSend(page).click()
    await selectors
      .chatMessages(page)
      .getByText('FILE_ATTACHMENT_VERIFIED', { exact: true })
      .waitFor({ timeout: 30_000 })
    await selectors.chatTranscriptFile(page, 'notes.txt').click()
    await selectors.chatFilePreview(page).waitFor()
    strictEqual(await selectors.chatFilePreview(page).textContent(), content)
    await step('general-file-transcript-preview')
    const downloading = page.waitForEvent('download')
    await selectors.chatFileDownload(page, 'notes.txt').click()
    const download = await downloading
    strictEqual(download.suggestedFilename(), 'notes.txt')
    strictEqual(await readFile((await download.path())!, 'utf8'), content)
    await step('general-file-download-verified')
    await page.keyboard.press('Escape')
  },
})
