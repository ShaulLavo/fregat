import { ok } from 'node:assert/strict'

import { selectors } from '../selectors'
import { until } from './chat-queue'
import { removeOtherSessions } from './chat-verification'
import { selectReplyLines } from './chat-assistant-citation'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

/**
 * Plan 126 INTERACTION-09: a quote of working notes that fold away with their turn, sent from
 * another session, still leads back: the chip opens the first session, unfolds the turn and
 * marks the notes.
 */
export const chatCitationElsewhere = isolatedNativeScenario({
  name: 'chat-citation-elsewhere',
  description:
    'Quote lines of working notes inside a settled turn’s fold and stash the quote; restore and send it from a new session; its chip opens the first session, unfolds the turn and marks the notes.',
  fixture: new URL('../fixtures/native-codex.ts', import.meta.url),
  async drive(page, { orchestration, sessionId, step }) {
    const messages = selectors.chatMessages(page)
    await sendPrompt(page, 'Walk me through it.')
    await messages.getByText('CONTEXT_REPLY 1', { exact: true }).waitFor({ timeout: 30_000 })
    const fold = messages.locator('button[aria-expanded]').filter({ hasText: 'Worked for' })
    await fold.click()
    const note = messages.getByText('CONTEXT_NOTE', { exact: true })
    await note.waitFor()

    await selectReplyLines(
      page,
      'CONTEXT_NOTE',
      'Reading the cache module.',
      'Checking the expiry timer.',
    )
    await messages.getByRole('button', { name: 'Comment on the selection' }).click()
    await page.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Why a timer?')
    await page.keyboard.press('Enter')
    const review = page.getByRole('group', { name: 'Review comments', exact: true })
    await review.getByText('Reply lines 3–4').waitFor({ timeout: 10_000 })
    await step('folded-note-quoted')

    await selectors.chatMessage(page).fill('Is the timer right?')
    await selectors.chatMessage(page).click()
    await page.keyboard.press('Control+s')
    await selectors.chatStash(page, 1).waitFor()
    await review.waitFor({ state: 'detached' })
    // Folded again, so following the quote has to open the fold.
    await fold.click()
    await note.waitFor({ state: 'detached' })
    const firstUrl = page.url()
    ok(firstUrl.includes(sessionId), 'The first session is the one on screen')

    await selectors.chatNewSession(page).first().click()
    await until(async () => page.url() !== firstUrl, 'A new draft replaces the first session')
    try {
      await selectors.chatStash(page, 1).click()
      await selectors.chatStashEntry(page, 'Is the timer right?').click()
      await review.getByText('Reply lines 3–4').waitFor()
      await selectors.chatSend(page).click()
      const chip = messages.getByRole('button', { name: 'Open Reply lines 3–4' })
      await chip.waitFor({ timeout: 30_000 })
      await messages.getByText('Is the timer right?', { exact: true }).waitFor()
      ok(!page.url().includes(sessionId), 'The quote was sent from another session')
      await step('sent-from-another-session')

      await chip.click()
      const marked = page.locator('[data-revealed]').filter({ hasText: 'CONTEXT_NOTE' })
      await marked.waitFor({ timeout: 15_000 })
      ok(page.url().includes(sessionId), 'The chip opened the session that owns the notes')
      await until(
        async () => (await marked.evaluate(inScrollerView)) === true,
        'The marked notes are scrolled into view',
      )
      await step('chip-opened-the-first-session-and-unfolded-the-notes')
    } finally {
      // The second session runs its own fixture process; the harness stops only the first.
      await removeOtherSessions(page, orchestration, sessionId)
    }
  },
})

function inScrollerView(element: Element) {
  let scroller = element.parentElement
  while (scroller && scroller.scrollHeight <= scroller.clientHeight)
    scroller = scroller.parentElement
  if (!scroller) return false
  const box = element.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  return box.top >= view.top - 1 && box.top < view.bottom
}
