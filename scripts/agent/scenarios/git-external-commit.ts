import { scratchPath } from '../paths'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

const commit = ['-c', 'user.name=f', '-c', 'user.email=f@f', 'commit', '-qm']

export const gitExternalCommit: Scenario = {
  name: 'git-external-commit',
  description:
    'Commit a staged file from outside the app; its Changes row leaves without a focus change.',
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-git-external-'))
    try {
      await fixtureGit(fixture, ['init', '-b', 'main'])
      await writeFile(path.join(fixture, 'base.txt'), 'base\n')
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, commit.concat(['base']))
      await writeFile(path.join(fixture, 'change.txt'), 'change\n')
      await fixtureGit(fixture, ['add', 'change.txt'])
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      const row = selectors.gitChangeRow(page, 'change.txt')
      await row.waitFor()
      await page.waitForTimeout(1_500)
      await step('staged')

      // Only `.git` changes: the worktree file stays as it is.
      const committedAt = Date.now()
      await fixtureGit(fixture, commit.concat(['external']))
      await row.waitFor({ state: 'detached', timeout: 4_000 })
      console.log(JSON.stringify({ rowGoneMs: Date.now() - committedAt }))
      await step('committed')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
