import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { control, enqueue, expectQueued, until, waitForInputs } from './chat-queue'
import {
  isolatedNativeScenario,
  restoreUserSettings,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

/** Plan 126 INTERACTION-01: a queued follow-up sends at its boundary while its session is not open. */
export const chatQueueAway = isolatedNativeScenario({
  name: 'chat-queue-away',
  description:
    'Queue a follow-up during a running turn, open a new draft so the session is off screen, let the fixture reach a tool boundary: the follow-up reaches the provider, and the session shows it when reopened.',
  fixture: new URL('../fixtures/native-queue.ts', import.meta.url),
  async drive(page, { step, root, orchestration }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    try {
      await writeSettings(page, base, [{ kind: 'reset', keys: ['chat.followUpBehavior'] }])
      await selectors.chatMessage(page).fill('QUEUE_START')
      await selectors.chatSend(page).click()
      await waitForInputs(root, 1)
      await enqueue(page, 'QUEUE_AWAY')
      await expectQueued(page, 1)
      await step('queued-while-open')

      const sessionUrl = page.url()
      await selectors.chatNewSession(page).first().click()
      await until(async () => page.url() !== sessionUrl, 'A new draft replaces the session view')
      strictEqual(await selectors.chatQueuedEntry(page, 'QUEUE_AWAY').count(), 0)
      await control(root, 'boundary')
      const inputs = await waitForInputs(root, 2)
      strictEqual(inputs[1]?.input[0]?.text, 'QUEUE_AWAY')
      await step('sent-while-away')

      await page.goto(sessionUrl)
      await selectors
        .chatMessages(page)
        .getByText('QUEUE_AWAY', { exact: true })
        .waitFor({ timeout: 30_000 })
      await expectQueued(page, 0)
      await step('reopened-shows-the-follow-up')
      await control(root, 'complete')
    } finally {
      await restoreUserSettings(page, base, before, ['chat.followUpBehavior'])
    }
  },
})
