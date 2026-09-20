import { strictEqual, notStrictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'

let lastInspection: unknown = null

export const draftRecovery: Scenario = {
  name: 'draft-recovery',
  description:
    'Recover two distinct drafts and an uploaded file after reload, retain the requested worktree target, and discard only those drafts.',
  inspect: async () => lastInspection,
  async run(page, { step }) {
    const issued: { url: string; id: string }[] = []
    const ticketReads: Promise<void>[] = []
    page.on('response', (response) => {
      if (
        !response.url().endsWith('/attachments/uploads') ||
        response.request().method() !== 'POST'
      )
        return
      ticketReads.push(
        response
          .json()
          .then((body) => {
            if (typeof body?.attachment?.id === 'string')
              issued.push({ url: response.url(), id: body.attachment.id })
          })
          .catch(() => undefined),
      )
    })
    await selectors.workspaceMode(page, 'Chat').click()
    const suffix = crypto.randomUUID().slice(0, 8)
    const first = `Recover draft one ${suffix}`
    const second = `Recover draft two ${suffix}`
    try {
      const previousAddress = page.url()
      const previousComposer = await selectors.chatMessage(page).elementHandle()
      await selectors.chatNewSession(page).click()
      await page.waitForURL((url) => url.href !== previousAddress)
      await previousComposer?.waitForElementState('hidden')
      await selectors.chatMessage(page).fill(first)
      await selectors.chatComposerFileInput(page).setInputFiles({
        name: 'draft-notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Recoverable draft bytes.\n'),
      })
      await selectors.chatSend(page).click({ trial: true })
      await selectors.newWorktreeChoice(page).click()
      const firstAddress = page.url()
      const firstComposer = await selectors.chatMessage(page).elementHandle()
      await step('first-draft-before-leaving')
      await selectors.chatNewSession(page).click()
      await page.waitForURL((url) => url.href !== firstAddress)
      await firstComposer?.waitForElementState('hidden')
      await selectors.chatMessage(page).fill(second)
      notStrictEqual(page.url(), firstAddress)
      await selectors.recoverableDraft(page, first).waitFor()
      await page.reload()
      strictEqual(await selectors.chatMessage(page).textContent(), second)
      await selectors.recoverableDraft(page, first).click()
      await selectors.chatStagedFile(page, 'draft-notes.txt').waitFor()
      strictEqual(await selectors.chatMessage(page).textContent(), first)
      strictEqual(await selectors.newWorktreeChoice(page).getAttribute('aria-pressed'), 'true')
      strictEqual(page.url(), firstAddress)
      await step('draft-file-and-target-recovered')
      await selectors.recoverableDraft(page, second).click()
      await page.waitForURL((url) => url.href !== firstAddress)
      strictEqual(await selectors.chatMessage(page).textContent(), second)
      await selectors.chatStagedFile(page, 'draft-notes.txt').waitFor({ state: 'hidden' })
      await selectors.discardDraft(page, first).click()
      await selectors.recoverableDraft(page, first).waitFor({ state: 'hidden' })
      await step('other-draft-survives-discard')
    } catch (error) {
      lastInspection = await page.evaluate(
        (suffix) => ({
          url: location.href,
          drafts: Object.keys(localStorage)
            .filter((key) => key.includes('chat-input-drafts'))
            .flatMap((key) => {
              const document = JSON.parse(localStorage.getItem(key) ?? '{}')
              return Object.entries(document.draftsByKey ?? {})
                .filter(([, draft]) => JSON.stringify(draft).includes(suffix))
                .map(([id, draft]) => ({ key, id, draft }))
            }),
        }),
        suffix,
      )
      await step('failure-before-cleanup')
      throw error
    } finally {
      const previousAddress = page.url()
      const previousComposer = await selectors.chatMessage(page).elementHandle()
      await selectors.chatNewSession(page).click()
      await page.waitForURL((url) => url.href !== previousAddress)
      await previousComposer?.waitForElementState('hidden')
      for (const title of [first, second]) {
        const remove = selectors.discardDraft(page, title)
        if (await remove.isVisible()) await remove.click()
      }
      await selectors.chatMessage(page).fill('')
      await Promise.all(ticketReads)
      for (const upload of issued)
        await page.request.delete(`${upload.url}/${upload.id}`, {
          headers: { Origin: new URL(page.url()).origin },
        })
    }
  },
}
