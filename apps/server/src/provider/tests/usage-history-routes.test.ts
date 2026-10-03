import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  providerUsageHistorySchema,
} from '@workspace/contracts'
import { afterEach, expect, onTestFinished, test, vi } from 'vitest'
import { createTestApp, createTestDatabase, closeTestApps } from '../../../test/server'
import { appUsageHistory } from '../../app'
import { providerUsageTurns } from '../../db/schema'
import { systemErrors } from '../../system/structured-errors'
import { testSettingsOptions } from '../../settings/testing'
import { nativeClaudeResponse } from '../../testing/transcript-usage'
import { MockProviderAdapter } from '../adapters/mock'
import { mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'

const roots: string[] = []
const registries: ProviderAdapterRegistry[] = []
afterEach(async () => {
  await closeTestApps()
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  vi.unstubAllEnvs()
})

test('real app history GET stays passive, picks up lifecycle refresh, and recovers cached transcripts on restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-history-routes-'))
  roots.push(root)
  const home = path.join(root, 'claude-profile')
  const transcripts = path.join(home, 'projects', 'outside-fregat')
  await mkdir(transcripts, { recursive: true })
  const file = path.join(transcripts, 'native.jsonl')
  const event = nativeClaudeResponse('native-request-1')
  event.timestamp = new Date(Date.now() - 60_000).toISOString()
  await writeFile(file, JSON.stringify(event) + '\n')
  const instance = v.parse(providerInstanceIdSchema, 'history-profile')
  const registryOptions: ConstructorParameters<typeof ProviderAdapterRegistry>[0] = {
    services: { cwd: root },
    drivers: [
      {
        ...mockDriver,
        driverKind: v.parse(providerDriverKindSchema, 'claude'),
        environment: (config, id) => [
          ...mockDriver.environment(config, id),
          { name: 'CLAUDE_CONFIG_DIR', value: home },
        ],
      },
    ],
  }
  let registry = new ProviderAdapterRegistry(registryOptions)
  registries.push(registry)
  await registry.reconcile([
    {
      providerInstanceId: instance,
      driverKind: v.parse(providerDriverKindSchema, 'claude'),
      config: { credentialsPath: path.join(home, 'credentials.json') },
    },
  ])
  const options = {
    homeDirectory: root,
    workspaceRoot: root,
    systemRoot: root,
    settings: testSettingsOptions(root),
    themes: { root: path.join(root, 'themes') },
    orchestration: { providerRuntime: false, providerAdapterRegistry: registry },
    auth: { allowedOrigins: ['http://localhost:5173'] },
    watch: false,
  }
  let app = createTestApp(options)
  const read = async () => {
    const response = await app.handle(
      new Request('http://localhost/providers/usage/history?days=7&utcOffsetMinutes=0', {
        headers: { Origin: 'http://localhost:5173' },
      }),
    )
    expect(response.status).toBe(200)
    return v.parse(providerUsageHistorySchema, await response.json())
  }
  expect((await read()).totals.tokens).toBe(0)
  expect((await read()).coverage?.status).toBe('pending')
  await appUsageHistory(app).initialize()
  expect((await read()).totals.tokens).toBe(0)
  await appUsageHistory(app).refresh()
  const first = await read()
  expect(first.totals.tokens).toBe(120)
  expect(first.coverage?.sources[0]).toMatchObject({
    driverKind: 'claude',
    sourceKind: 'native-transcript',
    records: 1,
  })
  expect(JSON.stringify(first)).not.toContain(home)
  const next = nativeClaudeResponse('native-request-2')
  next.timestamp = event.timestamp
  await appendFile(file, JSON.stringify(next) + '\n')
  expect((await read()).totals.tokens).toBe(120)
  expect((await read()).coverage?.scannedAt).toBe(first.coverage?.scannedAt)
  await appUsageHistory(app).refresh()
  expect((await read()).totals.tokens).toBe(240)
  await closeTestApps()
  await rm(file)
  registry = new ProviderAdapterRegistry(registryOptions)
  registries.push(registry)
  await registry.reconcile([
    {
      providerInstanceId: instance,
      driverKind: v.parse(providerDriverKindSchema, 'claude'),
      config: { credentialsPath: path.join(home, 'credentials.json') },
    },
  ])
  app = createTestApp({
    ...options,
    orchestration: { ...options.orchestration, providerAdapterRegistry: registry },
  })
  await appUsageHistory(app).initialize()
  expect((await read()).totals.tokens).toBe(240)
})

test('transcript roots use the actual enabled native environments and deduplicate shared homes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-history-roots-'))
  roots.push(root)
  const registry = new ProviderAdapterRegistry({
    services: { cwd: root },
    drivers: [{ ...mockDriver, driverKind: v.parse(providerDriverKindSchema, 'codex') }],
  })
  registries.push(registry)
  const entry = (id: string, home: string, enabled = true) => ({
    providerInstanceId: v.parse(providerInstanceIdSchema, id),
    driverKind: v.parse(providerDriverKindSchema, 'codex'),
    config: { credentialsPath: path.join(home, 'auth.json') },
    environment: [{ name: 'CODEX_HOME', value: home }],
    enabled,
  })
  await registry.reconcile([
    entry('a', root),
    entry('b', root),
    entry('disabled', path.join(root, 'disabled'), false),
  ])
  const sources = registry.transcriptUsageSources()
  expect(sources).toEqual([
    {
      id: expect.any(String),
      driverKind: 'codex',
      roots: [path.join(root, 'sessions'), path.join(root, 'archived_sessions')],
    },
  ])
  expect(sources[0]!.id).not.toContain(root)
})

test.each([
  { kind: 'claude', envKey: 'CLAUDE_CONFIG_DIR', directory: '.claude', children: ['projects'] },
  {
    kind: 'codex',
    envKey: 'CODEX_HOME',
    directory: '.codex',
    children: ['sessions', 'archived_sessions'],
  },
])(
  '$kind transcript roots use effective HOME and deduplicate the actual home',
  async ({ kind, envKey, directory, children }) => {
    vi.stubEnv(envKey, undefined)
    const root = await mkdtemp(path.join(tmpdir(), 'usage-history-home-'))
    roots.push(root)
    const driverKind = v.parse(providerDriverKindSchema, kind)
    const registry = new ProviderAdapterRegistry({
      services: { cwd: root },
      drivers: [{ ...mockDriver, driverKind }],
    })
    registries.push(registry)
    const personal = path.join(root, 'personal')
    await registry.reconcile([
      {
        providerInstanceId: v.parse(providerInstanceIdSchema, 'home-a'),
        driverKind,
        config: { credentialsPath: path.join(root, 'a-fixture.json') },
        environment: [{ name: 'HOME', value: root }],
      },
      {
        providerInstanceId: v.parse(providerInstanceIdSchema, 'home-b'),
        driverKind,
        config: { credentialsPath: path.join(root, 'b-fixture.json') },
        environment: [{ name: 'HOME', value: root }],
      },
      {
        providerInstanceId: v.parse(providerInstanceIdSchema, 'home-personal'),
        driverKind,
        config: { credentialsPath: path.join(root, 'personal-fixture.json') },
        environment: [{ name: 'HOME', value: personal }],
      },
    ])

    expect(registry.transcriptUsageSources()).toEqual(
      [root, personal].map((home) => ({
        id: expect.any(String),
        driverKind,
        roots: children.map((child) => path.join(home, directory, child)),
      })),
    )
  },
)

test.each(['default', 'explicit-default', 'custom'])(
  'Claude %s usage cache resolves from effective HOME',
  async (profile) => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined)
    const root = await mkdtemp(path.join(tmpdir(), 'usage-cache-home-'))
    roots.push(root)
    const driverKind = v.parse(providerDriverKindSchema, 'claude')
    const instance = v.parse(providerInstanceIdSchema, 'cache-home')
    const registry = new ProviderAdapterRegistry({
      services: { cwd: root },
      drivers: [{ ...mockDriver, driverKind }],
    })
    registries.push(registry)
    const configDir = profile === 'custom' ? path.join(root, 'profile') : path.join(root, '.claude')
    const environment = [{ name: 'HOME', value: root }]
    if (profile !== 'default') environment.push({ name: 'CLAUDE_CONFIG_DIR', value: configDir })
    await registry.reconcile([
      {
        providerInstanceId: instance,
        driverKind,
        config: { credentialsPath: path.join(configDir, '.credentials.json') },
        environment,
      },
    ])

    expect(registry.usageAccount(instance)?.claudeCachePath).toBe(
      path.join(profile === 'custom' ? configDir : root, '.claude.json'),
    )
  },
)

test.each(['claude', 'codex'])(
  'adopted %s mock adapters expose no native transcript or cache paths',
  async (kind) => {
    const root = await mkdtemp(path.join(tmpdir(), 'usage-adopted-home-'))
    roots.push(root)
    const instance = v.parse(providerInstanceIdSchema, 'adopted-native-kind')
    const adapter = new MockProviderAdapter({
      providerInstanceId: instance,
      driverKind: v.parse(providerDriverKindSchema, kind),
      env: {},
    })
    const registry = new ProviderAdapterRegistry({ services: { cwd: root }, adapters: [adapter] })
    registries.push(registry)

    expect.soft(registry.usageAccount(instance)?.claudeCachePath).toBeNull()
    expect(registry.transcriptUsageSources()).toEqual([])
  },
)

test('synthetic native drivers declare paths before becoming transcript or cache sources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-declared-home-'))
  roots.push(root)
  const driverKind = v.parse(providerDriverKindSchema, 'claude')
  const instance = v.parse(providerInstanceIdSchema, 'undeclared-native-kind')
  const registry = new ProviderAdapterRegistry({
    services: { cwd: root },
    drivers: [{ ...mockDriver, driverKind }],
  })
  registries.push(registry)
  await registry.reconcile([
    {
      providerInstanceId: instance,
      driverKind,
      environment: [{ name: 'CLAUDE_CONFIG_DIR', value: root }],
    },
  ])

  expect.soft(registry.usageAccount(instance)?.claudeCachePath).toBeNull()
  expect(registry.transcriptUsageSources()).toEqual([])
})

test('history reads retain recorded supplements before native initialization and after an identity failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-history-pending-'))
  roots.push(root)
  const database = createTestDatabase()
  const common = {
    accountKey: null,
    driverKind: 'claude',
    providerInstanceId: 'recorded-claude',
    sessionId: 'recorded-session',
    model: 'recorded-model',
    recordedAt: new Date().toISOString(),
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.01,
  }
  let identityReads = 0
  const failure = systemErrors.MACHINE_ID_UNAVAILABLE({
    internal: { platform: 'darwin', exitCode: 1 },
  })
  const app = createTestApp({
    homeDirectory: root,
    workspaceRoot: root,
    systemRoot: root,
    metadataDatabase: database,
    settings: testSettingsOptions(root),
    themes: { root: path.join(root, 'themes') },
    system: {
      stateHome: path.join(root, 'state'),
      machineId: () => {
        identityReads += 1
        throw failure
      },
    },
    orchestration: { database: database.db, providerRuntime: false },
    auth: { allowedOrigins: ['http://localhost:5173'] },
    watch: false,
  })
  database.db
    .insert(providerUsageTurns)
    .values([
      { ...common, purpose: 'turn', turnId: 'native-covered-chat' },
      { ...common, purpose: 'title', turnId: 'recorded-title' },
      { ...common, driverKind: 'opencode', purpose: 'turn', turnId: 'uncovered-chat' },
    ])
    .run()
  const upstream = vi.spyOn(globalThis, 'fetch')
  onTestFinished(() => upstream.mockRestore())
  const beforeResponse = await app.handle(
    new Request('http://localhost/providers/usage/history?days=7&utcOffsetMinutes=0', {
      headers: { Origin: 'http://localhost:5173' },
    }),
  )
  expect(beforeResponse.status).toBe(200)
  const before = v.parse(providerUsageHistorySchema, await beforeResponse.json())
  expect(before.totals).toMatchObject({ tokens: 240, turns: 2, costUsd: 0.02 })
  expect(before.purposes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ purpose: 'title', turns: 1 }),
      expect.objectContaining({ purpose: 'turn', turns: 1 }),
    ]),
  )
  expect(before.coverage).toMatchObject({ status: 'pending', scannedAt: null, sources: [] })
  expect(identityReads).toBe(0)
  const collector = appUsageHistory(app)
  expect(collector.read({ days: 30, utcOffsetMinutes: 180 }).totals).toEqual(before.totals)
  expect(identityReads).toBe(0)
  await expect(collector.initialize()).rejects.toBe(failure)
  expect(identityReads).toBe(1)
  const after = collector.read({ days: 7, utcOffsetMinutes: 0 })
  expect(after.totals).toEqual(before.totals)
  expect(after.coverage).toEqual(before.coverage)
  expect(identityReads).toBe(1)
  expect(upstream).not.toHaveBeenCalled()
  await expect(
    readFile(path.join(root, 'state', 'usage', 'transcript-history.sqlite')),
  ).rejects.toMatchObject({ code: 'ENOENT' })
  await collector.close()
  expect(identityReads).toBe(1)
})
