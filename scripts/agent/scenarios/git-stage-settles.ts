import { strictEqual } from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtureGit, openFixtureWorkspace } from '../fixture-workspace'
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
    let statusRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/git/status')) statusRequests += 1
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
      statusRequests = 0
      await stage.click()
      await unstage.waitFor({ state: 'attached' })
      const atSettle = statusRequests
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
      console.log(JSON.stringify({ statusRequestsAtSettle: atSettle, afterBurst: statusRequests }))
      strictEqual(await porcelain(fixture), '?? change.txt')
      strictEqual(atSettle, 0, 'Stage must settle the panel without a /git/status request')
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  },
}
