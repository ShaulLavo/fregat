import { stat } from 'node:fs/promises'

import { committedFixture, fixtureGitOutput } from '../fixture-workspace'
import { selectors, settleAnimations } from '../selectors'
import { readShell } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

export const worktreeCleanupOnDelete = isolatedNativeScenario({
  name: 'worktree-cleanup-on-delete',
  description:
    'Delete the only session in its own worktree with Also remove its worktree on: once the session stops, the server removes the checkout through the worktree lifecycle and keeps its branch.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: () => committedFixture('worktree-cleanup'),
  newWorktree: true,
  async drive(page, { step, orchestration, worktreeId, worktreePath }) {
    const shell = await readShell(page, orchestration)
    const branch = shell.worktrees.find((worktree) => worktree.id === worktreeId)?.branch
    const repository = shell.worktrees.find(
      (worktree) =>
        worktree.id !== worktreeId && worktree.canonicalPath.includes('worktree-cleanup'),
    )?.canonicalPath
    if (!branch || !repository) throw createScriptError('The session worktree was not found')
    await selectors.sessionActions(page).click()
    await selectors.deleteSession(page).click()
    await selectors.removeWorktreeSwitch(page).click()
    await settleAnimations(selectors.dialog(page))
    await step('delete-with-worktree')
    await selectors.confirmSessionDelete(page).click()
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const gone = await stat(worktreePath).then(
        () => false,
        () => true,
      )
      if (gone) break
      await Bun.sleep(100)
    }
    if (
      await stat(worktreePath).then(
        () => true,
        () => false,
      )
    )
      throw createScriptError('The worktree checkout is still on disk')
    if (!(await fixtureGitOutput(repository, ['rev-parse', '--verify', `refs/heads/${branch}`])))
      throw createScriptError('The worktree branch went with the checkout')
    await step('worktree-removed')
  },
})
