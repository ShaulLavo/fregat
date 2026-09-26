import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

/** Selects whole lines of a reply, from the start of one text to the end of another. */
export async function selectReplyLines(page: Page, heading: string, first: string, last: string) {
  const reply = selectors.chatMessages(page).locator('article').filter({ hasText: heading })
  await reply.evaluate(
    (article, [from, to]) => {
      const texts: Text[] = []
      const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
      const start = texts.find((node) => node.data.includes(from))
      const end = texts.find((node) => node.data.includes(to))
      if (!start || !end) throw new Error('reply lines not found')
      const range = article.ownerDocument.createRange()
      range.setStart(start, start.data.indexOf(from))
      range.setEnd(end, end.data.indexOf(to) + to.length)
      const selection = article.ownerDocument.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      start.parentElement?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    },
    [first, last],
  )
}

/** Plan 126 INTERACTION-09: quote lines of an earlier reply, send them, and follow them back. */
export const chatAssistantCitation = isolatedNativeScenario({
  name: 'chat-assistant-citation',
  description:
    'Select two lines of an earlier reply and comment on them; stashing the message takes the quote along and restoring brings it back; the provider gets the quoted lines, the sent message shows a chip for them, and the chip scrolls back to that reply and marks it.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { root, step }) {
    const messages = selectors.chatMessages(page)
    await sendPrompt(page, 'Explain the cache.')
    await messages.getByText('CONTEXT_REPLY 1', { exact: true }).waitFor({ timeout: 30_000 })

    await selectReplyLines(
      page,
      'CONTEXT_REPLY 1',
      'The cache keeps one entry per key.',
      'Entries expire after ten minutes.',
    )
    await messages.getByRole('button', { name: 'Comment on the selection' }).click()
    await page.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Why ten?')
    await page.keyboard.press('Enter')
    const review = page.getByRole('group', { name: 'Review comments', exact: true })
    await review.getByText('Reply lines 3–4').waitFor({ timeout: 10_000 })
    await step('reply-lines-quoted-in-composer')

    // The quote is part of the message: stashing takes it along, restoring brings it back.
    await selectors.chatMessage(page).fill('And the expiry?')
    await selectors.chatMessage(page).click()
    await page.keyboard.press('Control+s')
    await selectors.chatStash(page, 1).waitFor()
    await review.waitFor({ state: 'detached' })
    await step('stash-took-the-quote')
    await selectors.chatStash(page, 1).click()
    await selectors.chatStashEntry(page, 'And the expiry?').click()
    await review.getByText('Reply lines 3–4').waitFor()
    await step('restore-brought-the-quote-back')

    await selectors.chatSend(page).click()
    await messages.getByText('CONTEXT_REPLY 2', { exact: true }).waitFor({ timeout: 30_000 })
    const inputs = (await nativeLog(root)).filter((entry) => entry.event === 'turn/start')
    const sent = String(inputs.at(-1)?.input ?? '')
    ok(sent.includes('About your earlier reply, lines 3–4:'), 'The provider gets the quoted lines')
    ok(sent.includes('Entries expire after ten minutes.') && sent.includes('Why ten?'))
    await step('sent-with-its-quote')

    await messages.getByRole('button', { name: 'Open Reply lines 3–4' }).click()
    await page.locator('[data-revealed]').filter({ hasText: 'CONTEXT_REPLY 1' }).waitFor({
      timeout: 10_000,
    })
    await step('chip-leads-back-to-the-reply')
  },
})
