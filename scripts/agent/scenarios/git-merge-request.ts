import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { createFakeGitLab } from '../fake-forge'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

let forge: Awaited<ReturnType<typeof createFakeGitLab>> | null = null

/** A pushed-looking branch whose origin is gitlab.com, so the forge is GitLab. */
async function gitLabCheckout() {
  const fixture = await createGitFixture('merge-request')
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
  await fixtureGit(fixture, ['checkout', '--quiet', '-b', 'feature/merge'])
  await writeFile(join(fixture, 'a.txt'), 'two\n')
  await fixtureGit(fixture, ['commit', '--quiet', '-am', 'change'])
  await fixtureGit(fixture, ['remote', 'add', 'origin', 'git@gitlab.com:fregat/fixture.git'])
  // Its upstream exists locally, so the header offers the request rather than Publish.
  await fixtureGit(fixture, ['update-ref', 'refs/remotes/origin/feature/merge', 'HEAD'])
  await fixtureGit(fixture, ['config', 'branch.feature/merge.remote', 'origin'])
  await fixtureGit(fixture, ['config', 'branch.feature/merge.merge', 'refs/heads/feature/merge'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

export const gitMergeRequest = isolatedNativeScenario({
  name: 'git-merge-request',
  description:
    'A session on a branch whose remote is GitLab: the header offers a Merge request through glab, and creating one shows its link.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: gitLabCheckout,
  async prepareServer() {
    forge = await createFakeGitLab()
    return { pathPrefix: forge.directory }
  },
  async drive(page, { step }) {
    if (!forge) throw createScriptError('The fake GitLab was not prepared')
    try {
      const create = page.getByRole('button', { name: 'Merge request', exact: true })
      await create.waitFor({ timeout: 20_000 })
      await step('offers-merge-request')
      await create.click()
      await selectors.changeRequestLink(page, 5).waitFor({ timeout: 20_000 })
      const created = (await forge.calls()).find((call) => call[0] === 'mr' && call[1] === 'create')
      if (!created?.includes('feature/merge'))
        throw createScriptError('glab did not create the request for the session branch')
      await step('merge-request-linked')
    } finally {
      await forge.release()
      forge = null
    }
  },
})
