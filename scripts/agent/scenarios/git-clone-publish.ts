import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { createFakeForge } from '../fake-forge'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, runPaletteCommand, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

let forge: Awaited<ReturnType<typeof createFakeForge>> | null = null

async function gitOutput(root: string, args: readonly string[]) {
  const child = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'ignore' })
  return (await new Response(child.stdout).text()).trim()
}

async function field(page: Page, label: string, value: string) {
  const input = selectors.dialog(page).getByLabel(label, { exact: true })
  await input.fill(value)
}

export const gitClonePublish: Scenario = {
  name: 'git-clone-publish',
  description:
    'Clone a repository through the palette into a new folder and land in it; then publish a repository that has no remote to GitHub through the Git pane, with the push reaching its remote.',
  async prepareServer() {
    forge = await createFakeForge()
    return { pathPrefix: forge.directory }
  },
  async run(page, { step }) {
    if (!forge) throw createScriptError('The fake forge was not prepared')
    const base = await mkdtemp('/work/tmp/fregat-clone-publish-')
    const source = await createGitFixture('clone-source')
    const unpublished = await createGitFixture('publish')
    const bare = path.join(base, 'published.git')
    const cloned = path.join(base, 'cloned')
    try {
      await writeFile(path.join(source, 'readme.md'), 'cloned\n')
      await fixtureGit(source, ['add', '--all'])
      await fixtureGit(source, ['commit', '--quiet', '-m', 'source'])
      await fixtureGit(unpublished, ['commit', '--quiet', '-m', 'unpublished'])
      await fixtureGit(base, ['init', '--quiet', '--bare', '-b', 'main', bare])
      // The new GitHub repository's address leads to a local bare repository.
      await fixtureGit(unpublished, [
        'config',
        `url.${bare}.insteadOf`,
        'https://github.com/acme/app.git',
      ])

      await openFixtureWorkspace(page, unpublished)
      await runPaletteCommand(page, 'Clone repository…')
      await field(page, 'Repository', source)
      await field(page, 'Folder', cloned.slice(1))
      await step('clone-dialog')
      await selectors.dialog(page).getByRole('button', { name: 'Clone', exact: true }).click()
      await selectors
        .projectSwitcher(page)
        .and(page.locator(`[title^="${cloned.slice(1)}"]`))
        .waitFor({
          timeout: 30_000,
        })
      await stat(path.join(cloned, 'readme.md')).catch(() => {
        throw createScriptError('The clone did not land on disk')
      })
      await step('cloned-and-opened')

      await openFixtureWorkspace(page, unpublished)
      await openGitPanel(page)
      await page.getByRole('button', { name: 'Publish repository', exact: true }).first().click()
      await field(page, 'Repository', 'acme/app')
      await selectors.dialog(page).getByLabel('Remote address', { exact: true }).click()
      await page.getByRole('option', { name: 'HTTPS', exact: true }).click()
      await step('publish-dialog')
      await selectors.dialog(page).getByRole('button', { name: 'Publish', exact: true }).click()
      await selectors.toast(page, 'Repository published').waitFor({ timeout: 30_000 })
      if ((await gitOutput(bare, ['branch', '--format', '%(refname:short)'])) !== 'main')
        throw createScriptError('The published branch did not reach the remote')
      await page.getByRole('button', { name: 'Fetch', exact: true }).waitFor({ timeout: 15_000 })
      await step('published')
    } finally {
      await forge.release()
      forge = null
      await releaseFixture(unpublished)
      await releaseFixture(source)
      await releaseFixture(cloned)
      await rm(base, { recursive: true, force: true })
    }
  },
}
