import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  type ProviderInstanceId,
  type ProviderUsageWindow,
} from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInternalError } from '../../observability/structured-errors'
import { MOCK_DRIVER_KIND, mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import type { ProviderRuntimeEvent } from '../types'
import { ProviderUsageStore } from '../usage-store'
import type { ProviderUsageProbe, ProviderUsageReading } from '../utils/usage-windows'

const WORK = v.parse(providerInstanceIdSchema, 'mock-work')
const WORK_AGAIN = v.parse(providerInstanceIdSchema, 'mock-work-again')
const PERSONAL = v.parse(providerInstanceIdSchema, 'mock-personal')
const HOME = path.join('/nonexistent', 'usage-store')
const START_MS = Date.parse('2026-09-24T10:00:00.000Z')
const registries: ProviderAdapterRegistry[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('provider usage store', () => {
  it('does not carry a previous proxy-source failure cooldown into its replacement', async () => {
    const f = await usageFixture()
    let source = 'http://127.0.0.1:18317'
    let reject!: (reason: unknown) => void
    let calls = 0
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      proxySourceKey: () => source,
      readProxy: () => {
        calls += 1
        return calls === 1
          ? new Promise((_, failure) => {
              reject = failure
            })
          : Promise.resolve([])
      },
    })
    const old = store.refresh()
    source = 'http://127.0.0.1:18318'
    store.reconfigure()
    reject(createInternalError('fixture old-source failure'))
    await old
    await store.refresh()
    expect(calls).toBe(2)
    expect((await store.read()).accounts.at(-1)).toMatchObject({
      state: 'no-data',
      checkedAt: null,
    })
    await store.close()
  })

  it('retains cooldown evidence while its expired state becomes unknown', async () => {
    const f = await usageFixture()
    const base = (await f.store.read()).accounts[0]!
    const cooldown = {
      reason: 'quota' as const,
      until: new Date(START_MS + 60_000).toISOString(),
      observedAt: new Date(START_MS).toISOString(),
      source: 'proxy-state' as const,
    }
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      readProxy: async () => [
        { ...base, accountKey: `proxy:${'a'.repeat(64)}`, state: 'cooldown', cooldown },
      ],
    })
    await store.refresh()
    expect((await store.feed()).accounts.at(-1)).toMatchObject({ state: 'cooldown', cooldown })
    f.clock.ms += 120_000
    expect((await store.feed()).accounts.at(-1)).toMatchObject({ state: 'no-data', cooldown })
    await store.close()
  })

  it('bounds UTF-8 feed bytes without losing later no-data account metadata to a large first account', async () => {
    const f = await usageFixture()
    const base = (await f.store.read()).accounts[0]!
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      readProxy: async () => [
        {
          ...base,
          accountKey: `proxy:${'a'.repeat(64)}`,
          checkedAt: new Date(START_MS).toISOString(),
          windows: Array.from({ length: 500 }, (_, index) => ({
            ...window(`quota-${index}`, 20),
            label: '界'.repeat(42),
            observedAt: new Date(START_MS).toISOString(),
          })),
        },
        { ...base, accountKey: `proxy:${'b'.repeat(64)}` },
      ],
    })
    await store.refresh()
    const feed = await store.feed()
    expect(Buffer.byteLength(JSON.stringify(feed))).toBeLessThanOrEqual(64 * 1024)
    expect(feed.accounts.at(-1)).toMatchObject({
      id: `proxy:${'b'.repeat(64)}`,
      state: 'no-data',
      checkedAt: null,
    })
    const partial = feed.accounts.find((account) => account.id === `proxy:${'a'.repeat(64)}`)!
    expect(partial.state).toBe('unknown')
    expect(partial.windows.length).toBeGreaterThan(0)
    expect(partial.windows.length).toBeLessThan(500)
    expect(partial.windows.every((quota) => quota.usedPercent === 20)).toBe(true)
    await store.close()
  })

  it('keeps scheduled collection suspended around a reset while explicit refresh remains available', async () => {
    const f = await usageFixture()
    const calls = stubUsage(f.registry, WORK, async () => reading([window('five_hour', 20)]))
    const accountKey = (await f.store.read()).accounts[0]!.accountKey
    const resume = f.store.suspendCollection(accountKey)
    await f.store.refresh()
    expect(calls.count).toBe(0)
    await f.store.refreshAccount(accountKey)
    expect(calls.count).toBe(1)
    f.clock.ms += 300_000
    await f.store.refresh()
    expect(calls.count).toBe(1)
    resume()
    await f.store.refresh()
    expect(calls.count).toBe(2)
    await f.store.close()
  })

  it('discards unattributed Codex events and clears omitted windows when account identity rotates', async () => {
    const f = await nativeClaudeFixture('codex')
    const calls = stubUsage(f.registry, WORK, async () => ({
      ...reading([window('five_hour', 10), window('seven_day', 40)]),
      identityFingerprint: 'a'.repeat(64),
    }))
    await f.store.refresh()
    f.store.accept(limitsEvent(WORK, [window('five_hour', 99)]))
    expect((await f.store.read()).accounts[0]!.windows[0]!.usedPercent).toBe(10)
    stubUsage(f.registry, WORK, async () => ({
      ...reading([window('five_hour', 5)]),
      identityFingerprint: 'b'.repeat(64),
    }))
    f.clock.ms += 300_000
    await f.store.refresh()
    expect(calls.count).toBe(1)
    expect((await f.store.read()).accounts[0]!.windows).toEqual([
      expect.objectContaining({ id: 'five_hour', usedPercent: 5 }),
    ])
    await f.store.close()
  })

  it('shares one meter between instances on the same credentials', async () => {
    const { store } = await usageFixture()
    store.accept(limitsEvent(WORK, [window('five_hour', 40)]))
    store.accept(limitsEvent(WORK_AGAIN, [window('seven_day', 70)]))
    store.accept(limitsEvent(PERSONAL, [window('five_hour', 5)]))

    const { accounts } = await store.read()
    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toMatchObject({
      driverKind: MOCK_DRIVER_KIND,
      providerInstanceIds: [WORK, WORK_AGAIN],
      windows: [
        { id: 'five_hour', usedPercent: 40 },
        { id: 'seven_day', usedPercent: 70 },
      ],
    })
    expect(accounts[1]).toMatchObject({
      providerInstanceIds: [PERSONAL],
      windows: [{ id: 'five_hour', usedPercent: 5 }],
    })
    expect(accounts[0]?.accountKey).not.toContain(HOME)
  })

  it('reads cached no-data accounts without probing, and coalesces scheduled refresh', async () => {
    const fixture = await usageFixture()
    const calls = stubUsage(fixture.registry, WORK, async () => reading([window('seven_day', 12)]))
    expect((await fixture.store.read()).accounts[0]).toMatchObject({
      state: 'no-data',
      checkedAt: null,
    })
    await fixture.store.read()
    expect(calls.count).toBe(0)
    await Promise.all([fixture.store.refresh(), fixture.store.refresh()])
    expect(calls.count).toBe(1)
    await fixture.store.refresh()
    expect(calls.count).toBe(1)
    fixture.clock.ms += 5 * 60_000
    await fixture.store.refresh()
    expect(calls.count).toBe(2)
  })

  it('keeps the known windows when a probe fails', async () => {
    const fixture = await usageFixture()
    stubUsage(fixture.registry, WORK, async () => {
      throw createInternalError('probe failed')
    })
    fixture.store.accept(limitsEvent(WORK, [window('five_hour', 40)]))

    await fixture.store.refresh()
    expect((await fixture.store.read()).accounts[0]?.windows).toEqual([
      expect.objectContaining({ id: 'five_hour', usedPercent: 40 }),
    ])
  })

  it('retains an unsupported configured account, events included', async () => {
    const fixture = await usageFixture()
    stubUsage(fixture.registry, PERSONAL, async () => ({ kind: 'unsupported' }))
    await fixture.store.refresh()
    fixture.store.accept(limitsEvent(PERSONAL, [window('five_hour', 5)]))

    expect(
      (await fixture.store.read()).accounts.find((account) =>
        account.providerInstanceIds.includes(PERSONAL),
      ),
    ).toMatchObject({ state: 'unknown', windows: [] })
  })

  it('retains a window with honest reset-passed freshness', async () => {
    const fixture = await usageFixture()
    const resetsAt = new Date(START_MS + 60_000).toISOString()
    fixture.store.accept(limitsEvent(PERSONAL, [{ ...window('five_hour', 100), resetsAt }]))
    expect(
      (await fixture.store.read()).accounts.find((account) =>
        account.providerInstanceIds.includes(PERSONAL),
      )?.windows,
    ).toHaveLength(1)

    fixture.clock.ms += 2 * 60_000
    expect(
      (await fixture.store.read()).accounts.find((account) =>
        account.providerInstanceIds.includes(PERSONAL),
      )?.windows[0],
    ).toMatchObject({ usedPercent: 100, freshness: 'reset-passed' })
  })

  it('drops the meter of an instance that settings removed', async () => {
    const { registry, store } = await usageFixture()
    store.accept(limitsEvent(PERSONAL, [window('five_hour', 5)]))
    await registry.reconcile([instance(WORK, 'work.json')])

    expect((await store.read()).accounts).toHaveLength(1)
    expect((await store.read()).accounts[0]?.providerInstanceIds).toEqual([WORK])
  })
  it('retains individual ages, ignores older arrivals, and never restamps repeated reads', async () => {
    const f = await usageFixture()
    f.store.accept(limitsEvent(WORK, [window('five_hour', 20), window('seven_day', 70)]))
    f.clock.ms += 20 * 60_000
    f.store.accept({
      ...limitsEvent(WORK, [window('five_hour', 20)]),
      createdAt: new Date(f.clock.ms).toISOString(),
    })
    f.store.accept(limitsEvent(WORK, [window('five_hour', 99)]))
    const account = (await f.store.read()).accounts[0]!
    expect(account.windows).toEqual([
      expect.objectContaining({
        usedPercent: 20,
        freshness: 'fresh',
        observedAt: new Date(f.clock.ms).toISOString(),
      }),
      expect.objectContaining({
        usedPercent: 70,
        freshness: 'stale',
        observedAt: new Date(START_MS).toISOString(),
      }),
    ])
    expect((await f.store.read()).accounts[0]?.checkedAt).toBe(account.checkedAt)
    expect((await f.store.feed()).accounts[0]?.windows[1]?.status).toBe('unknown')
  })

  it('persists last good readings and failure cooldown across restart without a provider read', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'usage-cache-'))
    roots.push(root)
    const f = await usageFixture({ cacheFile: path.join(root, 'accounts.json') })
    const calls = stubUsage(f.registry, WORK, async () => {
      throw createInternalError('fixture failure')
    })
    f.store.accept(limitsEvent(WORK, [window('five_hour', 42)]))
    await f.store.refresh()
    expect(calls.count).toBe(1)
    const restarted = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      cacheFile: path.join(root, 'accounts.json'),
    })
    expect((await restarted.read()).accounts[0]?.windows[0]?.usedPercent).toBe(42)
    await restarted.refresh()
    expect(calls.count).toBe(1)
    f.clock.ms += 600_000
    await restarted.refresh()
    expect(calls.count).toBe(2)
    expect(await readFile(path.join(root, 'accounts.json'), 'utf8')).not.toContain(HOME)
    await restarted.close()
  })

  it('keeps cache reads responsive while a scheduled provider probe is in flight', async () => {
    const f = await usageFixture()
    let release!: (probe: ProviderUsageProbe) => void
    const calls = stubUsage(
      f.registry,
      WORK,
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const refresh = f.store.refresh()
    await f.store.read()
    expect(calls.count).toBe(1)
    expect((await f.store.read()).accounts[0]?.state).toBe('no-data')
    release(reading([window('five_hour', 10)]))
    await refresh
    expect((await f.store.read()).accounts[0]?.windows[0]?.usedPercent).toBe(10)
  })

  it('preserves status-only observations through the persistent cache and strict feed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'usage-status-only-'))
    roots.push(root)
    const f = await usageFixture({ cacheFile: path.join(root, 'accounts.json') })
    f.store.accept(
      limitsEvent(WORK, [{ ...window('five_hour', 0), usedPercent: null, status: 'rejected' }]),
    )
    expect((await f.store.feed()).accounts[0]?.windows[0]).toMatchObject({
      usedPercent: null,
      status: 'exhausted',
      lastSeenAt: new Date(START_MS).toISOString(),
      source: 'rate-limit-event',
    })
    const restarted = new ProviderUsageStore(f.registry, {
      cacheFile: path.join(root, 'accounts.json'),
      now: () => f.clock.ms,
    })
    expect((await restarted.read()).accounts[0]?.windows[0]).toMatchObject({
      usedPercent: null,
      status: 'rejected',
      freshness: 'fresh',
    })
    await restarted.close()
  })

  it('rejects future, invalid-calendar and oversized hostile passive readings', async () => {
    const f = await usageFixture()
    f.store.accept({
      ...limitsEvent(WORK, [window('five_hour', 90)]),
      createdAt: new Date(START_MS + 1000).toISOString(),
    })
    f.store.accept({
      ...limitsEvent(WORK, [window('five_hour', 90)]),
      createdAt: '2026-02-30T10:00:00Z',
    })
    f.store.accept(limitsEvent(WORK, [{ ...window('five_hour', 90), label: '界'.repeat(128) }]))
    expect((await f.store.read()).accounts[0]?.windows).toEqual([])
  })

  it('keeps a newer passive observation when an older local cache and delayed SDK reply arrive', async () => {
    const f = await nativeClaudeFixture()
    const response = Promise.withResolvers<ProviderUsageProbe>()
    const started = Promise.withResolvers<void>()
    stubUsage(f.registry, WORK, () => {
      started.resolve()
      return response.promise
    })
    const refresh = f.store.refresh()
    await started.promise
    f.clock.ms += 1000
    f.store.accept({
      ...limitsEvent(WORK, [window('five_hour', 20)]),
      createdAt: new Date(f.clock.ms).toISOString(),
      payload: { planType: 'event-plan', windows: [window('five_hour', 20)] },
    })
    response.resolve({
      kind: 'reading',
      update: { planType: 'older-plan', windows: [window('five_hour', 90)] },
    })
    await refresh
    expect((await f.store.read()).accounts[0]).toMatchObject({
      planType: 'event-plan',
      checkedAt: new Date(f.clock.ms).toISOString(),
      windows: [{ usedPercent: 20, source: 'rate-limit-event' }],
    })
  })

  it('clears prior UUID observations at the same home and discards its delayed old request', async () => {
    const f = await nativeClaudeFixture()
    const response = Promise.withResolvers<ProviderUsageProbe>()
    const started = Promise.withResolvers<void>()
    const calls = stubUsage(f.registry, WORK, () => {
      started.resolve()
      return response.promise
    })
    const refresh = f.store.refresh()
    await started.promise
    await f.writeCache('fixture-new-account', 'fixture-old-account', START_MS, 70)
    response.resolve(reading([window('five_hour', 90)]))
    await refresh
    expect((await f.store.read()).accounts[0]).toMatchObject({
      checkedAt: null,
      state: 'no-data',
      windows: [],
    })
    f.clock.ms += 300_000
    await f.writeCache('fixture-new-account', 'fixture-new-account', f.clock.ms, 5)
    await f.store.refresh()
    expect(calls.count).toBe(1)
    expect((await f.store.read()).accounts[0]?.windows).toEqual([
      expect.objectContaining({ usedPercent: 5, source: 'claude-local-cache' }),
    ])
  })

  it('invalidates a credential-file generation without reading its contents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'usage-credentials-'))
    roots.push(root)
    const f = await usageFixture()
    await f.registry.reconcile([
      { ...instance(WORK, 'work.json'), config: { credentialsPath: path.join(root, 'auth.json') } },
    ])
    await writeFile(path.join(root, 'auth.json'), 'first-private-auth-record')
    const response = Promise.withResolvers<ProviderUsageProbe>()
    const calls = stubUsage(f.registry, WORK, () => response.promise)
    f.store.accept(limitsEvent(WORK, [window('five_hour', 40)]))
    const refresh = f.store.refresh()
    expect(calls.count).toBe(1)
    await writeFile(path.join(root, 'auth.json'), 'second-distinct-private-auth-record')
    expect((await f.store.read()).accounts[0]?.windows).toEqual([])
    response.resolve(reading([window('five_hour', 80)]))
    await refresh
    expect((await f.store.read()).accounts[0]?.windows).toEqual([])
  })

  it('starts background collection and rearms a changed target without a cache read', async () => {
    vi.useFakeTimers()
    const f = await usageFixture()
    try {
      const calls = stubUsage(f.registry, WORK, async () => reading([window('five_hour', 10)]))
      f.store.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(calls.count).toBe(1)
      f.store.reconfigure()
      await vi.advanceTimersByTimeAsync(0)
      expect(calls.count).toBe(1)
      f.clock.ms += 300_000
      await vi.advanceTimersByTimeAsync(300_000)
      expect(calls.count).toBe(2)
    } finally {
      await f.store.close()
      vi.useRealTimers()
    }
  })

  it('uses an explicit proxy allowance mapping without guessing account identity or probing native', async () => {
    const f = await usageFixture()
    const calls = stubUsage(f.registry, WORK, async () => reading([window('five_hour', 10)]))
    const mapped = new ProviderUsageStore(f.registry, {
      proxyInstanceIds: () => [WORK, WORK_AGAIN],
      proxyConfigured: () => true,
    })
    mapped.accept(limitsEvent(WORK, [window('five_hour', 80)]))
    await mapped.refresh()
    expect(calls.count).toBe(0)
    const accounts = (await mapped.read()).accounts
    expect(accounts.find((account) => account.accountKey === 'local-proxy-source')).toMatchObject({
      state: 'no-data',
      checkedAt: null,
      providerInstanceIds: [WORK, WORK_AGAIN],
      routing: { mode: 'unknown', active: null },
    })
    expect(accounts.some((account) => account.windows.length)).toBe(false)
    await mapped.close()
  })
})

async function usageFixture(
  options: NonNullable<ConstructorParameters<typeof ProviderUsageStore>[1]> = {},
) {
  const registry = new ProviderAdapterRegistry({
    services: { cwd: process.cwd() },
    drivers: [mockDriver],
  })
  registries.push(registry)
  await registry.reconcile([
    instance(WORK, 'work.json'),
    instance(WORK_AGAIN, 'work.json'),
    instance(PERSONAL, 'personal.json'),
  ])
  const clock = { ms: START_MS }

  return {
    clock,
    registry,
    store: new ProviderUsageStore(registry, { ...options, now: () => clock.ms }),
  }
}

/** The mock driver reads no plan; a test gives one instance a `readUsage` of its own. */
function stubUsage(
  registry: ProviderAdapterRegistry,
  providerInstanceId: ProviderInstanceId,
  readUsage: () => Promise<ProviderUsageProbe>,
) {
  const calls = { count: 0 }
  Object.assign(registry.getByInstance(providerInstanceId), {
    readUsage: () => {
      calls.count += 1
      return readUsage()
    },
  })

  return calls
}

function reading(windows: ProviderUsageReading[]): ProviderUsageProbe {
  return { kind: 'reading', update: { planType: 'max', windows } }
}

function instance(providerInstanceId: ProviderInstanceId, credentials: string) {
  return {
    config: { credentialsPath: path.join(HOME, credentials) },
    displayLabel: providerInstanceId,
    driverKind: MOCK_DRIVER_KIND,
    providerInstanceId,
  }
}

function window(id: string, usedPercent: number): ProviderUsageWindow {
  return {
    id,
    kind: id === 'five_hour' ? 'session' : 'weekly',
    label: id,
    resetsAt: null,
    status: 'allowed',
    usedPercent,
    windowMinutes: id === 'five_hour' ? 300 : 10_080,
  }
}

function limitsEvent(
  providerInstanceId: ProviderInstanceId,
  windows: ProviderUsageWindow[],
): Extract<ProviderRuntimeEvent, { type: 'account.rate-limits.updated' }> {
  return {
    createdAt: new Date(START_MS).toISOString(),
    eventId: `limits-${providerInstanceId}`,
    payload: { planType: null, windows },
    providerInstanceId,
    runtimeEpoch: 'epoch-1',
    sessionId: v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc'),
    type: 'account.rate-limits.updated',
  }
}

async function nativeClaudeFixture(kind: 'claude' | 'codex' = 'claude') {
  const root = await mkdtemp(path.join(tmpdir(), 'native-claude-usage-'))
  roots.push(root)
  const driver = {
    ...mockDriver,
    driverKind: v.parse(providerDriverKindSchema, kind),
    environment: (config: Parameters<typeof mockDriver.environment>[0]) => [
      ...mockDriver.environment(config, WORK),
      { name: 'CLAUDE_CONFIG_DIR', value: root },
    ],
  }
  const registry = new ProviderAdapterRegistry({
    services: { cwd: process.cwd() },
    drivers: [driver],
  })
  registries.push(registry)
  await registry.reconcile([
    {
      config: { credentialsPath: path.join(root, 'credentials.json') },
      displayLabel: 'Fixture',
      driverKind: driver.driverKind,
      providerInstanceId: WORK,
    },
  ])
  const clock = { ms: START_MS }
  const writeCache = (current: string, cached: string, fetchedAtMs: number, utilization: number) =>
    writeFile(
      path.join(root, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: current },
        cachedUsageUtilization: {
          accountUuid: cached,
          fetchedAtMs,
          utilization: { five_hour: { utilization, resets_at: null } },
        },
      }),
    )
  await writeCache('fixture-old-account', 'fixture-old-account', START_MS - 600_000, 23)
  return {
    registry,
    clock,
    writeCache,
    store: new ProviderUsageStore(registry, { now: () => clock.ms }),
  }
}
