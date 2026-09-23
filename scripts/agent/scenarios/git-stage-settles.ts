import { strictEqual } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

async function porcelain(project: string) {
  const process = Bun.spawn(['git', '-C', project, 'status', '--porcelain'], { stdout: 'pipe' })
  return (await new Response(process.stdout).text()).trim()
}

export const gitStageSettles: Scenario = {
  name: 'git-stage-settles',
  description: 'Stage and unstage in a fixture repo; the panel settles from the write response.',
  async run(page, { step }) {
    // Never the dev workspace: clicking Stage there would stage real work.
    const fixture = await mkdtemp('/work/tmp/fregat-git-stage-')
    // Every write first reads `fresh=true` status to admit itself; only a read after the write is a refetch.
    let admissions = 0
    let refetches = 0
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!url.pathname.endsWith('/git/status')) return
      if (url.searchParams.get('fresh') === 'true') admissions += 1
      else refetches += 1
    })
    try {
      await fixtureGit(fixture, ['init', '-b', 'main'])
      await writeFile(path.join(fixture, 'base.txt'), 'base\n')
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, [
        '-c',
        'user.name=f',
        '-c',
        'user.email=f@f',
        'commit',
        '-m',
        'base',
      ])
      await writeFile(path.join(fixture, 'change.txt'), 'change\n')
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      const row = selectors.gitChangeRow(page, 'change.txt')
      const stage = selectors.gitRowAction(page, 'Stage file')
      const unstage = selectors.gitRowAction(page, 'Unstage file')
      await row.waitFor()
      await page.waitForTimeout(2_500)
      await step('unstaged')

      // Row actions only take the pointer while their row is hovered.
      await row.hover()
      admissions = 0
      refetches = 0
      await stage.click()
      await unstage.waitFor({ state: 'attached' })
      const atSettle = { admissions, refetches }
      await step('staged')
      strictEqual(await porcelain(fixture), 'A  change.txt')

      await row.hover()
      await unstage.click()
      await stage.waitFor({ state: 'attached' })
      await row.hover()
      await stage.click()
      await unstage.waitFor({ state: 'attached' })
      await row.hover()
      await unstage.click()
      await stage.waitFor({ state: 'attached' })
      await step('unstaged-again')
      console.log(JSON.stringify({ atSettle, afterBurst: { admissions, refetches } }))
      strictEqual(await porcelain(fixture), '?? change.txt')
      strictEqual(atSettle.refetches, 0, 'Stage must settle the panel without refetching status')
      strictEqual(atSettle.admissions, 1, 'Stage admits itself with exactly one fresh status read')
      strictEqual(refetches, 0, 'Stage and unstage bursts must not refetch status')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
