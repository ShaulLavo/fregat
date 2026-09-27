import { equal, ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { openChat } from './chat-verification'
import { createMockProviderSession } from './mock-provider-session'
import { sendPrompt } from './native-provider-verification'

export const chatToolOrder: Scenario = {
  name: 'chat-tool-order',
  description:
    'Reasoning and tools share one chronological history with reader-controlled disclosure.',
  async run(page, { step }) {
    const session = await createMockProviderSession(page, await openChat(page), {
      name: 'chat-tool-order',
      displayLabel: 'Tool order fixture',
      config: { script: 'turn-anatomy', stepDelayMs: 2_500 },
    })
    try {
      await sendPrompt(page, 'Verify chronological tool groups.')
      const live = selectors.liveActivityRow(page)
      const toggle = live.getByRole('button').first()
      await live
        .getByRole('status')
        .filter({ hasText: /^Thinking$/ })
        .waitFor()
      equal(await toggle.getAttribute('aria-expanded'), 'false')
      equal(await selectors.reasoningRows(page).count(), 0)
      await step('reasoning-collapsed-in-current-activity')
      await toggle.click()
      await selectors.reasoningDetail(page).waitFor()
      await step('reasoning-only-history')
      await selectors.workLogGroup(page).getByLabel('Failed', { exact: true }).waitFor({
        timeout: 45_000,
      })
      await toggle.click()
      equal(await selectors.chatMessages(page).getByLabel('Failed', { exact: true }).count(), 0)
      await step('one-current-activity-after-failure')
      await toggle.click()
      const history = selectors.workLogGroup(page)
      const text = await history.innerText()
      ok(text.indexOf('rg parseConfig') < text.indexOf('linear · get_issue'))
      ok(text.indexOf('linear · get_issue') < text.indexOf('bun test'))
      equal(await selectors.reasoningRows(page).count(), 1)
      await selectors.reasoningRows(page).getByRole('button', { name: 'Thought' }).click()
      await selectors.reasoningDetail(page).waitFor()
      await step('reasoning-and-tools-in-one-history')
      await selectors.liveActivityRow(page).getByRole('button').first().click()
      const summary = selectors
        .chatMessages(page)
        .getByRole('button', { name: /Ran 2 commands.*1 failed/ })
      await summary.waitFor()
      equal(await selectors.chatMessages(page).getByLabel('Failed', { exact: true }).count(), 0)
      await step('collapsed-history-after-next-activity')
      await summary.click()
      equal(await selectors.workLogGroup(page).getByLabel('Failed', { exact: true }).count(), 1)
      await step('failure-inspectable-in-history')
      await selectors.liveActivityRow(page).waitFor({ state: 'detached', timeout: 30_000 })
      await selectors
        .chatMessages(page)
        .getByText('Fixed the frame match; the suite passes again.', { exact: true })
        .waitFor()
      equal(await selectors.chatMessages(page).getByLabel('Failed', { exact: true }).count(), 0)
      await step('completed-work-folds-earlier-failures')
      await selectors.completedWorkGroup(page).click()
      await summary.waitFor()
      if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click()
      const failed = selectors.chatMessages(page).getByRole('button', { name: /tool call failed/ })
      await failed.waitFor()
      await failed.click()
      await selectors.stackFrame(page, 'apps/web/src/features/chat/utils/work-log.ts:30').waitFor()
      await step('completed-failure-output-inspectable')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await session.cleanup()
    }
  },
}
