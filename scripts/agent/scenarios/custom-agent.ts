import { ok } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { orchestrationDispatchResultSchema } from '../../../packages/contracts/src/index'
import * as v from 'valibot'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import {
  createGitFixture,
  fixtureApiBase,
  fixtureGit,
  openFixtureWorkspace,
} from '../fixture-workspace'
import { readShell, removeScenarioSessions, typePrompt } from './chat-verification'

const MARKER = 'REVIEWER_ON'
const AGENT = `---
name: reviewer
description: Answers as the fixture reviewer
---
Start every reply with the line ${MARKER}, then answer in one short sentence. Use no tools.
`

export const claudeCustomAgent: Scenario = {
  name: 'claude-custom-agent',
  description:
    "Real Claude (Haiku) in a fixture repository with a project agent `reviewer`: the new-session strip lists it, a session started as it follows the agent's prompt, and the header names the agent. Removes the fixture, session and project.",
  async run(page, { step }) {
    const fixture = await createGitFixture('claude-custom-agent')
    let projectId: string | null = null
    const sessions: string[] = []
    let orchestration: string | null = null
    try {
      await mkdir(path.join(fixture, '.claude', 'agents'), { recursive: true })
      await writeFile(path.join(fixture, '.claude', 'agents', 'reviewer.md'), AGENT)
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      const response = await page.request.post(`${fixtureApiBase(page)}/orchestration/commands`, {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          type: 'project.create',
          commandId: `custom-agent-${crypto.randomUUID()}`,
          defaultModelSelection: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
          title: 'Custom agent fixture',
          workspaceRoot: fixture,
        },
      })
      ok(response.ok(), 'Register the fixture')
      projectId =
        v.parse(orchestrationDispatchResultSchema, await response.json()).result?.projectId ?? null
      orchestration = `${fixtureApiBase(page)}/orchestration`
      await openFixtureWorkspace(page, fixture)
      await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
      await selectors.draftWorkspace(page).waitFor({ timeout: 20_000 })
      const landed = page.url()
      await selectors.chatNewSession(page).click()
      await page.waitForURL((url) => url.href !== landed, { timeout: 20_000 })

      await page.getByRole('button', { name: 'Run the session as an agent' }).click()
      const reviewer = page.getByRole('menuitemradio').filter({ hasText: 'reviewer' })
      await reviewer.waitFor({ timeout: 30_000 })
      await step('agent-listed')
      await reviewer.click()
      await typePrompt(page, 'Say hello.')
      await selectors.chatSend(page).click()
      await selectors.chatMessages(page).getByText(MARKER).first().waitFor({ timeout: 120_000 })
      await page.getByTitle('Runs as the reviewer agent').first().waitFor()
      await step('session-runs-as-agent')

      const created = (await readShell(page, orchestration)).sessions.find(
        (session) => session.agent === 'reviewer',
      )
      ok(created, 'The session records its agent')
      sessions.push(created.id)
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await removeScenarioSessions(page, orchestration ?? `${fixtureApiBase(page)}/orchestration`, {
        fixture,
        projectId,
        sessions,
      })
    }
  },
}
