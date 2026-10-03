import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { providerUsageFeedSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createTestApp, closeTestApps } from '../../../test/server'
import { appUsageCollector, type App } from '../../app'
import { testSettingsOptions } from '../../settings/testing'
import { MockProviderAdapter } from '../adapters/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { codexUsageUpdate } from '../utils/usage-windows'

const REMOTE_CLIENT = '192.0.2.123'
const ORIGIN = 'http://localhost:5173'
let root: string
let app: App
let providerAdapter: MockProviderAdapter

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'platform-usage-feed-routes-'))
  providerAdapter = new MockProviderAdapter()
  app = createTestApp({
    auth: { allowedOrigins: [ORIGIN] },
    homeDirectory: root,
    workspaceRoot: root,
    systemRoot: root,
    settings: testSettingsOptions(root),
    themes: { root: path.join(root, '.platform-test') },
    devices: { ownAddresses: () => new Set() },
    orchestration: {
      providerRuntime: false,
      attachmentsDir: path.join(root, 'attachments'),
      providerAdapterRegistry: new ProviderAdapterRegistry({
        adapters: [providerAdapter],
        services: { cwd: root },
      }),
    },
    watch: false,
  })
})

afterEach(async () => {
  await closeTestApps()
  await rm(root, { recursive: true, force: true })
})

const guardedReads = [
  '/providers',
  '/providers/usage',
  '/providers/usage/history?days=7&utcOffsetMinutes=0',
  '/providers/codex/auth',
]

test('the real app serves its cache-only usage feed without a browser origin or paired device', async () => {
  let probes = 0
  const adapter = Object.assign(providerAdapter, {
    readUsage: async () => {
      probes += 1
      return {
        kind: 'reading' as const,
        update: {
          planType: 'pro',
          windows: [
            {
              id: 'five_hour',
              kind: 'session' as const,
              label: 'Five hours',
              usedPercent: 25,
              resetsAt: null,
              windowMinutes: 300,
              status: 'warning' as const,
            },
          ],
        },
      }
    },
  })
  await adapter.readUsage()
  expect(probes).toBe(1)

  for (let read = 0; read < 2; read += 1) {
    const response = await app.handle(
      new Request('http://local/providers/usage/feed', {
        headers: { 'x-forwarded-for': REMOTE_CLIENT },
      }),
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const feed = v.parse(providerUsageFeedSchema, await response.json())
    expect(feed.schemaVersion).toBe(1)
    expect(feed.accounts).toHaveLength(1)
    expect(feed.accounts[0]).toMatchObject({
      provider: 'codex',
      checkedAt: null,
      state: 'no-data',
      windows: [],
    })
    expect(probes).toBe(1)
  }

  await appUsageCollector(app).refresh()
  expect(probes).toBe(2)
  const cached = await app.handle(
    new Request('http://local/providers/usage/feed', {
      headers: { 'x-forwarded-for': REMOTE_CLIENT },
    }),
  )
  expect(cached.status, await cached.clone().text()).toBe(200)
  const feed = v.parse(providerUsageFeedSchema, await cached.json())
  expect(feed.accounts[0]).toMatchObject({
    checkedAt: expect.any(String),
    source: 'proxy-state',
    state: 'ready',
    windows: [
      {
        id: 'five_hour',
        usedPercent: 25,
        status: 'warning',
        lastSeenAt: feed.accounts[0]?.checkedAt,
      },
    ],
  })
  expect(probes).toBe(2)
})

test.for(guardedReads)('provider read %s still requires a browser origin', async (route) => {
  const admitted = await app.handle(
    new Request(`http://local${route}`, { headers: { origin: ORIGIN } }),
  )
  expect(admitted.status, await admitted.clone().text()).toBe(200)

  const missingOrigin = await app.handle(new Request(`http://local${route}`))
  expect(missingOrigin.status).toBe(401)
  expect(await missingOrigin.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })

  const foreignOrigin = await app.handle(
    new Request(`http://local${route}`, { headers: { origin: 'https://foreign.example' } }),
  )
  expect(foreignOrigin.status).toBe(403)
  expect(await foreignOrigin.json()).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN' } })
})

test.for(guardedReads)('provider read %s still requires a paired remote device', async (route) => {
  const admitted = await app.handle(
    new Request(`http://local${route}`, { headers: { origin: ORIGIN } }),
  )
  expect(admitted.status, await admitted.clone().text()).toBe(200)

  const unpaired = await app.handle(
    new Request(`http://local${route}`, {
      headers: { origin: ORIGIN, 'x-forwarded-for': REMOTE_CLIENT },
    }),
  )
  expect(unpaired.status).toBe(401)
  expect(await unpaired.json()).toMatchObject({ error: { code: 'DEVICE_NOT_PAIRED' } })
})

test('POST does not expose the public GET usage feed', async () => {
  const identities: HeadersInit[] = [
    { 'x-forwarded-for': REMOTE_CLIENT },
    { origin: ORIGIN, 'x-forwarded-for': REMOTE_CLIENT },
    { origin: ORIGIN },
  ]
  for (const headers of identities) {
    const response = await app.handle(
      new Request('http://local/providers/usage/feed', { method: 'POST', headers }),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } })
  }
})

test.each([
  { minutes: 10080, id: 'weekly', kind: 'weekly', label: 'Weekly' },
  { minutes: 300, id: 'session', kind: 'session', label: 'Session' },
  { minutes: null, id: 'other:primary', kind: 'other', label: 'Other' },
])('native raw duration survives the service and public feed: %j', async (scenario) => {
  let probes = 0
  const update = codexUsageUpdate({
    primary: {
      usedPercent: 6,
      windowDurationMins: scenario.minutes,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
    },
  })
  Object.assign(providerAdapter, {
    readUsage: async () => {
      probes += 1
      return { kind: 'reading' as const, update }
    },
  })
  const collector = appUsageCollector(app)
  await collector.refresh()
  const account = (await collector.read()).accounts[0]!
  expect(account.windows[0]).toMatchObject({
    id: 'primary',
    kind: scenario.kind,
    label: scenario.label,
    usedPercent: 6,
  })
  for (let read = 0; read < 2; read += 1) {
    const response = await app.handle(new Request('http://local/providers/usage/feed'))
    const feed = v.parse(providerUsageFeedSchema, await response.json())
    expect(feed.accounts[0]?.windows[0]).toMatchObject({
      id: scenario.id,
      label: scenario.label,
      usedPercent: 6,
      windowMinutes: scenario.minutes,
      lastSeenAt: account.windows[0]?.observedAt,
      resetsAt: account.windows[0]?.resetsAt,
    })
  }
  expect(probes).toBe(1)
})
