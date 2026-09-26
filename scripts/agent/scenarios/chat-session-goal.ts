import type { Scenario } from './index'
import { selectors } from '../selectors'
import { openChat } from './chat-verification'
import { createMockProviderSession } from './mock-provider-session'
import { sendPrompt } from './native-provider-verification'

const OBJECTIVE = 'Make the suite green'

/** Plan 144 P3: a goal set with `/goal` shows in the header, pauses and clears. */
export const chatSessionGoal: Scenario = {
  name: 'chat-session-goal',
  description:
    'A mock provider takes `/goal Make the suite green`: the header shows the goal working, the popover names the objective and token budget, Pause pauses it and Clear goal removes it. No real provider runs.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const { cleanup } = await createMockProviderSession(page, orchestration, {
      name: 'chat-session-goal',
      displayLabel: 'Goal mock',
      config: { responseText: 'Working toward the goal' },
    })
    try {
      await selectors.chatMessage(page).waitFor()
      await sendPrompt(page, `/goal ${OBJECTIVE}`)
      const trigger = selectors.sessionGoal(page)
      await trigger.filter({ hasText: 'Working on it' }).waitFor({ timeout: 30_000 })
      await step('goal-working')

      await trigger.click()
      const popover = page.getByRole('dialog').filter({ hasText: OBJECTIVE })
      await popover.getByText('12.4k / 50k').waitFor()
      await page.waitForTimeout(300)
      await step('goal-details')

      await popover.getByRole('button', { name: 'Pause', exact: true }).click()
      await trigger.filter({ hasText: 'Paused' }).waitFor({ timeout: 15_000 })
      await step('goal-paused')

      // The popover stays open on the new status.
      await popover.getByRole('button', { name: 'Clear goal', exact: true }).click()
      await trigger.waitFor({ state: 'detached', timeout: 15_000 })
      await step('goal-cleared')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await cleanup()
    }
  },
}
