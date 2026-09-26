import { ok, strictEqual } from 'node:assert/strict'
import * as v from 'valibot'
import { settingsSnapshotSchema } from '../../../packages/contracts/src/index'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { collectOrchestrationBases, dispatch } from './chat-verification'
import { DEFAULT_PROVIDER_INSTANCE_ID } from '../../../packages/contracts/src/index'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { connectSecondOwner, type SecondOwner } from '../second-owner'
import { registerFixtureProject, writeRawSetting } from './native-provider-verification'

export const projectGrouping: Scenario = {
  name: 'project-grouping',
  description:
    'Verify repository/separate grouping and scoped delete previews with two owners sharing a repository. Without a second connected owner, starts a throwaway server and connects it as a Remote URL machine. Never confirms deletion.',
  async run(page, { step }) {
    const bases = collectOrchestrationBases(page)
    await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
    await selectors.sessionSearch(page).waitFor()
    await page.waitForTimeout(2_000)
    let second: SecondOwner | null = null
    if (bases.size < 2) second = await connectSecondOwner(page, bases)
    const owners = [...bases]
    ok(owners.length >= 2, 'Grouping verification needs two live owners')
    const primary = owners[0]!
    const secondary = owners[1]!
    // Both owners register one checkout; project identity follows its remote, so they share it.
    const shared = await createGitFixture('project-grouping')
    await fixtureGit(shared, ['commit', '-m', 'fixture'])
    await fixtureGit(shared, [
      'remote',
      'add',
      'origin',
      `https://github.com/fregat/grouping-${crypto.randomUUID().slice(0, 8)}.git`,
    ])
    const registered = [
      await registerFixtureProject(page, primary, shared),
      await registerFixtureProject(page, secondary, shared),
    ]
    const serverBase = primary.replace(/\/orchestration$/, '')
    const settingsUrl = `${serverBase}/settings`
    const headers = { Origin: new URL(page.url()).origin }
    const response = await page.request.get(settingsUrl, { headers })
    ok(response.ok(), 'Settings must be reachable')
    const saved =
      v
        .parse(settingsSnapshotSchema, await response.json())
        .layers.find((layer) => layer.id === 'user')?.raw ?? {}
    const keys = ['chat.projectGrouping', 'chat.projectGroupingOverrides']
    const write = async (operations: readonly Record<string, unknown>[]) => {
      const result = await page.request.post(`${settingsUrl}/write`, {
        headers,
        data: { mutationId: crypto.randomUUID(), target: 'user', operations },
      })
      ok(result.ok(), 'Grouping settings write must succeed')
    }
    const sessionId = crypto.randomUUID()
    const title = `Grouping verification ${sessionId.slice(0, 8)}`
    const created: string[] = []
    try {
      for (const [index, base] of [primary, secondary].entries()) {
        await dispatch(page, base, {
          type: 'session.create',
          sessionId,
          title,
          // No turn runs, so any model will do.
          modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
          worktreeTarget: { kind: 'current', worktreeId: registered[index]!.id },
        })
        created.push(base)
      }
      for (const mode of ['repository', 'repository_path', 'separate']) {
        await write([{ kind: 'set', key: keys[0], value: mode }])
        await writeRawSetting(page, serverBase, keys[1]!, {})
        await page.reload()
        await selectors.sessionSearch(page).waitFor({ timeout: 45_000 })
        await selectors.sessionSearch(page).fill(title)
        await selectors.projectGroups(page).first().waitFor()
        await page.waitForTimeout(250)
        strictEqual(await selectors.projectGroups(page).count(), mode === 'separate' ? 2 : 1)
        await selectors.projectGroups(page).first().click({ button: 'right' })
        await selectors.projectDeleteMenu(page).click()
        await selectors.projectDeleteDialog(page).waitFor()
        strictEqual(await selectors.projectDeleteOwners(page).count(), mode === 'separate' ? 1 : 2)
        await step(`${mode}-scoped-delete-preview`)
        await selectors.projectDeleteCancel(page).click()
      }
    } finally {
      for (const base of created) await dispatch(page, base, { type: 'session.delete', sessionId })
      for (const key of keys) {
        if (!Object.hasOwn(saved, key)) await write([{ kind: 'reset', keys: [key] }])
        else if (key === keys[0]) await write([{ kind: 'set', key, value: saved[key] }])
        else await writeRawSetting(page, serverBase, key, saved[key])
      }
      for (const [index, base] of [primary, secondary].entries())
        await dispatch(page, base, {
          type: 'project.delete',
          projectId: registered[index]!.projectId,
          force: true,
        })
      await releaseFixture(shared)
      await page.reload()
      await second?.stop()
    }
  },
}
