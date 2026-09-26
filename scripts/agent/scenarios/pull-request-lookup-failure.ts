import { equal, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DEFAULT_PROVIDER_INSTANCE_ID } from '../../../packages/contracts/src/index'
import { createFakeForge } from '../fake-forge'
import { committedFixture, fixtureGit } from '../fixture-workspace'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'
import type { Scenario } from './index'
import { dispatch, openChat } from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

// The server's PATH is fixed when it starts, so the forge exists before the drive.
let prepared: Awaited<ReturnType<typeof createFakeForge>> | null = null

/** A pull-request lookup that fails offers the lookup again and never Create. */
export const pullRequestLookupFailure: Scenario = {
  name: 'pull-request-lookup-failure',
  description:
    'A fake gh answers every branch with a malformed pull request: the session header offers to check again, never to create one, and a second failed check sends no create either.',
  async prepareServer() {
    const forge = await createFakeForge()
    await writeFile(
      join(forge.directory, 'forge.json'),
      JSON.stringify({ branches: { '*': { number: 'malformed' } } }),
    )
    prepared = forge
    return { pathPrefix: forge.directory }
  },
  async run(page, { step }) {
    if (!prepared) throw createScriptError('The fake forge was not prepared')
    const forge = prepared
    const base = await openChat(page)
    const fixture = await committedFixture('pull-request-lookup-failure')
    await fixtureGit(fixture.path, [
      'remote',
      'add',
      'origin',
      'https://github.com/fregat/fixture.git',
    ])
    const sessionId = crypto.randomUUID()
    const worktreeId = crypto.randomUUID()
    const title = `PR lookup failure ${sessionId.slice(0, 8)}`
    let projectId: string | null = null
    try {
      const worktree = await registerFixtureProject(page, base, fixture.path)
      projectId = worktree.projectId
      await dispatch(page, base, {
        type: 'session.create',
        sessionId,
        title,
        // No turn runs, so any model will do.
        modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
        worktreeTarget: { kind: 'new', worktreeId, baseWorktreeId: worktree.id },
      })
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).click()
      const retry = page.locator('[data-pull-request-lookup-retry]')
      await retry.waitFor({ timeout: 45_000 })
      equal(await page.getByRole('button', { name: 'Pull request', exact: true }).count(), 0)
      equal(await page.getByRole('button', { name: /^Push and open/ }).count(), 0)
      await step('failed-lookup-offers-retry')

      const lookups = (await forge.calls()).filter((call) => call[0] === 'api').length
      await retry.click()
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await forge.calls()).filter((call) => call[0] === 'api').length > lookups) break
        await Bun.sleep(100)
      }
      await retry.waitFor()
      ok(
        !(await forge.calls()).some((call) => call[0] === 'pr' && call[1] === 'create'),
        'No failed lookup leads to a create',
      )
      await step('retry-looks-up-again-and-never-creates')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId }).catch(() => {})
      await dispatch(page, base, { type: 'worktree.release', worktreeId }).catch(() => {})
      if (projectId) await dispatch(page, base, { type: 'project.delete', projectId, force: true })
      await fixture.release()
      await forge.release()
      prepared = null
    }
  },
}
