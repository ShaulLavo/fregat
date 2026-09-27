import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { typePrompt, waitForCompletedTurn, waitForReply } from './chat-verification'
import { runInFixtureRepository } from './fixture-repository'
import type { FixtureProviderKind } from './native-provider-verification'

const DONE = 'COMPACT_READY'
const DRAFT = 'this draft must survive the compaction'

function manualCompactionScenario(provider: { name: string; kind: FixtureProviderKind }): Scenario {
  return {
    name: provider.name,
    requiresIsolatedServer: true,
    description: `The ${provider.kind} fixture: after one turn, Compact Conversation from the session menu runs the harness's own compaction as a turn while the unsent draft stays in the composer. Removes the fixture, session and project.`,
    run: (page, { step }) =>
      runInFixtureRepository(page, step, provider, async ({ orchestration, openSession }) => {
        const sessionId = await openSession('Compaction')
        await typePrompt(page, `Use no tools. Reply with exactly ${DONE}.`)
        await selectors.chatSend(page).click()
        await waitForReply(page, DONE)
        const first = await waitForCompletedTurn(page, orchestration, sessionId)

        await typePrompt(page, DRAFT)
        await selectors.sessionActions(page).click()
        await selectors.menuItem(page, 'Compact Conversation').click()
        await waitForCompletedTurn(page, orchestration, sessionId, first)
        await selectors
          .chatMessages(page)
          .getByText(/Context compacted/)
          .first()
          .waitFor({ timeout: 15_000 })
        strictEqual(
          (await selectors.chatMessage(page).innerText()).trim(),
          DRAFT,
          'The draft stays unsent',
        )
        await step('compacted-draft-kept')
      }),
  }
}

export const claudeManualCompaction = manualCompactionScenario({
  name: 'claude-manual-compaction',
  kind: 'claude',
})

export const codexManualCompaction = manualCompactionScenario({
  name: 'codex-manual-compaction',
  kind: 'codex',
})
