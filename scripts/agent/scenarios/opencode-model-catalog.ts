import { ok } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as v from 'valibot'
import { providerListResultSchema } from '../../../packages/contracts/src/index'
import { openCodeProcessFixture } from '../../../apps/server/test/factories/opencode-process'
import { selectors, settleAnimations } from '../selectors'
import { enableCatalogFixture, openDisabledCatalogSettings } from '../provider-catalog-settings'
import { captureScenarioApi, cleanupAll } from '../scenario-cleanup'
import { openChat } from './chat-verification'
import {
  assertFixtureProviders,
  settingsSnapshot,
  writeRawSetting,
  writeSettings,
} from './native-provider-verification'
import type { Scenario } from './index'

type Call = { args?: string[]; cwd?: string; dataHome?: string; url?: string; pid?: number }

async function assertCatalogReleased(pid: number, root: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
    if (!command.includes(root)) return
    await Bun.sleep(100)
  }
  ok(false, 'Removing the fixture provider releases its owned catalog process')
}

const evidence = new WeakMap<object, Record<string, unknown>>()

export const opencodeModelCatalog: Scenario = {
  name: 'opencode-model-catalog',
  requiresIsolatedServer: true,
  description:
    'Enable an owned OpenCode fixture, discover its native catalog before a turn, and select its model in the composer.',
  inspect: async (page) => evidence.get(page) ?? null,
  async run(page, { step }) {
    const base = (await openChat(page)).replace(/\/orchestration$/, '')
    const api = captureScenarioApi(page)
    const before = await settingsSnapshot(api, base)
    const fixture = await openCodeProcessFixture()
    const providerInstanceId = `verify-opencode-${crypto.randomUUID()}`
    let pid: number | undefined
    const providerResponses: Record<string, unknown>[] = []
    const recorded: Record<string, unknown> = { providerResponses }
    evidence.set(page, recorded)
    try {
      await assertFixtureProviders(api, base)
      await writeSettings(api, base, [
        {
          kind: 'provider.setEnabled',
          providerInstanceId,
          enabled: false,
          createIfMissing: {
            driverKind: 'opencode',
            displayLabel: 'OpenCode catalog fixture',
            binaryPath: fixture.binaryPath,
            config: { dataHome: fixture.root },
          },
        },
      ])
      await assertFixtureProviders(api, base, fixture.binaryPath)
      const toggle = await openDisabledCatalogSettings(
        page,
        providerInstanceId,
        'OpenCode catalog fixture',
      )
      ok(
        (await readFile(fixture.marker, 'utf8').catch(() => '')) === '',
        'A disabled fixture starts no native catalog process',
      )
      await step('disabled-native-fixture-in-settings')
      let documentLoadsAfterEnable = 0
      page.on('load', () => {
        documentLoadsAfterEnable += 1
      })
      const providerRead = page.waitForResponse(
        async (response) => {
          if (response.url() !== `${base}/providers` || !response.ok()) return false
          const providers = v.parse(providerListResultSchema, await response.json()).providers
          const fixtureSnapshot = providers.find(
            (provider) => provider.providerInstanceId === providerInstanceId,
          )
          providerResponses.push({
            status: fixtureSnapshot?.status ?? 'absent',
            authentication: fixtureSnapshot?.auth.status,
            models: fixtureSnapshot?.models.map((model) => model.slug),
          })
          return providers.some(
            (provider) =>
              provider.providerInstanceId === providerInstanceId &&
              provider.status === 'ready' &&
              provider.models.some((model) => model.slug === 'fixture/text'),
          )
        },
        { timeout: 20_000 },
      )
      await enableCatalogFixture(page, base, providerInstanceId, toggle)
      const response = await providerRead
      ok(
        (await toggle.getAttribute('aria-checked')) === 'true',
        'Settings confirms the enabled fixture',
      )
      await step('native-catalog-enabled-through-settings')
      await selectors.chatToolTab(page, 'Editor').click()
      await selectors.settingsSearch(page).waitFor({ state: 'hidden' })
      const snapshot = v
        .parse(providerListResultSchema, await response.json())
        .providers.find((provider) => provider.providerInstanceId === providerInstanceId)
      ok(snapshot?.status === 'ready', 'Catalog is ready before a native turn')
      ok(
        snapshot.auth.status === 'unknown',
        'Native catalog availability leaves account authentication unknown',
      )
      ok(
        snapshot.models.some((model) => model.slug === 'fixture/text'),
        'Native model is present without a guessed slug',
      )
      const calls: Call[] = (await readFile(fixture.marker, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      ok(
        calls.filter((call) => call.args).length === 1,
        'Initialization owns one native catalog process',
      )
      const launch = calls.find((call) => call.args)!
      ok(
        launch.cwd !== fixture.root && launch.dataHome === fixture.root,
        'Execution cwd is independent of the fixture storage profile',
      )
      const listening = calls.find((call) => call.url)!
      pid = listening.pid
      const nativeRequests: { path: string; directory: string }[] = await (
        await fetch(`${listening.url}/fixture/requests`)
      ).json()
      ok(
        nativeRequests.some(
          (request) => request.path === '/provider' && request.directory === launch.cwd,
        ),
        'Catalog HTTP discovery uses the server execution cwd',
      )
      ok(
        nativeRequests.every((request) => request.path !== '/session' && request.path !== '/event'),
        'Catalog discovery creates no native session or event subscription',
      )
      Object.assign(recorded, {
        catalogStatus: snapshot.status,
        authentication: snapshot.auth.status,
        nativeModel: 'fixture/text',
        initializationServeCalls: calls.filter((call) => call.args).length,
        executionCwdMatchesHttpDirectory: nativeRequests
          .filter((request) => request.path === '/provider')
          .every((request) => request.directory === launch.cwd),
        executionCwdDiffersFromStorage: launch.cwd !== fixture.root,
        fixtureProfileMatches: launch.dataHome === fixture.root,
        nativeRequestsBeforeSelection: nativeRequests.map((request) => request.path),
      })
      await selectors.chatNewSession(page).click()
      await step('enabled-native-catalog-before-turn')
      await selectors.modelPickerTrigger(page).click()
      const panel = selectors.modelPickerPanel(page)
      await panel.waitFor()
      const model = selectors.modelPickerOption(page, 'Fixture text')
      await model.waitFor()
      await settleAnimations(panel)
      await step('native-model-in-picker')
      await model.click()
      await panel.waitFor({ state: 'hidden' })
      ok(
        (await selectors.modelPickerTrigger(page).textContent())?.includes('Fixture text'),
        'Composer shows the selected native model',
      )
      ok(
        documentLoadsAfterEnable === 0,
        'Live Settings enable and picker selection complete without a document reload',
      )
      recorded.enabledThroughSettingsUi = true
      recorded.documentLoadsAfterEnable = documentLoadsAfterEnable
      recorded.selectedNativeModel = true
      await step('native-model-selected')
      const after: { path: string }[] = await (
        await fetch(`${listening.url}/fixture/requests`)
      ).json()
      ok(
        after.every((request) => request.path !== '/session' && !request.path.includes('/prompt')),
        'Picker selection sends no native turn',
      )
    } finally {
      await cleanupAll([
        async () => {
          const marker = await readFile(fixture.marker, 'utf8').catch(() => '')
          const calls: Call[] = marker
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
          const listening = calls.find((call) => call.url)
          pid = listening?.pid ?? pid
          recorded.initializationServeCalls = calls.filter((call) => call.args).length
          if (!listening?.url) return
          const requests: { path: string }[] = await (
            await fetch(`${listening.url}/fixture/requests`)
          ).json()
          recorded.nativeRequestsBeforeCleanup = requests.map((request) => request.path)
        },
        () =>
          writeRawSetting(api, base, 'providers.instances', before.values['providers.instances']),
        async () => {
          if (pid) await assertCatalogReleased(pid, fixture.root)
          const recorded = evidence.get(page)
          if (recorded) recorded.ownedCatalogProcessReleased = true
        },
        fixture.close,
      ])
    }
  },
}
