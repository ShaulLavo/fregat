import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const gitSubmodulesInit: Scenario = {
  name: 'git-submodules-init',
  description:
    'Open a repository whose declared submodule has no checkout, see the Git panel say so, and initialize it.',
  async run(page, { step }) {
    const fixture = await createGitFixture('submodules')
    const library = await createGitFixture('submodules-library')
    try {
      await writeFile(path.join(library, 'library.txt'), 'library\n')
      await fixtureGit(library, ['add', '--all'])
      await fixtureGit(library, ['commit', '--quiet', '-m', 'library'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await fixtureGit(fixture, [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        '--quiet',
        library,
        'vendor/library',
      ])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'add library'])
      // What `git worktree add` leaves: the submodule declared, its directory empty.
      await fixtureGit(fixture, ['submodule', 'deinit', '--quiet', '--force', 'vendor/library'])

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.submodulesNotice(page).waitFor({ timeout: 15_000 })
      const title = (await selectors.submodulesNotice(page).textContent()) ?? ''
      if (!title.includes('1 submodule is not initialized'))
        throw createScriptError(`The notice did not count the empty submodule: ${title}`)
      await step('notice')

      await selectors.initializeSubmodules(page).click()
      await selectors.submodulesNotice(page).waitFor({ state: 'hidden', timeout: 30_000 })
      await stat(path.join(fixture, 'vendor', 'library', 'library.txt')).catch(() => {
        throw createScriptError('Initialize did not check the submodule out on disk')
      })
      await step('initialized')
    } finally {
      await releaseFixture(fixture)
      await releaseFixture(library)
    }
  },
}
