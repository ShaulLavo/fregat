import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { dispatch, openChat, typePrompt, waitForReply } from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

const DONE = 'HOOK_ROW_DONE'
const BLOCK_MESSAGE = 'ls is blocked by the fixture hook'
const HOOK_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: `echo '${BLOCK_MESSAGE}' >&2; exit 2` }],
      },
    ],
  },
}

export const claudeHookRows: Scenario = {
  name: 'claude-hook-rows',
  description:
    'Real Claude (Haiku) in a disposable repository whose project PreToolUse hook blocks every Bash call: the turn shows the blocking hook and its message in the work log. Removes the fixture, session and project.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const fixture = await createGitFixture('claude-hook-rows')
    const sessionId = crypto.randomUUID()
    let projectId: string | null = null
    try {
      await mkdir(path.join(fixture, '.claude'), { recursive: true })
      await writeFile(path.join(fixture, '.claude', 'settings.json'), JSON.stringify(HOOK_SETTINGS))
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      const worktree = await registerFixtureProject(page, orchestration, fixture)
      projectId = worktree.projectId
      const title = `Hook rows ${sessionId.slice(0, 8)}`
      await dispatch(page, orchestration, {
        type: 'session.create',
        sessionId,
        title,
        worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        modelSelection: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
        runtimeMode: 'full-access',
      })
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).click()
      await page.waitForURL((url) => url.href.includes(sessionId))
      await typePrompt(
        page,
        `Use the Bash tool to run exactly \`ls\`, once. Do not retry. Then reply with exactly ${DONE}.`,
      )
      await selectors.chatSend(page).click()
      await waitForReply(page, DONE)

      const log = selectors.chatMessages(page)
      await log.getByText('PreToolUse:Bash blocked').first().waitFor({ timeout: 15_000 })
      await step('hook-row')
      await log.getByText('PreToolUse:Bash blocked').first().click()
      await log.getByText(BLOCK_MESSAGE).first().waitFor({ timeout: 10_000 })
      await step('hook-output')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId })
      await dispatch(page, orchestration, { type: 'session.delete', sessionId })
      if (projectId)
        await dispatch(page, orchestration, { type: 'project.delete', projectId, force: true })
      await releaseFixture(fixture)
    }
  },
}
