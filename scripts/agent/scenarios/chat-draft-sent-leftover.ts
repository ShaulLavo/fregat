import { selectors } from '../selectors'
import { removeOtherSessions } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'

/**
 * A message stashed from one session, restored into a fresh new-session draft and sent,
 * must leave the rail's Drafts list: nothing recoverable is left once the send lands.
 */
export const chatDraftSentLeftover = isolatedNativeScenario({
  name: 'chat-draft-sent-leftover',
  description:
    'Stash a message, restore it into a new session draft and send it; the sent text does not linger in the rail’s Drafts list.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { orchestration, sessionId, step }) {
    const messages = selectors.chatMessages(page)
    const text = 'Is the timer right?'

    await selectors.chatMessage(page).fill(text)
    await selectors.chatMessage(page).click()
    await page.keyboard.press('Control+s')
    await selectors.chatStash(page, 1).waitFor()
    await step('stashed-from-session')

    const beforeNewDraft = page.url()
    await selectors.chatNewSession(page).first().click()
    await page.waitForURL((url) => url.href !== beforeNewDraft)
    await selectors.chatStash(page, 1).click()
    await selectors.chatStashEntry(page, text).click()
    await selectors.chatSend(page).click()
    await messages.getByText(text, { exact: true }).waitFor({ timeout: 30_000 })
    await step('sent-from-new-draft')

    // The persisted document is what the rail reads on a fresh mount, so a reload
    // is the only check that catches a leftover written after the effect settles.
    await page.reload()
    await messages.getByText(text, { exact: true }).waitFor({ timeout: 30_000 })
    await selectors.recoverableDraft(page, text).waitFor({ state: 'hidden', timeout: 5_000 })
    await step('sent-draft-not-recoverable')

    // The send opened a second session; the harness stops only the one it created.
    await removeOtherSessions(page, orchestration, sessionId)
  },
})
