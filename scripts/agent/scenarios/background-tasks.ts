import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { typePrompt, waitForReply } from './chat-verification'
import { runInFixtureRepository } from './fixture-repository'

const DONE = 'BACKGROUND_STARTED'

export const claudeBackgroundTasks: Scenario = {
  name: 'claude-background-tasks',
  requiresIsolatedServer: true,
  description:
    'The Claude fixture starts two background sleeps as real processes; the header lists both under Background tasks, stopping one kills it and leaves the other running. Removes the fixture, session and project.',
  run: (page, { step }) =>
    runInFixtureRepository(
      page,
      step,
      { kind: 'claude', name: 'claude-background-tasks' },
      async ({ openSession }) => {
        await openSession('Background tasks')
        await typePrompt(
          page,
          `Use the Bash tool with run_in_background set to true, twice: first run \`sleep 600\`, then run \`sleep 700\`. Do not wait for them. Then reply with exactly ${DONE}.`,
        )
        await selectors.chatSend(page).click()
        await waitForReply(page, DONE)

        const trigger = page.getByRole('button', { name: 'Background tasks' }).first()
        await trigger.waitFor({ timeout: 30_000 })
        await trigger.click()
        const popover = page.getByRole('dialog').filter({ hasText: 'Background tasks' })
        await popover.getByText('sleep 700').first().waitFor({ timeout: 15_000 })
        await popover.getByText('sleep 600').first().waitFor({ timeout: 15_000 })
        await step('two-tasks')

        await popover.getByRole('button', { name: /^Stop .*sleep 600/ }).click()
        await page.waitForTimeout(1500)
        await step('after-stop')
        await popover.getByText('sleep 600').waitFor({ state: 'detached', timeout: 20_000 })
        ok(await popover.getByText('sleep 700').isVisible(), 'The other task keeps running')
        await step('one-stopped')
      },
    ),
}
