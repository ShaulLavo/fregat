import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit } from '../fixture-workspace'
import { openChat, removeScenarioSessions } from './chat-verification'
import { createMockProviderSession } from './mock-provider-session'
import { registerFixtureProject } from './native-provider-verification'

const REVIEW = JSON.stringify({
  findings: [
    {
      title: 'Lost value',
      body: 'The second line drops the first value.',
      confidence_score: 0.8,
      priority: 1,
      code_location: { absolute_file_path: 'a.txt', line_range: { start: 1, end: 2 } },
    },
  ],
  overall_correctness: 'patch is incorrect',
  overall_explanation: 'One value is lost.',
  overall_confidence_score: 0.7,
})

/** A mock reviewer's findings on uncommitted changes land in the review draft, marked as the agent's. */
export const chatAgentReview: Scenario = {
  name: 'chat-agent-review',
  description:
    'Asks a mock reviewer to review uncommitted changes in a fixture checkout; its finding lands in the composer review draft on a.txt lines 1–2, marked Agent. No real provider runs.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const fixture = await createGitFixture('chat-agent-review')
    let projectId: string | null = null
    let cleanupSession: (() => Promise<void>) | null = null
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await writeFile(path.join(fixture, 'a.txt'), 'one\ntwo\n')
      const worktree = await registerFixtureProject(page, orchestration, fixture)
      projectId = worktree.projectId
      const session = await createMockProviderSession(page, orchestration, {
        name: 'chat-agent-review',
        displayLabel: 'Review mock',
        config: { responseText: REVIEW },
        worktreeId: worktree.id,
      })
      cleanupSession = session.cleanup
      await selectors.chatMessage(page).waitFor()

      await selectors.reviewChanges(page).click()
      await page.getByRole('combobox', { name: 'Changes to review' }).click()
      await page.getByRole('option', { name: 'Uncommitted changes' }).click()
      await page.getByRole('combobox', { name: 'Reviewer' }).click()
      await page.getByRole('option', { name: 'Review mock · GPT-5.5' }).click()
      await page.waitForTimeout(300)
      await step('review-form')

      await page.getByRole('button', { name: 'Start review' }).click()
      const draft = selectors.reviewComments(page)
      await draft.getByText('Lost value: The second line drops the first value.').waitFor({
        timeout: 30_000,
      })
      await draft.getByText('Agent').waitFor()
      await draft.getByText('a.txt:1–2').waitFor()
      await step('finding-in-draft')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await cleanupSession?.()
      await removeScenarioSessions(page, orchestration, { fixture, projectId, sessions: [] })
    }
  },
}
