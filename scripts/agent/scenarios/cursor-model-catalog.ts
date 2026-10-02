import { deepStrictEqual, ok } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import { providerListResultSchema } from '../../../packages/contracts/src/index'
import { cursorDriver } from '../../../apps/server/src/provider/drivers/cursor'
import { createAcpFixture } from '../../../apps/server/test/factories/acp'
import { captureScenarioApi, cleanupAll } from '../scenario-cleanup'
import { selectors, settleAnimations } from '../selectors'
import { enableCatalogFixture, openDisabledCatalogSettings } from '../provider-catalog-settings'
import { dispatch, openChat, readShell } from './chat-verification'
import {
  assertFixtureProviders,
  sendPrompt,
  settingsSnapshot,
  writeRawSetting,
  writeSettings,
} from './native-provider-verification'
import type { Scenario } from './index'

type Frame = {
  event?: string
  method?: string
  pid?: number
  cwd?: string
  params?: Record<string, unknown>
}

async function nativeFrames(root: string): Promise<Frame[]> {
  const log = await readFile(join(root, 'native.jsonl'), 'utf8').catch(() => '')
  return log
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function assertNativeReleased(root: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const frames = await nativeFrames(root)
    const commands = await Promise.all(
      frames
        .filter((frame) => frame.pid)
        .map((frame) => readFile(`/proc/${frame.pid}/cmdline`, 'utf8').catch(() => '')),
    )
    if (commands.every((command) => !command.includes(root))) return
    await Bun.sleep(100)
  }
  ok(false, 'Removing the fixture provider releases its owned native processes')
}

const evidence = new WeakMap<object, Record<string, unknown>>()

export const cursorModelCatalog: Scenario = {
  name: 'cursor-model-catalog',
  requiresIsolatedServer: true,
  description:
    'Enable a Cursor fixture in Settings, select native model options before a turn, and verify those choices on the native wire.',
  inspect: async (page) => evidence.get(page) ?? null,
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const base = orchestration.replace(/\/orchestration$/, '')
    const api = captureScenarioApi(page)
    const before = await settingsSnapshot(api, base)
    const initialSessions = new Set(
      (await readShell(api, orchestration)).sessions.map((session) => session.id),
    )
    const fixture = await createAcpFixture(cursorDriver)
    const providerInstanceId = `verify-cursor-${crypto.randomUUID()}`
    const recorded: Record<string, unknown> = { liveAccountSmoke: 'untested' }
    evidence.set(page, recorded)
    try {
      await assertFixtureProviders(api, base)
      await writeSettings(api, base, [
        {
          kind: 'provider.setEnabled',
          providerInstanceId,
          enabled: false,
          createIfMissing: {
            driverKind: 'cursor',
            displayLabel: 'Cursor catalog fixture',
            binaryPath: fixture.binaryPath,
            config: { configHome: join(fixture.root, 'profile') },
          },
        },
      ])
      await assertFixtureProviders(api, base, fixture.binaryPath)
      const toggle = await openDisabledCatalogSettings(
        page,
        providerInstanceId,
        'Cursor catalog fixture',
      )
      ok(
        (await nativeFrames(fixture.root)).length === 0,
        'Disabled setup launches no native process',
      )
      await step('disabled-cursor-catalog-in-settings')
      let documentLoadsAfterEnable = 0
      page.on('load', () => {
        documentLoadsAfterEnable += 1
      })
      const providerRead = page.waitForResponse(
        async (response) => {
          if (response.url() !== `${base}/providers` || !response.ok()) return false
          return v
            .parse(providerListResultSchema, await response.json())
            .providers.some(
              (provider) =>
                provider.providerInstanceId === providerInstanceId &&
                provider.status === 'ready' &&
                provider.models.some((model) => model.slug === 'fixture-cursor-small'),
            )
        },
        { timeout: 20_000 },
      )
      await enableCatalogFixture(page, base, providerInstanceId, toggle)
      const snapshot = v
        .parse(providerListResultSchema, await (await providerRead).json())
        .providers.find((provider) => provider.providerInstanceId === providerInstanceId)
      ok(snapshot?.status === 'ready', 'Native catalog is ready before a turn')
      ok(
        snapshot.auth.status === 'unknown',
        'Catalog discovery leaves account authentication unknown',
      )
      ok(
        snapshot.models.find((model) => model.slug === 'fixture-cursor-small')?.capabilities
          ?.optionDescriptors?.length === 3,
        'Native catalog advertises all three model options',
      )
      ok(
        (await nativeFrames(fixture.root)).every(
          (frame) => frame.method !== 'session/new' && frame.method !== 'session/prompt',
        ),
        'Catalog creates no native session or turn',
      )
      await step('cursor-native-catalog-enabled-in-settings')
      await selectors.chatToolTab(page, 'Editor').click()
      await selectors.settingsSearch(page).waitFor({ state: 'hidden' })
      await selectors.chatNewSession(page).click()
      await selectors.modelPickerTrigger(page).click()
      const panel = selectors.modelPickerPanel(page)
      await panel.waitFor()
      await settleAnimations(panel)
      await selectors.modelPickerOption(page, 'Fixture small').waitFor()
      await step('cursor-native-model-before-turn')
      await selectors.modelPickerOption(page, 'Fixture small').click()
      await panel.waitFor({ state: 'hidden' })
      await selectors.modelOptions(page).click()
      await selectors.modelOptionChoice(page, 'Reasoning', 'Low').click()
      await selectors.modelOptionChoice(page, 'Reasoning', 'Low').waitFor({ state: 'hidden' })
      await selectors.modelOptions(page).click()
      await selectors.modelOptionChoice(page, 'Context', 'Small').click()
      await selectors.modelOptionChoice(page, 'Context', 'Small').waitFor({ state: 'hidden' })
      await selectors.modelOptions(page).click()
      await selectors.modelOptionSwitch(page, 'Fast').click()
      ok(
        (await selectors.modelOptionSwitch(page, 'Fast').getAttribute('aria-checked')) === 'true',
        'Native boolean choice is enabled',
      )
      await step('cursor-native-model-options-before-turn')
      await page.keyboard.press('Escape')
      ok(documentLoadsAfterEnable === 0, 'Enable and native picker choices use no document reload')
      ok(
        (await nativeFrames(fixture.root)).every(
          (frame) => frame.method !== 'session/new' && frame.method !== 'session/prompt',
        ),
        'Picker choices send no native session or turn',
      )
      await sendPrompt(page, 'hello')
      await selectors.chatContainingText(page, 'fixture:hello:').waitFor({ timeout: 30_000 })
      const frames = await nativeFrames(fixture.root)
      const selected = frames.filter(
        (frame) =>
          frame.method === 'session/set_model' || frame.method === 'session/set_config_option',
      )
      const expected = [
        { method: 'session/set_model', key: 'modelId', value: 'fixture-cursor-small' },
        { method: 'session/set_config_option', key: 'configId', value: 'reasoning', choice: 'low' },
        { method: 'session/set_config_option', key: 'configId', value: 'context', choice: 'small' },
        { method: 'session/set_config_option', key: 'configId', value: 'fast', choice: true },
      ]
      for (const selection of expected)
        ok(
          selected.some(
            (frame) =>
              frame.method === selection.method &&
              frame.params?.[selection.key] === selection.value &&
              (selection.choice === undefined || frame.params?.value === selection.choice),
          ),
          'Advertised model and option choices reach the native executable',
        )
      deepStrictEqual(
        selected.slice(0, 4).map((frame) => frame.method),
        expected.map((selection) => selection.method),
      )
      ok(documentLoadsAfterEnable === 0, 'Native completion stays in the enabled document')
      Object.assign(recorded, {
        enabledThroughSettingsUi: true,
        documentLoadsAfterEnable,
        authentication: snapshot.auth.status,
        selectedNativeModel: 'fixture-cursor-small',
        selectedNativeOptions: { reasoning: 'low', context: 'small', fast: true },
        nativeSessionBeforeSelection: false,
        nativeRpcMethods: frames.filter((frame) => frame.method).map((frame) => frame.method),
      })
      await step('cursor-native-selected-model-completed')
    } finally {
      await cleanupAll([
        async () => {
          const shell = await readShell(api, orchestration)
          for (const session of shell.sessions.filter(
            (session) => !initialSessions.has(session.id),
          )) {
            await dispatch(api, orchestration, {
              type: 'session.runtime.stop',
              sessionId: session.id,
            })
            await dispatch(api, orchestration, { type: 'session.delete', sessionId: session.id })
          }
        },
        () =>
          writeRawSetting(api, base, 'providers.instances', before.values['providers.instances']),
        async () => {
          await assertNativeReleased(fixture.root)
          recorded.ownedNativeProcessesReleased = true
        },
        fixture.dispose,
      ])
    }
  },
}
