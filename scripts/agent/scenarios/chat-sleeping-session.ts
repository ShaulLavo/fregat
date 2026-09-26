import { equal } from 'node:assert/strict'

import type { Scenario } from './index'
import { selectors } from '../selectors'
import { openChat, readShell } from './chat-verification'
import { createMockProviderSession } from './mock-provider-session'
import { sendPrompt } from './native-provider-verification'

const REPLY = 'Wake-up scheduled'

/** Plan 144 P2: a mock turn that schedules a wake-up leaves the session sleeping until it. */
export const chatSleepingSession: Scenario = {
  name: 'chat-sleeping-session',
  description:
    'A mock provider reports a 45-minute wake-up after its turn: the header names the wake time, the rail reads Sleeping, the list shows the schedule, and Cancel schedules stops the agent and clears it. No real provider runs.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const { cleanup, sessionId } = await createMockProviderSession(page, orchestration, {
      name: 'chat-sleeping-session',
      displayLabel: 'Sleeping mock',
      config: { responseText: REPLY, wakeupMinutes: 45 },
    })
    try {
      await selectors.chatMessage(page).waitFor()
      await sendPrompt(page, 'Check back on the build later.')
      await selectors.chatMessages(page).getByText(REPLY).first().waitFor({ timeout: 30_000 })
      const trigger = selectors.sleepingSchedules(page)
      await trigger.waitFor({ timeout: 15_000 })
      // The rail reads Sleeping once the turn's end lands after the schedule report.
      await page.getByRole('status', { name: 'Sleeping' }).first().waitFor({ timeout: 15_000 })
      await step('sleeping-header')

      await trigger.click()
      const popover = page.getByRole('dialog').filter({ hasText: 'Schedules' })
      await popover.getByText('Check whether the build finished.').waitFor()
      await popover.getByText('Once').waitFor()
      // The popover's enter motion ends before the capture.
      await page.waitForTimeout(300)
      await step('schedule-list')

      await selectors.cancelSchedules(page).click()
      await trigger.waitFor({ state: 'detached', timeout: 15_000 })
      await step('cancelled')
      const session = (await readShell(page, orchestration)).sessions.find(
        (item) => item.id === sessionId,
      )
      equal(session?.sleepingUntil ?? null, null, 'The shell forgets the wake-up once cancelled')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await cleanup()
    }
  },
}
