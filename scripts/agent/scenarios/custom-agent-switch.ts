import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { orchestrationDispatchResultSchema } from '../../../packages/contracts/src/index'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import {
  createGitFixture,
  fixtureApiBase,
  fixtureGit,
  openFixtureWorkspace,
} from '../fixture-workspace'
import { removeScenarioSessions } from './chat-verification'
import { settingsSnapshot, writeSettings } from './native-provider-verification'

export const customAgentProviderSwitch: Scenario = {
  name: 'custom-agent-provider-switch',
  description:
    'Choose a project agent from a mock provider, switch provider instances, and verify the draft clears its agent without starting a paid turn.',
  async run(page, { step }) {
    const fixture = await createGitFixture('custom-agent-switch')
    const base = fixtureApiBase(page)
    const before = await settingsSnapshot(page, base)
    const first = `agent-first-${crypto.randomUUID()}`
    const second = `agent-second-${crypto.randomUUID()}`
    let projectId: string | null = null
    try {
      await writeFile(path.join(fixture, 'README.md'), 'Agent provider selection fixture\n')
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await writeSettings(
        page,
        base,
        [first, second].map((providerInstanceId, index) => ({
          kind: 'provider.setEnabled',
          providerInstanceId,
          enabled: true,
          createIfMissing: {
            driverKind: 'mock',
            displayLabel: `Agent fixture ${index + 1}`,
            config: {},
          },
        })),
      )
      const response = await page.request.post(`${base}/orchestration/commands`, {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          type: 'project.create',
          commandId: crypto.randomUUID(),
          title: 'Agent switch fixture',
          workspaceRoot: fixture,
          defaultModelSelection: { providerInstanceId: first, model: 'gpt-5.5' },
        },
      })
      ok(response.ok(), 'Register isolated project')
      projectId =
        v.parse(orchestrationDispatchResultSchema, await response.json()).result?.projectId ?? null
      await openFixtureWorkspace(page, fixture)
      await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
      await selectors.draftWorkspace(page).waitFor({ timeout: 20_000 })
      const landed = page.url()
      await selectors.chatNewSession(page).click()
      await page.waitForURL((url) => url.href !== landed)
      await selectors.draftAgent(page).click()
      await selectors.draftAgentChoice(page, 'reviewer').click()
      await selectors.draftAgent(page).filter({ hasText: 'reviewer' }).waitFor()
      await step('agent-selected-on-first-provider')
      await selectors.modelPickerTrigger(page).click()
      await selectors.modelPickerProvider(page, 'Agent fixture 2').click()
      await selectors.modelPickerOption(page, 'GPT-5.5').click()
      await selectors.draftAgent(page).filter({ hasText: 'Default agent' }).waitFor()
      await step('agent-cleared-on-provider-switch')
      await page.reload()
      await selectors.draftAgent(page).filter({ hasText: 'Default agent' }).waitFor()
      await step('cleared-agent-survives-reload')
    } finally {
      await removeScenarioSessions(page, `${base}/orchestration`, {
        fixture,
        projectId,
        sessions: [],
      })
      const raw = before.layers.find((layer) => layer.id === 'user')?.raw['providers.instances']
      await writeSettings(page, base, [
        raw === undefined
          ? { kind: 'reset', keys: ['providers.instances'] }
          : { kind: 'set', key: 'providers.instances', value: raw },
      ])
    }
  },
}
