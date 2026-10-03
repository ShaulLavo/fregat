import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import {
  machineIdSchema,
  providerDriverKindSchema,
  providerInstanceIdSchema,
  settingsMutationResultSchema,
} from '@workspace/contracts'
import { afterEach, expect, test, vi } from 'vitest'
import { createTestApp, closeTestApps } from '../../../test/server'
import { startProxyUsageHttpFixture } from '../../../test/factories/proxy-usage'
import { appUsageCollector, appUsageHistory } from '../../app'
import { testSettingsOptions } from '../../settings/testing'
import { PROXY_USAGE_MANAGEMENT_KEY_REF } from '../../settings/secrets'
import { nativeClaudeResponse, TRANSCRIPT_FIXTURE_NOW } from '../../testing/transcript-usage'
import { mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'

const roots: string[] = []
const registries: ProviderAdapterRegistry[] = []
const sources: Array<ReturnType<typeof startProxyUsageHttpFixture>> = []
const origin = 'http://localhost:5173'
afterEach(async () => {
  await closeTestApps()
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
  for (const source of sources.splice(0)) source.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  vi.useRealTimers()
})

test('clearing the proxy URL through settings stops collection while retaining mappings and native history', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TRANSCRIPT_FIXTURE_NOW)
  const root = await mkdtemp(path.join(tmpdir(), 'usage-source-lifecycle-'))
  roots.push(root)
  const options = testSettingsOptions(root)
  await mkdir(path.dirname(options.userFilePath!), { recursive: true })
  await writeFile(
    options.secretsFilePath!,
    JSON.stringify({ [PROXY_USAGE_MANAGEMENT_KEY_REF]: 'synthetic-management-secret' }),
    { mode: 0o600 },
  )
  const nativeHome = path.join(root, 'native-claude')
  const transcripts = path.join(nativeHome, 'projects', 'outside-fregat')
  await mkdir(transcripts, { recursive: true })
  await writeFile(
    path.join(transcripts, 'native.jsonl'),
    JSON.stringify(nativeClaudeResponse('retained-native-history')) + '\n',
  )
  const codex = v.parse(providerInstanceIdSchema, 'mapped-codex')
  const claude = v.parse(providerInstanceIdSchema, 'native-claude')
  const registry = new ProviderAdapterRegistry({
    services: { cwd: root },
    drivers: [
      {
        ...mockDriver,
        driverKind: v.parse(providerDriverKindSchema, 'codex'),
        environment: (config, id) => [
          ...mockDriver.environment(config, id),
          { name: 'CODEX_HOME', value: path.join(root, 'native-codex') },
        ],
      },
      {
        ...mockDriver,
        driverKind: v.parse(providerDriverKindSchema, 'claude'),
        environment: (config, id) => [
          ...mockDriver.environment(config, id),
          { name: 'CLAUDE_CONFIG_DIR', value: nativeHome },
        ],
      },
    ],
  })
  registries.push(registry)
  await registry.reconcile([
    {
      providerInstanceId: codex,
      driverKind: v.parse(providerDriverKindSchema, 'codex'),
      config: { credentialsPath: path.join(root, 'native-codex', 'auth.json') },
    },
    {
      providerInstanceId: claude,
      driverKind: v.parse(providerDriverKindSchema, 'claude'),
      config: { credentialsPath: path.join(nativeHome, 'credentials.json') },
    },
  ])
  let nativeProbes = 0
  Object.assign(registry.getByInstance(codex), {
    readUsage: async () => {
      nativeProbes += 1
      return { kind: 'unavailable' as const }
    },
  })
  const observedAt = new Date(TRANSCRIPT_FIXTURE_NOW - 60_000).toISOString()
  const source = startProxyUsageHttpFixture(observedAt)
  sources.push(source)
  const app = createTestApp({
    homeDirectory: root,
    workspaceRoot: root,
    systemRoot: root,
    settings: options,
    system: {
      machineId: () => v.parse(machineIdSchema, '0123456789abcdef0123456789abcdef'),
      stateHome: path.join(root, 'state'),
    },
    themes: { root: path.join(root, 'themes') },
    orchestration: { providerRuntime: false, providerAdapterRegistry: registry },
    auth: { allowedOrigins: [origin] },
    watch: false,
  })
  const configured = await app.handle(
    new Request('http://local/settings/write', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        mutationId: 'configure-proxy-source',
        target: 'user',
        operations: [
          { kind: 'set', key: 'providers.proxyUsageUrl', value: source.url },
          { kind: 'set', key: 'providers.proxyUsageProviderInstanceIds', value: [codex] },
        ],
      }),
    }),
  )
  expect(configured.status, await configured.text()).toBe(200)
  const collector = appUsageCollector(app)
  await vi.waitFor(async () => {
    const cache = JSON.parse(
      await readFile(path.join(root, 'state', 'usage', 'accounts.json'), 'utf8'),
    )
    expect(cache.proxySourceKey).toMatch(/^[a-f0-9]{64}$/)
  })
  await collector.refresh()
  expect(source.requests).toEqual([{ method: 'GET', path: '/v0/management/auth-files' }])
  const proxy = (await collector.read()).accounts.find(
    (account) => account.source === 'cli-proxy-management',
  )
  expect(proxy).toMatchObject({
    checkedAt: observedAt,
    windows: [{ usedPercent: 25, observedAt }],
    routing: { mode: 'rotating', active: true },
  })
  expect(nativeProbes).toBe(0)
  const history = appUsageHistory(app)
  await history.refresh()
  const query = { days: 7 as const, utcOffsetMinutes: 0 }
  const before = history.read(query)
  expect(before.totals.tokens).toBe(120)
  const cleared = await app.handle(
    new Request('http://local/settings/write', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        mutationId: 'clear-proxy-source',
        target: 'user',
        operations: [{ kind: 'set', key: 'providers.proxyUsageUrl', value: null }],
      }),
    }),
  )
  expect(cleared.status).toBe(200)
  const clearedResult = v.parse(settingsMutationResultSchema, await cleared.json())
  expect(clearedResult.snapshot.values['providers.proxyUsageUrl']).toBeNull()
  expect(clearedResult.snapshot.values['providers.proxyUsageProviderInstanceIds']).toEqual([codex])
  vi.setSystemTime(TRANSCRIPT_FIXTURE_NOW + 900_000)
  await collector.refresh()
  expect(source.requests).toHaveLength(1)
  expect(nativeProbes).toBe(0)
  const accounts = (await collector.read()).accounts
  expect(accounts.some((account) => account.source === 'cli-proxy-management')).toBe(false)
  expect(accounts.some((account) => account.accountKey === 'local-proxy-source')).toBe(false)
  expect(accounts.some((account) => account.providerInstanceIds.includes(codex))).toBe(false)
  const saved = JSON.parse(await readFile(options.userFilePath!, 'utf8'))
  expect(Object.hasOwn(saved, 'providers.proxyUsageUrl')).toBe(false)
  expect(saved['providers.proxyUsageProviderInstanceIds']).toEqual([codex])
  const after = history.read(query)
  expect(after.totals.tokens).toBe(before.totals.tokens)
  expect(after.coverage.scannedAt).toBe(before.coverage.scannedAt)
  expect(
    after.coverage.sources.filter((entry) => entry.sourceKind === 'native-transcript'),
  ).toEqual(before.coverage.sources.filter((entry) => entry.sourceKind === 'native-transcript'))
})
