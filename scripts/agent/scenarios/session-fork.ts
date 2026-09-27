import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { readShell, typePrompt, waitForCompletedTurn, waitForReply } from './chat-verification'
import { runInFixtureRepository } from './fixture-repository'
import type { FixtureProviderKind } from './native-provider-verification'

type ForkProvider = {
  readonly name: string
  readonly description: string
  readonly kind: FixtureProviderKind
}

const WORDS = ['mango', 'kiwi', 'papaya'] as const
const RECALL = 'FORK_RECALL_DONE'

/**
 * Three turns each hand the agent a fruit. Forking from the second answer
 * must give a session that knows the first two fruits and not the third, while
 * the source keeps all three turns. The fixture answers a recall by reciting the
 * prompts its own copy of the conversation holds.
 */
function sessionForkScenario(provider: ForkProvider): Scenario {
  return {
    name: provider.name,
    requiresIsolatedServer: true,
    description: provider.description,
    run: (page, { step }) =>
      runInFixtureRepository(
        page,
        step,
        provider,
        async ({ orchestration, openSession, sessions }) => {
          const sourceId = await openSession('Fork source')
          let previous: string | null = null
          for (const [index, word] of WORDS.entries()) {
            const reply = `STORED_${index + 1}`
            await typePrompt(
              page,
              `I am testing conversation memory. Fruit number ${index + 1} on my list is ${word}. Use no tools; just reply with ${reply}.`,
            )
            await selectors.chatSend(page).click()
            await waitForReply(page, reply)
            previous = await waitForCompletedTurn(page, orchestration, sourceId, previous)
          }
          await step('source-three-turns')

          const second = selectors.chatMessages(page).getByText('STORED_2', { exact: true }).last()
          await second.click({ button: 'right' })
          await selectors.menuItem(page, 'Fork from Here').click()
          await page.waitForURL((url) => !url.href.includes(sourceId), { timeout: 30_000 })
          sessions.push(await forkedSessionId(page, orchestration, sourceId))
          await selectors.chatMessages(page).getByText('STORED_2', { exact: true }).waitFor()
          strictEqual(
            await selectors.chatMessages(page).getByText('STORED_3', { exact: true }).count(),
            0,
            'The fork shows the conversation only through the chosen turn',
          )
          await step('fork-opened')

          await typePrompt(
            page,
            `Which fruits have I listed in this conversation so far? Name them, then end with ${RECALL}. Use no tools.`,
          )
          await selectors.chatSend(page).click()
          await waitForReply(page, RECALL)
          const text = await selectors.chatMessages(page).innerText()
          const answer = text.slice(text.lastIndexOf('Name them')).toLowerCase()
          ok(answer.includes('mango') && answer.includes('kiwi'), `fork recalled: ${answer}`)
          ok(!answer.includes('papaya'), `fork must not know turn 3: ${answer}`)
          await step('fork-recalls-two-fruits')

          const source = (await readShell(page, orchestration)).sessions.find(
            (session) => session.id === sourceId,
          )
          ok(source?.latestTurn?.state === 'completed', 'The source is untouched')
        },
      ),
  }
}

async function forkedSessionId(page: Page, orchestration: string, sourceId: string) {
  const fork = (await readShell(page, orchestration)).sessions.find(
    (session) => session.forkedFrom?.sessionId === sourceId,
  )
  ok(fork, 'A session forked from the source exists')
  return fork.id
}

export const claudeSessionFork = sessionForkScenario({
  name: 'claude-session-fork',
  description:
    'The Claude fixture: three turns each name a fruit; Fork from Here on the second answer resumes the transcript cut at that answer, so the fork recalls the first two fruits and not the third, and the source keeps its three turns. Removes the fixture, sessions and project.',
  kind: 'claude',
})

export const codexSessionFork = sessionForkScenario({
  name: 'codex-session-fork',
  description:
    'The Codex fixture: three turns each name a fruit; Fork from Here on the second answer forks the thread through that turn, so the fork recalls the first two fruits and not the third, and the source keeps its three turns. Removes the fixture, sessions and project.',
  kind: 'codex',
})
