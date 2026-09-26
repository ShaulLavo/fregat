import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit } from '../fixture-workspace'
import {
  openChat,
  openScenarioSession,
  removeScenarioSessions,
  typePrompt,
  waitForReply,
} from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

const DONE = 'BACKGROUND_STARTED'

export const claudeBackgroundTasks: Scenario = {
  name: 'claude-background-tasks',
  description:
    'Real Claude (Haiku) starts two background sleeps; the header lists both under Background tasks, stopping one removes it and leaves the other running. Removes the fixture, session and project.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const fixture = await createGitFixture('claude-background-tasks')
    const sessionId = crypto.randomUUID()
    let projectId: string | null = null
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
      const worktree = await registerFixtureProject(page, orchestration, fixture)
      projectId = worktree.projectId
      const title = `Background tasks ${sessionId.slice(0, 8)}`
      await openScenarioSession(page, orchestration, {
        model: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
        sessionId: sessionId,
        title,
        worktreeId: worktree.id,
      })
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
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await removeScenarioSessions(page, orchestration, {
        fixture,
        projectId,
        sessions: [sessionId],
      })
    }
  },
}
