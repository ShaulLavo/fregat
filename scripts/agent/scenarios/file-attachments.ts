import { ok, strictEqual } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

export const fileAttachments = isolatedNativeScenario({
  name: 'file-attachments',
  description:
    'Upload and recover a general file draft; an expired upload says so and retries; an offline upload fails without sending and retries online; dropped and pasted files stage like picked ones; send through a native provider, preview and download exact bytes.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    const content = 'General file verification.\n'
    const prompt = 'Read the attached verification file.'
    await selectors.chatMessage(page).fill(prompt)
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

    // A ready upload whose server copy has expired comes back as a failed chip that says so,
    // and Retry uploads it again from the browser's saved copy.
    const sessionUrl = page.url()
    await page.goto(new URL('/manifest.webmanifest', sessionUrl).href)
    const edited = await page.evaluate(() => {
      let count = 0
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        if (!key?.includes('chat-input-drafts')) continue
        const value = localStorage.getItem(key) ?? ''
        const next = value.replace(/"expiresAt":"[^"]+"/g, '"expiresAt":"2000-01-01T00:00:00.000Z"')
        if (next === value) continue
        localStorage.setItem(key, next)
        count += 1
      }
      return count
    })
    ok(edited > 0, 'The stored draft carries its upload expiry')
    await page.goto(sessionUrl)
    const expired = selectors.chatStagedFile(page, 'notes.txt')
    await expired.waitFor({ timeout: 30_000 })
    await page.getByText('Upload failed', { exact: true }).first().waitFor()
    await step('expired-upload-says-so')
    await page.getByRole('button', { name: 'Retry notes.txt', exact: true }).click()
    await page.getByText('Upload failed', { exact: true }).waitFor({ state: 'detached' })
    await step('expired-upload-retried')

    // Offline, a new file waits to upload and Send stays closed; back online, it finishes.
    await page.context().setOffline(true)
    await selectors.chatComposerFileInput(page).setInputFiles({
      name: 'offline.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('offline\n'),
    })
    await page.getByRole('status').getByText('Preparing attachments…').waitFor()
    ok(await selectors.chatSend(page).isDisabled(), 'Send waits for the upload')
    await step('offline-upload-waits')
    await page.context().setOffline(false)
    await selectors.chatStagedFile(page, 'offline.txt').waitFor({ timeout: 30_000 })
    await page
      .getByRole('status')
      .getByText('Preparing attachments…')
      .waitFor({ state: 'detached' })
    await step('offline-upload-finished-online')

    // Dropped and pasted files join the draft the same way a picked one does.
    await selectors.chatMessage(page).evaluate((composer) => {
      const dropped = new DataTransfer()
      dropped.items.add(new File(['dropped\n'], 'dropped.txt', { type: 'text/plain' }))
      composer.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dropped }),
      )
      const pasted = new DataTransfer()
      pasted.items.add(new File(['pasted\n'], 'pasted.txt', { type: 'text/plain' }))
      composer.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pasted }),
      )
    })
    await selectors.chatStagedFile(page, 'dropped.txt').waitFor()
    await selectors.chatStagedFile(page, 'pasted.txt').waitFor()
    await step('drop-and-paste-staged')
    for (const name of ['offline.txt', 'dropped.txt', 'pasted.txt'])
      await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click()
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
