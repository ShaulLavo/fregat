import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createGitFixture,
  fixtureGit,
  fixtureGitOutput,
  releaseFixture,
} from '../fixture-workspace'
import { createFakeGitLab, createSshRemote } from '../fake-forge'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

let forge: Awaited<ReturnType<typeof createFakeGitLab>> | null = null
let remote: Awaited<ReturnType<typeof createSshRemote>> | null = null

/** A branch one commit ahead of its pushed upstream, whose origin is gitlab.com. */
async function gitLabCheckout() {
  const fixture = await createGitFixture('merge-request')
  remote = await createSshRemote('fregat/fixture')
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
  await fixtureGit(fixture, ['checkout', '--quiet', '-b', 'feature/merge'])
  await fixtureGit(fixture, ['remote', 'add', 'origin', 'git@gitlab.com:fregat/fixture.git'])
  await fixtureGit(fixture, ['config', 'core.sshCommand', remote.ssh])
  await fixtureGit(fixture, ['push', '--quiet', '-u', 'origin', 'main', 'feature/merge'])
  await writeFile(join(fixture, 'a.txt'), 'two\n')
  await fixtureGit(fixture, ['commit', '--quiet', '-am', 'change'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

export const gitMergeRequest = isolatedNativeScenario({
  name: 'git-merge-request',
  description:
    'A session on a branch one commit ahead, whose remote is GitLab: the header offers Push and open merge request through glab, which pushes the commit and shows the new request.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: gitLabCheckout,
  async prepareServer() {
    forge = await createFakeGitLab()
    return { pathPrefix: forge.directory }
  },
  async drive(page, { step, worktreePath }) {
    if (!forge || !remote) throw createScriptError('The fake GitLab was not prepared')
    try {
      const ship = selectors.buttonNamed(page, 'Push and open merge request')
      await ship.waitFor({ timeout: 20_000 })
      await step('offers-push-and-open')
      await ship.click()
      await selectors.changeRequestLink(page, 5).waitFor({ timeout: 20_000 })
      await selectors.toast(page, 'Pushed and opened').waitFor({ timeout: 5_000 })
      const created = (await forge.calls()).find((call) => call[0] === 'mr' && call[1] === 'create')
      if (!created?.includes('feature/merge'))
        throw createScriptError('glab did not create the request for the session branch')
      const pushed = await fixtureGitOutput(remote.bare, ['rev-parse', 'refs/heads/feature/merge'])
      if (pushed !== (await fixtureGitOutput(worktreePath, ['rev-parse', 'HEAD'])))
        throw createScriptError('The commit did not reach the remote before the request')
      await step('pushed-and-linked')
    } finally {
      await forge.release()
      forge = null
      await remote.release()
      remote = null
    }
  },
})
