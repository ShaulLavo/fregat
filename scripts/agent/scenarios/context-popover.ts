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

const DONE = 'CONTEXT_READY'

export const claudeContextPopover: Scenario = {
  name: 'claude-context-popover',
  description:
    "Real Claude (Haiku), one turn: the context ring's popover shows what fills the window by category, the deferred tools apart, and this session's tokens and cost. Removes the fixture, session and project.",
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const fixture = await createGitFixture('claude-context-popover')
    const sessionId = crypto.randomUUID()
    let projectId: string | null = null
    try {
      // The meter is off by default; this server's state is thrown away after the run.
      const settings = await page.request.post(
        `${orchestration.replace(/\/orchestration$/, '/settings')}/write`,
        {
          headers: { Origin: new URL(page.url()).origin },
          data: {
            mutationId: crypto.randomUUID(),
            target: 'user',
            operations: [{ kind: 'set', key: 'chat.contextWindowMeterEnabled', value: true }],
          },
        },
      )
      ok(settings.ok(), 'The context meter setting is written')
      await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
      const worktree = await registerFixtureProject(page, orchestration, fixture)
      projectId = worktree.projectId
      await openScenarioSession(page, orchestration, {
        model: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
        sessionId,
        title: `Context popover ${sessionId.slice(0, 8)}`,
        worktreeId: worktree.id,
      })
      await typePrompt(page, `Use no tools. Reply with exactly ${DONE}.`)
      await selectors.chatSend(page).click()
      await waitForReply(page, DONE)

      const ring = page.getByRole('button', { name: /^Context \d+% full$/ }).first()
      await ring.waitFor({ timeout: 30_000 })
      await ring.click()
      const popover = page.getByRole('dialog').filter({ hasText: 'Context window' })
      await popover.getByRole('meter', { name: 'Context window by category' }).waitFor()
      await popover.getByText('Messages', { exact: true }).waitFor()
      await popover.getByText(/^\d[\d.]*k? tokens ·/).waitFor({ timeout: 15_000 })
      await step('context-popover')
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
