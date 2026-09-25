import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { readShell } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

const AGENT_BRANCH = 'agent/drift'

async function prepareFixture() {
  const fixture = await createGitFixture('branch-drift')
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

export const sessionBranchDrift = isolatedNativeScenario({
  name: 'session-branch-drift',
  description:
    "A session in its own worktree whose agent runs `git checkout -b`: the worktree's branch in the header follows it when the turn ends.",
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: prepareFixture,
  newWorktree: true,
  async drive(page, { root, step, orchestration, worktreeId, worktreePath }) {
    await writeFile(
      join(root, 'checkpoint-control.json'),
      JSON.stringify({
        cwd: worktreePath,
        hold: false,
        turns: [[{ op: 'git', args: ['checkout', '--quiet', '-b', AGENT_BRANCH] }]],
      }),
    )
    const chip = selectors.worktreeChip(page, worktreeId)
    await chip.waitFor({ timeout: 20_000 })
    const before = (await chip.textContent()) ?? ''
    if (!before.includes(`worktree/${worktreeId}`))
      throw createScriptError(`The new worktree starts on its own branch, read ${before}`)
    await step('dedicated-worktree')

    await selectors.chatMessage(page).fill('Start a feature branch.')
    await selectors.chatSend(page).click()
    await selectors.chatMessages(page).getByText('CHECKPOINT_TURN_DONE').first().waitFor()
    await chip.getByText(AGENT_BRANCH, { exact: true }).waitFor({ timeout: 15_000 })
    // The Git pane reads the checkout itself; a `checkout -b` writes nothing its file watcher sees.
    await selectors.gitBranchChip(page, AGENT_BRANCH).first().waitFor({ timeout: 15_000 })
    const shell = await readShell(page, orchestration)
    if (shell.worktrees.find((item) => item.id === worktreeId)?.branch !== AGENT_BRANCH)
      throw createScriptError('The server did not record the checked-out branch')
    await step('branch-followed')
  },
})
