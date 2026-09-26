import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import {
  fixtureApiBase,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import {
  settingsSnapshot,
  restoreUserSettings,
  writeSettings,
} from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

async function revParse(root: string, ref: string) {
  const child = Bun.spawn(['git', '-C', root, 'rev-parse', ref], { stdout: 'pipe' })
  return (await new Response(child.stdout).text()).trim()
}

async function commit(root: string, text: string) {
  await writeFile(path.join(root, 'tracked.txt'), text)
  await fixtureGit(root, ['add', 'tracked.txt'])
  await fixtureGit(root, ['commit', '--quiet', '-m', text.trim()])
}

export const gitAutoPull: Scenario = {
  name: 'git-auto-pull',
  description:
    'With Keep the default branch current on, a dirty checkout says why it is not pulled, and once clean it fast-forwards to its upstream.',
  async run(page, { step }) {
    const base = await mkdtemp('/work/tmp/fregat-auto-pull-')
    const remote = path.join(base, 'remote.git')
    const upstream = path.join(base, 'upstream')
    const checkout = path.join(base, 'checkout')
    const key = 'git.autoPull'
    let before: Awaited<ReturnType<typeof settingsSnapshot>> | null = null
    try {
      await fixtureGit(base, ['init', '--quiet', '--bare', '-b', 'main', remote])
      await fixtureGit(base, ['clone', '--quiet', remote, upstream])
      for (const root of [upstream]) {
        await fixtureGit(root, ['config', 'user.email', 'fregat@example.com'])
        await fixtureGit(root, ['config', 'user.name', 'Fregat'])
      }
      await commit(upstream, 'one\n')
      await fixtureGit(upstream, ['push', '--quiet', 'origin', 'main'])
      await fixtureGit(base, ['clone', '--quiet', remote, checkout])

      await openFixtureWorkspace(page, checkout)
      const api = fixtureApiBase(page)
      before = await settingsSnapshot(page, api)
      await writeSettings(page, api, [{ kind: 'set', key, value: true }])
      await openGitPanel(page)

      await writeFile(path.join(checkout, 'scratch.txt'), 'local work\n')
      await commit(upstream, 'two\n')
      await fixtureGit(upstream, ['push', '--quiet', 'origin', 'main'])
      await fixtureGit(checkout, ['fetch', '--quiet', 'origin'])
      const paused = selectors.autoPullStatus(page, 'Auto-pull paused: uncommitted changes')
      await paused.waitFor({ timeout: 20_000 })
      if ((await revParse(checkout, 'HEAD')) === (await revParse(checkout, 'origin/main')))
        throw createScriptError('A dirty checkout was pulled')
      await step('paused-by-changes')

      await rm(path.join(checkout, 'scratch.txt'))
      const target = await revParse(checkout, 'origin/main')
      await paused.waitFor({ state: 'hidden', timeout: 20_000 })
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if ((await revParse(checkout, 'HEAD')) === target) break
        await Bun.sleep(200)
      }
      if ((await revParse(checkout, 'HEAD')) !== target)
        throw createScriptError('The clean checkout did not fast-forward to its upstream')
      await selectors.gitPanel(page).getByText('Working tree clean').waitFor({ timeout: 10_000 })
      // The header's behind count must follow the pull without a manual refresh.
      await page.waitForFunction(() => !document.body.textContent?.includes('↓'), undefined, {
        timeout: 15_000,
      })
      await step('fast-forwarded')
    } finally {
      if (before) await restoreUserSettings(page, fixtureApiBase(page), before, [key])
      await releaseFixture(checkout)
      await rm(base, { recursive: true, force: true })
    }
  },
}
