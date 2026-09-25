import { equal } from 'node:assert/strict'
import { selectors } from '../selectors'
import {
  isolatedNativeScenario,
  nativeLog,
  requestAppApproval,
} from './native-provider-verification'

/** Plan 161: an approval open when its turn stops ends with the turn, and says so. */
export const approvalTurnEnded = isolatedNativeScenario({
  name: 'approval-turn-ended',
  description:
    'Stop a turn while its approval is open: the panel closes, the transcript keeps an Ended unanswered receipt and the stopped line, and Carry on starts a new turn.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root }) {
    await requestAppApproval(page)
    await step('approval-open')

    await selectors.chatStop(page).click()
    await selectors.appApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
    const messages = selectors.chatMessages(page)
    await messages.getByText(/^You stopped it/).waitFor({ timeout: 30_000 })
    await selectors.turnCarryOn(page).waitFor()
    await step('stopped-with-approval-ended')

    await page.reload()
    await selectors.chatMessage(page).waitFor()
    await messages.getByText(/^You stopped it/).waitFor({ timeout: 30_000 })
    equal(
      await selectors.appApproval(page).count(),
      0,
      'The ended approval stays closed after reload',
    )
    await messages.getByText(/^You stopped it/).click()
    await messages.getByText('Ended unanswered', { exact: true }).waitFor()
    await step('ended-receipt-after-reload')

    await selectors.turnCarryOn(page).click()
    await messages.getByText('Continue from where you stopped.', { exact: true }).waitFor()
    await selectors.appApproval(page).waitFor({ timeout: 30_000 })
    const responses = (await nativeLog(root)).filter((entry) => entry.event === 'approval-response')
    equal(responses.length, 0, 'No answer reached the agent for the ended approval')
    await step('carry-on-started-a-new-turn')
  },
})
