import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  const restored = await app.handle(
    new Request('http://local/settings/write', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        mutationId: 'restore-proxy-source',
        target: 'user',
        operations: [{ kind: 'set', key: 'providers.proxyUsageUrl', value: source.url }],
      }),
    }),
  )
  expect(restored.status).toBe(200)
  await vi.waitFor(async () => {
    const returned = (await collector.read()).accounts.find(
      (account) => account.source === 'cli-proxy-management',
    )
    expect(returned).toMatchObject({
      checkedAt: observedAt,
      windows: [{ usedPercent: 25, observedAt }],
    })
  })
  expect(nativeProbes).toBe(0)
})

test.each([
  { key: 'synthetic-management-secret', address: true, configured: true, importKey: false },
  { key: 'synthetic-management-secret', address: true, configured: true, importKey: true },
  {
    key: 'synthetic-management-secret',
    address: true,
    configured: false,
    importKey: true,
    invalidSettings: true,
  },
  { key: null, address: true, configured: false },
  { key: '', address: true, configured: false },
  { key: 'synthetic-management-secret', address: false, configured: false },
])('unmapped proxy activation uses address and stored key: %j', async (scenario) => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-unmapped-source-'))
  roots.push(root)
  const options = testSettingsOptions(root)
  await mkdir(path.dirname(options.userFilePath!), { recursive: true })
  const observedAt = new Date(Date.now() - 60_000).toISOString()
  const source = startProxyUsageHttpFixture(observedAt, [
    {
      id: 'private-auth-work.json',
      provider: 'codex',
      email: 'pool.work@example.test',
      id_token: { plan_type: 'plus' },
      quota: { observed_at: observedAt, signals: { 'x-codex-primary-used-percent': '6' } },
    },
    {
      id: 'private-auth-personal.json',
      provider: 'codex',
      email: 'pool.personal@example.test',
      id_token: { plan_type: 'pro' },
    },
    { id: 'private-auth-claude.json', provider: 'claude' },
  ])
  sources.push(source)
  if (scenario.key !== null && !scenario.importKey)
    await writeFile(
      options.secretsFilePath!,
      JSON.stringify({ [PROXY_USAGE_MANAGEMENT_KEY_REF]: scenario.key }),
    )
  await writeFile(
    options.userFilePath!,
    JSON.stringify({
      ...(scenario.invalidSettings ? { 'editor.fontSize': 'invalid' } : {}),
      'providers.instances': [],
      'providers.proxyUsageUrl': scenario.address ? source.url : null,
    }),
  )
  if (scenario.importKey) {
    const previousSettings = await readFile(options.userFilePath!, 'utf8')
    const checkout = path.resolve(import.meta.dirname, '../../../../..')
    const keyFile = path.join(root, 'import-key')
    await writeFile(keyFile, `${scenario.key}\n`, { mode: 0o600 })
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(checkout, 'scripts/import-proxy-usage-key.ts'),
        keyFile,
        '--url',
        scenario.invalidSettings ? 'http://127.0.0.1:18318' : source.url,
      ],
      {
        cwd: checkout,
        env: { ...process.env, PLATFORM_HOME: path.dirname(options.userFilePath!) },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exit, stderr).toBe(scenario.invalidSettings ? 1 : 0)
    expect(stdout).toBe('')
    expect(stderr).not.toContain(scenario.key)
    if (!scenario.invalidSettings) expect(stderr).toBe('')
    if (scenario.invalidSettings)
      expect(await readFile(options.userFilePath!, 'utf8')).toBe(previousSettings)
  }
  const registry = new ProviderAdapterRegistry({ services: { cwd: root }, drivers: [] })
  registries.push(registry)
  const app = createTestApp({
    homeDirectory: root,
    workspaceRoot: root,
    systemRoot: root,
    settings: options,
    system: { stateHome: path.join(root, 'state') },
    themes: { root: path.join(root, 'themes') },
    orchestration: { providerRuntime: false, providerAdapterRegistry: registry },
    auth: { allowedOrigins: [origin] },
    watch: false,
  })
  const collector = appUsageCollector(app)
  await collector.refresh()
  for (let read = 0; read < 2; read += 1) {
    const response = await app.handle(new Request('http://local/providers/usage/feed'))
    expect(response.status).toBe(200)
    const feed = await response.json()
    expect(feed.accounts).toHaveLength(scenario.configured ? 2 : 0)
    if (!scenario.configured) continue
    expect(feed.accounts).toMatchObject([
      {
        id: expect.stringMatching(/^proxy:[a-f0-9]{64}$/),
        label: 'pool.work',
        plan: 'Plus',
        checkedAt: observedAt,
        windows: [{ usedPercent: 6, lastSeenAt: observedAt }],
        routing: { lastServedAt: null },
      },
      {
        id: expect.stringMatching(/^proxy:[a-f0-9]{64}$/),
        label: 'pool.personal',
        plan: 'Pro',
        state: 'no-data',
        routing: { lastServedAt: null },
      },
    ])
    expect(new Set(feed.accounts.map((account: { id: string }) => account.id)).size).toBe(2)
    expect(JSON.stringify(feed)).not.toMatch(/@|private-auth|synthetic-management-secret/)
    expect(
      (await collector.read()).accounts.every(
        (account) => account.providerInstanceIds.length === 0,
      ),
    ).toBe(true)
  }
  expect(source.requests).toEqual(
    scenario.configured ? [{ method: 'GET', path: '/v0/management/auth-files' }] : [],
  )
  if (!scenario.configured) return
  const savedSecrets = path.join(root, 'accepted-secrets.json')
  await rename(options.secretsFilePath!, savedSecrets)
  await mkdir(options.secretsFilePath!)
  const accepted = await app.handle(
    new Request('http://local/settings/write', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        mutationId: 'retain-unreadable-key-presence',
        target: 'user',
        operations: [{ kind: 'set', key: 'providers.usageStaleAfterSeconds', value: 902 }],
      }),
    }),
  )
  expect(accepted.status, await accepted.clone().text()).toBe(200)
  const retainedResponse = await app.handle(new Request('http://local/providers/usage/feed'))
  expect(retainedResponse.status).toBe(200)
  expect((await retainedResponse.json()).accounts[0]).toMatchObject({
    checkedAt: observedAt,
    windows: [{ usedPercent: 6, lastSeenAt: observedAt }],
  })
  await rm(options.secretsFilePath!, { recursive: true })
  await rename(savedSecrets, options.secretsFilePath!)
  const invalidDocuments = ['{', '[]', 'null', '', '{"usage.cliproxy.management":42}']
  for (const [index, text] of invalidDocuments.entries()) {
    await writeFile(options.secretsFilePath!, text)
    const changed = await app.handle(
      new Request('http://local/settings/write', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          mutationId: `retain-invalid-key-presence-${index}`,
          target: 'user',
          operations: [
            { kind: 'set', key: 'providers.usageStaleAfterSeconds', value: 903 + index },
          ],
        }),
      }),
    )
    expect(changed.status, await changed.clone().text()).toBe(200)
    const feed = await app.handle(new Request('http://local/providers/usage/feed'))
    const accounts = (await feed.json()).accounts
    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toMatchObject({
      checkedAt: observedAt,
      windows: [{ usedPercent: 6, lastSeenAt: observedAt }],
    })
    expect(source.requests).toHaveLength(1)
  }
  await writeFile(options.secretsFilePath!, '{}')
  const cleared = await app.handle(
    new Request('http://local/settings/write', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        mutationId: 'accept-cleared-key',
        target: 'user',
        operations: [{ kind: 'set', key: 'providers.usageStaleAfterSeconds', value: 901 }],
      }),
    }),
  )
  expect(cleared.status, await cleared.clone().text()).toBe(200)
  await collector.refresh()
  expect((await collector.read()).accounts).toEqual([])
  expect(source.requests).toHaveLength(1)
})

test.each(['different', 'same'] as const)(
  '%s-source settings invalidate observations or proofs before held reconciliation and reject late collection',
  async (transition) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TRANSCRIPT_FIXTURE_NOW)
    const root = await mkdtemp(path.join(tmpdir(), 'usage-source-race-'))
    roots.push(root)
    const options = testSettingsOptions(root)
    await mkdir(path.dirname(options.userFilePath!), { recursive: true })
    await writeFile(
      options.secretsFilePath!,
      JSON.stringify({
        [PROXY_USAGE_MANAGEMENT_KEY_REF]: 'synthetic-management-secret',
      }),
      { mode: 0o600 },
    )
    const authPath = path.join(root, 'auth.json')
    await writeFile(authPath, JSON.stringify({ tokens: { account_id: 'fixture-chatgpt-account' } }))
    const native = v.parse(providerInstanceIdSchema, 'fixture-native')
    const pending = v.parse(providerInstanceIdSchema, 'fixture-pending')
    const configuration = {
      providerInstanceId: native,
      driverKind: v.parse(providerDriverKindSchema, 'codex'),
      config: { credentialsPath: authPath },
    }
    const creating = Promise.withResolvers<void>()
    const reconciliation = Promise.withResolvers<void>()
    const collecting = Promise.withResolvers<void>()
    const response = Promise.withResolvers<void>()
    const registry = new ProviderAdapterRegistry({
      services: { cwd: root },
      drivers: [
        {
          ...mockDriver,
          driverKind: configuration.driverKind,
          create: async (input) => {
            const created = await mockDriver.create(input)
            Object.assign(created.adapter, {
              readUsage: async () => ({
                kind: 'reading',
                update: { planType: 'plus', windows: [] },
              }),
            })
            return created
          },
        },
        {
          ...mockDriver,
          create: async (input) => {
            if (input.providerInstanceId === pending) {
              creating.resolve()
              await reconciliation.promise
            }
            return mockDriver.create(input)
          },
        },
      ],
    })
    registries.push(registry)
    await registry.reconcile([configuration])
    const observedAt = new Date(TRANSCRIPT_FIXTURE_NOW - 60_000).toISOString()
    const source = startProxyUsageHttpFixture(
      observedAt,
      [
        {
          id: 'fixture-auth',
          provider: 'codex',
          id_token: { chatgpt_account_id: 'fixture-chatgpt-account' },
          quota: { observed_at: observedAt, signals: { 'x-codex-primary-used-percent': '25' } },
        },
      ],
      async (count) => {
        if (count !== 2) return
        collecting.resolve()
        await response.promise
      },
    )
    const replacement = startProxyUsageHttpFixture(observedAt)
    sources.push(source, replacement)
    await writeFile(
      options.userFilePath!,
      JSON.stringify({
        'providers.instances': [configuration],
        'providers.proxyUsageUrl': source.url,
      }),
    )
    const stateHome = path.join(root, 'state')
    const app = createTestApp({
      homeDirectory: root,
      workspaceRoot: root,
      systemRoot: root,
      settings: options,
      system: { stateHome },
      themes: { root: path.join(root, 'themes') },
      orchestration: { providerRuntime: false, providerAdapterRegistry: registry },
      auth: { allowedOrigins: [origin] },
      watch: false,
    })
    const collector = appUsageCollector(app)
    const cacheFile = path.join(stateHome, 'usage', 'accounts.json')
    const cache = async () => JSON.parse(await readFile(cacheFile, 'utf8'))
    try {
      await collector.refresh()
      const known = (await collector.read()).accounts
      expect(known).toHaveLength(1)
      expect(known[0]).toMatchObject({
        providerInstanceIds: [native],
        windows: [{ usedPercent: 25 }],
      })
      expect((await cache()).proxyProofsCurrent).toBe(true)
      vi.setSystemTime(TRANSCRIPT_FIXTURE_NOW + 900_000)
      const inFlight = collector.refresh()
      await collecting.promise
      const changed = await app.handle(
        new Request('http://local/settings/write', {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            mutationId: `source-${transition}-race`,
            target: 'user',
            operations: [
              {
                kind: 'set',
                key: 'providers.proxyUsageUrl',
                value: transition === 'different' ? replacement.url : source.url,
              },
              {
                kind: 'provider.setEnabled',
                providerInstanceId: pending,
                enabled: true,
                createIfMissing: { driverKind: mockDriver.driverKind },
              },
            ],
          }),
        }),
      )
      expect(changed.status, await changed.text()).toBe(200)
      await creating.promise
      expect(replacement.requests).toHaveLength(0)
      const publicUsage = await app.handle(
        new Request('http://local/providers/usage', { headers: { origin } }),
      )
      expect(publicUsage.status).toBe(200)
      const visible = (await publicUsage.json()).accounts
      expect((await cache()).proxyProofsCurrent).toBe(false)
      const nativeKey = registry.usageAccount(native)!.accountKey
      expect(
        visible.some((account: { accountKey: string }) => account.accountKey === nativeKey),
      ).toBe(true)
      const quotaRows = visible.flatMap(
        (account: { windows: Array<{ usedPercent: number }> }) => account.windows,
      )
      expect(quotaRows.some((window: { usedPercent: number }) => window.usedPercent === 25)).toBe(
        transition === 'same',
      )
      response.resolve()
      await inFlight
      expect((await cache()).proxyProofsCurrent).toBe(false)
      expect(
        (await collector.read()).accounts.some((account) => account.accountKey === nativeKey),
      ).toBe(true)
      if (transition === 'different')
        expect((await collector.read()).accounts.flatMap((account) => account.windows)).toEqual([])
      expect(replacement.requests).toHaveLength(0)
    } finally {
      response.resolve()
      reconciliation.resolve()
      await registry.reconcile([configuration])
    }
  },
)
