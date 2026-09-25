import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit } from '../fixture-workspace'
import {
  dispatch,
  openChat,
  readShell,
  removeScenarioSessions,
  typePrompt,
  waitForReply,
} from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

type ForkProvider = {
  readonly name: string
  readonly description: string
  readonly model: { providerInstanceId: string; model: string }
}

const WORDS = ['mango', 'kiwi', 'papaya'] as const
const RECALL = 'FORK_RECALL_DONE'

/**
 * Three turns each hand the agent a fruit. Forking from the second answer
 * must give a session that knows the first two fruits and not the third, while
 * the source keeps all three turns.
 */
function sessionForkScenario(provider: ForkProvider): Scenario {
  return {
    name: provider.name,
    description: provider.description,
    async run(page, { step }) {
      const orchestration = await openChat(page)
      const fixture = await createGitFixture(provider.name)
      const sourceId = crypto.randomUUID()
      const sessions: string[] = [sourceId]
      let projectId: string | null = null
      try {
        await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
        const worktree = await registerFixtureProject(page, orchestration, fixture)
        projectId = worktree.projectId
        const title = `Fork source ${sourceId.slice(0, 8)}`
        await dispatch(page, orchestration, {
          type: 'session.create',
          sessionId: sourceId,
          title,
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
          modelSelection: provider.model,
          runtimeMode: 'full-access',
        })
        await selectors.sessionSearch(page).fill(title)
        await selectors.sessionByTitle(page, title).click()
        await page.waitForURL((url) => url.href.includes(sourceId))
        for (const [index, word] of WORDS.entries()) {
          const reply = `STORED_${index + 1}`
          await typePrompt(
            page,
            `I am testing conversation memory. Fruit number ${index + 1} on my list is ${word}. Use no tools; just reply with ${reply}.`,
          )
          await selectors.chatSend(page).click()
          await waitForReply(page, reply)
          await waitForIdle(page, orchestration, sourceId)
        }
        await step('source-three-turns')

        const second = selectors.chatMessages(page).getByText('STORED_2', { exact: true }).last()
        await second.click({ button: 'right' })
        await selectors.menuItem(page, 'Fork from Here').click()
        await page.waitForURL((url) => !url.href.includes(sourceId), { timeout: 30_000 })
        const forkId = await forkedSessionId(page, orchestration, sourceId)
        sessions.push(forkId)
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
      } catch (error) {
        await step('failed-before-cleanup')
        throw error
      } finally {
        await removeScenarioSessions(page, orchestration, { fixture, projectId, sessions })
      }
    },
  }
}

async function waitForIdle(page: Page, orchestration: string, sessionId: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const session = (await readShell(page, orchestration)).sessions.find((s) => s.id === sessionId)
    if (session?.latestTurn?.state === 'completed') return
    await Bun.sleep(250)
  }
  ok(false, 'The turn never completed')
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
    'Real Claude (Haiku): three turns each name a fruit; Fork from Here on the second answer opens a session that recalls the first two fruits and not the third, and the source keeps its three turns. Removes the fixture, sessions and project.',
  model: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
})

export const codexSessionFork = sessionForkScenario({
  name: 'codex-session-fork',
  description:
    'Real Codex: three turns each name a fruit; Fork from Here on the second answer opens a session that recalls the first two fruits and not the third, and the source keeps its three turns. Removes the fixture, sessions and project.',
  model: { providerInstanceId: 'codex', model: 'gpt-5.5' },
})
