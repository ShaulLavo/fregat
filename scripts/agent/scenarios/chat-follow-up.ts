import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChat } from './chat-verification'
import { until } from './chat-queue'
import { createMockProviderSession } from './mock-provider-session'
import { sendPrompt } from './native-provider-verification'

// The scripted turn's closing line; one per finished turn.
const ANSWER = 'Fixed the frame match; the suite passes again.'
const FOLLOW_UP = 'CHAT_FOLLOWUP_QUEUED'
const NEXT_TURN = 'CHAT_NEXT_TURN'

export const chatFollowUp: Scenario = {
  name: 'chat-follow-up',
  description:
    'Queue a follow-up during a running mock turn, see it delivered when the turn ends, then close the runtime and resume with another message. No real provider runs.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const { cleanup, sessionId } = await createMockProviderSession(page, orchestration, {
      name: 'chat-follow-up',
      displayLabel: 'Follow-up mock',
      config: { script: 'turn-anatomy', stepDelayMs: 300 },
    })
    try {
      await selectors.chatMessage(page).waitFor()
      await sendPrompt(page, 'Start a scripted turn.')
      await selectors.chatStop(page).waitFor({ timeout: 30_000 })
      await step('turn-running')

      await selectors.chatMessage(page).fill(FOLLOW_UP)
      await selectors.chatQueue(page).click()
      await selectors.chatQueuedEntry(page, FOLLOW_UP).waitFor()
      strictEqual(
        (await selectors.chatMessage(page).innerText()).trim(),
        '',
        'The running turn rejected its follow-up',
      )
      await step('follow-up-queued')

      await answers(page, 2)
      await selectors.chatQueuedEntry(page, FOLLOW_UP).waitFor({ state: 'detached' })
      await selectors.chatMessages(page).getByText(FOLLOW_UP, { exact: true }).waitFor()
      await selectors.chatSend(page).waitFor({ timeout: 30_000 })
      await step('follow-up-answered')

      await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId })
      await step('runtime-closed-for-resume')
      await sendPrompt(page, NEXT_TURN)
      await answers(page, 3)
      await selectors.chatSend(page).waitFor({ timeout: 30_000 })
      await step('completed-turn-follow-up-answered')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      if (await selectors.chatStop(page).isVisible()) await selectors.chatStop(page).click()
      await cleanup()
    }
  },
}

/** Waits for `count` finished scripted turns in the transcript. */
async function answers(page: Page, count: number) {
  const answer = selectors.chatMessages(page).getByText(ANSWER, { exact: true })
  await answer.nth(count - 1).waitFor({ timeout: 60_000 })
  await until(async () => (await answer.count()) === count, `${count} answered turns`)
}
