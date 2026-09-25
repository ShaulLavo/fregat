import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit } from '../fixture-workspace'
import {
  openChat,
  openScenarioSession,
  readShell,
  removeScenarioSessions,
  typePrompt,
  waitForReply,
} from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

const DONE = 'COMPACT_READY'
const DRAFT = 'this draft must survive the compaction'

function manualCompactionScenario(provider: {
  name: string
  model: { providerInstanceId: string; model: string }
}): Scenario {
  return {
    name: provider.name,
    description: `Real ${provider.model.providerInstanceId}: after one turn, Compact Conversation from the session menu runs the harness's own compaction as a turn while the unsent draft stays in the composer. Removes the fixture, session and project.`,
    async run(page, { step }) {
      const orchestration = await openChat(page)
      const fixture = await createGitFixture(provider.name)
      const sessionId = crypto.randomUUID()
      let projectId: string | null = null
      try {
        await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
        const worktree = await registerFixtureProject(page, orchestration, fixture)
        projectId = worktree.projectId
        await openScenarioSession(page, orchestration, {
          model: provider.model,
          sessionId,
          title: `Compaction ${sessionId.slice(0, 8)}`,
          worktreeId: worktree.id,
        })
        await typePrompt(page, `Use no tools. Reply with exactly ${DONE}.`)
        await selectors.chatSend(page).click()
        await waitForReply(page, DONE)
        const first = await waitForTurn(page, orchestration, sessionId, null)

        await typePrompt(page, DRAFT)
        await selectors.sessionActions(page).click()
        await selectors.menuItem(page, 'Compact Conversation').click()
        await waitForTurn(page, orchestration, sessionId, first)
        await selectors
          .chatMessages(page)
          .getByText(/Context compacted/)
          .first()
          .waitFor({
            timeout: 15_000,
          })
        strictEqual(
          (await selectors.chatMessage(page).innerText()).trim(),
          DRAFT,
          'The draft stays unsent',
        )
        await step('compacted-draft-kept')
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
}

/** Waits for a completed latest turn other than `previous`, and returns its id. */
async function waitForTurn(
  page: Parameters<Scenario['run']>[0],
  orchestration: string,
  sessionId: string,
  previous: string | null,
) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const turn = (await readShell(page, orchestration)).sessions.find(
      (s) => s.id === sessionId,
    )?.latestTurn
    if (turn && turn.turnId !== previous && turn.state === 'completed') return turn.turnId
    await page.waitForTimeout(500)
  }
  return ok(false, 'The turn never completed') as never
}
export const claudeManualCompaction = manualCompactionScenario({
  name: 'claude-manual-compaction',
  model: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
})

export const codexManualCompaction = manualCompactionScenario({
  name: 'codex-manual-compaction',
  model: { providerInstanceId: 'codex', model: 'gpt-5.5' },
})
