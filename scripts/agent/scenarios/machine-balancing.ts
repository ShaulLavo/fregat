import * as v from 'valibot'
import { healthDescriptorSchema } from '../../../packages/contracts/src/index'
import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { collectOrchestrationBases, dispatch } from './chat-verification'
import { connectSecondOwner } from '../second-owner'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import {
  registerFixtureProject,
  writeSettings,
  settingsSnapshot,
  restoreUserSettings,
} from './native-provider-verification'

export const machineBalancing: Scenario = {
  name: 'machine-balancing',
  description:
    'Verify visible machine preferences, off-default balancing, one automatic draft decision and explicit branch pins with two fixture owners.',
  capture: { width: 1440, height: 1000 },
  async inspect(page) {
    return page.evaluate(() => {
      if (location.protocol === 'about:') return { address: location.href }
      const registry = globalThis as typeof globalThis & {
        __fregatQueryClients?: Map<
          string,
          {
            getQueryCache(): { getAll(): { queryKey: readonly unknown[]; state: unknown }[] }
            getMutationCache(): {
              getAll(): { options: { mutationKey?: readonly unknown[] }; state: unknown }[]
            }
          }
        >
      }
      return {
        address: location.href,
        text: document.body.innerText,
        drafts: Object.entries(localStorage).filter(([key]) =>
          key.endsWith('platform.chat-input-drafts.v1'),
        ),
        capacity: [...(registry.__fregatQueryClients ?? [])].map(([origin, client]) => ({
          origin,
          queries: client
            .getQueryCache()
            .getAll()
            .filter((query) => query.queryKey[1] === 'machine-capacity')
            .map((query) => ({ key: query.queryKey, state: query.state })),
          moves: client
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.options.mutationKey?.[1] === 'move-draft')
            .map((mutation) => mutation.state),
        })),
      }
    })
  },
  async run(page, { step }) {
    const bases = collectOrchestrationBases(page)
    await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
    await selectors.sessionSearch(page).waitFor()
    const second = await connectSecondOwner(page, bases)
    const [primary, secondary] = [...bases]
    ok(primary && secondary, 'Two fixture owners connected')
    const fixture = await createGitFixture('machine-balancing')
    const base = primary.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const keys = [
      'environments.loadBalancing',
      'environments.loadPreferences',
      'chat.projectGrouping',
    ] as const
    const registered: { base: string; projectId: string }[] = []
    try {
      await fixtureGit(fixture, ['commit', '-m', 'fixture'])
      await fixtureGit(fixture, ['branch', 'release'])
      await fixtureGit(fixture, [
        'remote',
        'add',
        'origin',
        `https://github.com/fregat/balancing-${crypto.randomUUID().slice(0, 8)}.git`,
      ])
      for (const owner of [primary, secondary]) {
        const worktree = await registerFixtureProject(page, owner, fixture)
        registered.push({ base: owner, projectId: worktree.projectId })
      }
      const health = await Promise.all(
        [primary, secondary].map(async (owner) => {
          const response = await page.request.get(
            `${owner.replace(/\/orchestration$/, '')}/health`,
            { headers: { Origin: new URL(page.url()).origin } },
          )
          ok(response.ok(), 'Fixture identity is reachable')
          return v.parse(healthDescriptorSchema, await response.json())
        }),
      )
      const firstIdentity = health[0]!.environmentId
      const secondIdentity = health[1]!.environmentId
      ok(
        firstIdentity && secondIdentity && firstIdentity !== secondIdentity,
        'Machine identities are distinct',
      )
      strictEqual(before.values['environments.loadBalancing'], false)
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('Machine selection preferences')
      await selectors.settingsRow(page, 'environments.loadPreferences').waitFor()
      await step('canonical-machine-preferences')
      const controls = selectors.machinePreferences(page)
      ok((await controls.count()) >= 2, 'Preference controls show both machines')
      await controls.first().click()
      for (const label of ['Prefer', 'Normal', 'Less often', 'Manual only'])
        await selectors.selectOption(page, label).waitFor()
      await selectors.selectOption(page, 'Normal').click()
      await page.keyboard.press('Escape')
      await writeSettings(page, base, [
        { kind: 'set', key: 'chat.projectGrouping', value: 'repository' },
        {
          kind: 'set',
          key: 'environments.loadPreferences',
          value: { [firstIdentity]: 'manual-only', [secondIdentity]: 'prefer' },
        },
        { kind: 'set', key: 'environments.loadBalancing', value: true },
      ])
      await openFixtureWorkspace(page, fixture)
      await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
      await selectors.draftMachine(page).waitFor({ timeout: 30_000 })
      await page.waitForFunction((id) => location.href.includes(id), secondIdentity, {
        timeout: 30_000,
      })
      await selectors.chatMessage(page).fill('Keep this draft on its selected machine')
      const selectedAddress = page.url()
      await selectors.draftWorkspace(page).click()
      await selectors.menuRadio(page, 'New worktree').click()
      await selectors.draftBaseBranch(page).click()
      await selectors.menuRadio(page, 'release').click()
      await step('balanced-draft-branch-pinned')
      await writeSettings(page, base, [
        {
          kind: 'set',
          key: 'environments.loadPreferences',
          value: { [firstIdentity]: 'prefer', [secondIdentity]: 'manual-only' },
        },
      ])
      await page.reload()
      await selectors.draftBaseBranch(page).waitFor()
      strictEqual((await selectors.draftBaseBranch(page).innerText()).trim(), 'From release')
      strictEqual(
        (await selectors.chatMessage(page).innerText()).trim(),
        'Keep this draft on its selected machine',
      )
      strictEqual(page.url(), selectedAddress)
      await step('draft-intent-survives-preference-refresh')
    } catch (error) {
      await step('failure-before-cleanup')
      throw error
    } finally {
      await restoreUserSettings(page, base, before, keys)
      for (const owner of registered)
        await dispatch(page, owner.base, {
          type: 'project.delete',
          projectId: owner.projectId,
          force: true,
        })
      // Unload the subscriber before stopping the owner of its open event streams.
      await page.goto('about:blank')
      await releaseFixture(fixture)
      await second.stop()
    }
  },
}
