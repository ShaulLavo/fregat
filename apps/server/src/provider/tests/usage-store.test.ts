import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  type ProviderAccountUsage,
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
import { readProxyUsage } from '../usage-proxy-source'
import { SettingsStore } from '../../settings/store'
import { testSettingsOptions } from '../../settings/testing'
import { readFsLogs } from 'evlog/fs'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import {
  codexUsageUpdate,
  type ProviderUsageProbe,
  type ProviderUsageReading,
} from '../utils/usage-windows'

const WORK = v.parse(providerInstanceIdSchema, 'mock-work')
const WORK_AGAIN = v.parse(providerInstanceIdSchema, 'mock-work-again')
const PERSONAL = v.parse(providerInstanceIdSchema, 'mock-personal')
const HOME = path.join('/nonexistent', 'usage-store')
const START_MS = Date.parse('2026-09-24T10:00:00.000Z')
const registries: ProviderAdapterRegistry[] = []
const roots: string[] = []
const settingsStores: SettingsStore[] = []

afterEach(async () => {
  await resetObservabilityForTests()
  for (const settings of settingsStores.splice(0)) settings.close()
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('provider usage store', () => {
  it.each(['claude', 'codex'] as const)(
    'uses local %s metadata labels without quota metadata or exporting email domains',
    async (kind) => {
      const f = await nativeClaudeFixture(kind)
      const credentialPath = path.join(path.dirname(f.cachePath), 'credentials.json')
      if (kind === 'claude')
        await writeFile(
          f.cachePath,
          JSON.stringify({
            oauthAccount: {
              accountUuid: 'fixture-account',
              emailAddress: 'fixture.person@example.test',
            },
          }),
        )
      else
        await writeFile(
          credentialPath,
          JSON.stringify({
            tokens: {
              id_token: `e30.${Buffer.from(JSON.stringify({ email: 'fixture.person@example.test' })).toString('base64url')}.fixture`,
            },
          }),
        )
      stubUsage(f.registry, WORK, async () => ({ kind: 'unsupported' }))
      await f.store.refresh()
      expect((await f.store.read()).accounts[0]).toMatchObject({
        label: 'fixture.person',
        windows: [],
      })
      expect((await f.store.feed()).accounts[0]!.label).toBe('fixture.person')
      expect(JSON.stringify(await f.store.read())).not.toMatch(
        /@|example.test|fixture-account|id_token/,
      )
      await f.store.close()
    },
  )

  it.each([
    {
      name: 'exact 60-minute-old cache at defaults',
      age: 3600_000,
      interval: 300_000,
      sdkCalls: 1,
    },
    { name: 'fresh cache at defaults', age: 60_000, interval: 300_000, sdkCalls: 0 },
    {
      name: '16-minute-old cache with longer registered refresh interval',
      age: 960_000,
      interval: 3600_000,
      sdkCalls: 1,
    },
    {
      name: 'exact stale boundary with longer registered refresh interval',
      age: 900_000,
      interval: 3600_000,
      sdkCalls: 1,
    },
  ])('bounds SDK refresh without redating $name', async ({ age, interval, sdkCalls }) => {
    const f = await nativeClaudeFixture()
    await f.writeCache('fixture-old-account', 'fixture-old-account', START_MS - age, 23)
    const calls = stubUsage(f.registry, WORK, async () => ({ kind: 'unsupported' }))
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      policy: () => ({
        minIntervalMs: interval,
        failureCooldownMs: 600_000,
        staleAfterMs: 900_000,
      }),
    })
    await store.refresh()
    expect(calls.count).toBe(sdkCalls)
    expect((await store.read()).accounts[0]!.windows[0]).toMatchObject({
      usedPercent: 23,
      observedAt: new Date(START_MS - age).toISOString(),
      freshness: age >= 900_000 ? 'stale' : 'fresh',
    })
    await store.refresh()
    await store.feed()
    expect(calls.count).toBe(sdkCalls)
    await store.close()
    await f.store.close()
  })

  it.each(['claude', 'codex'] as const)(
    'records one sanitized outcome for each actual %s probe and keeps polling quiet',
    async (kind) => {
      const root = await mkdtemp(path.join(tmpdir(), 'usage-outcomes-'))
      roots.push(root)
      const logDir = path.join(root, 'logs')
      initializeObservability({
        OBSERVABILITY_CONSOLE: 'false',
        OBSERVABILITY_DIR: logDir,
        OBSERVABILITY_ENABLED: 'true',
        OBSERVABILITY_INFO_SAMPLE_RATE: '100',
        NODE_ENV: 'production',
      })
      const f = await nativeClaudeFixture(kind)
      await f.writeCache('fixture-old-account', 'fixture-old-account', START_MS - 60_000, 23)
      const calls = stubUsage(f.registry, WORK, async () => ({ kind: 'unsupported' }))
      await f.store.refresh()
      await f.store.refresh()
      await f.store.read()
      expect(calls.count).toBe(kind === 'claude' ? 0 : 1)
      const adapter = f.registry.adapter(WORK)!
      delete adapter.readUsage
      f.clock.ms += 600_000
      await f.store.refresh()
      stubUsage(f.registry, WORK, async () => {
        await writeFile(
          path.join(path.dirname(f.cachePath), 'credentials.json'),
          'synthetic-generation-change',
        )
        return { kind: 'unsupported' }
      })
      f.clock.ms += 600_000
      await f.store.refresh()
      stubUsage(f.registry, WORK, async () => {
        throw createInternalError('synthetic-private-error token@example.test /private/home')
      })
      f.clock.ms += 600_000
      await f.store.refresh()
      // Failure cooldown, suspension and in-flight coalescing never create polling logs.
      await f.store.refresh()
      const key = f.registry.usageAccount(WORK)!.accountKey
      const resume = f.store.suspendCollection(key)
      f.clock.ms += 600_000
      await f.store.refresh()
      resume()
      await f.store.refresh()
      await f.store.refresh()
      let settle!: () => void
      const coalesced = stubUsage(
        f.registry,
        WORK,
        () =>
          new Promise((resolve) => {
            settle = () => resolve({ kind: 'unsupported' })
          }),
      )
      f.clock.ms += 600_000
      const first = f.store.refresh()
      const second = f.store.refresh()
      await vi.waitFor(() => expect(coalesced.count).toBe(1))
      settle()
      await Promise.all([first, second])
      expect(coalesced.count).toBe(1)
      await flushObservability()
      const events = []
      for await (const event of readFsLogs({ dir: logDir })) events.push(event)
      const outcomes = events.filter((event) =>
        String(event.action).startsWith('chat.pipeline.provider_usage.probe'),
      )
      expect(outcomes).toHaveLength(6)
      expect(outcomes.map((event) => event.outcome).sort()).toEqual(
        [
          kind === 'claude' ? 'cache-hit' : 'unsupported',
          'no-readUsage',
          'generation-discard',
          'failed',
          'failed',
          'unsupported',
        ].sort(),
      )
      expect(
        outcomes.filter((event) => event.action === 'chat.pipeline.provider_usage.probe_failed'),
      ).toHaveLength(1)
      expect(outcomes.find((event) => event.outcome === 'no-readUsage')).toMatchObject({
        collectionSkips: { cooldown: 1 },
        sdkCalls: 0,
      })
      expect(
        outcomes.find(
          (event) =>
            (event.collectionSkips as Record<string, number> | undefined)?.['already-in-flight'],
        ),
      ).toMatchObject({
        outcome: 'unsupported',
        sdkCalls: 1,
        collectionSkips: { cooldown: 1, 'already-in-flight': 1 },
      })
      expect(outcomes.find((event) => event.outcome === 'failed')).toMatchObject({
        code: expect.any(String),
        why: expect.any(String),
      })
      expect(JSON.stringify(outcomes)).not.toMatch(
        /synthetic-private-error|@example.test|private\/home|credentials.json/,
      )
      expect(
        outcomes.every((event) => !('minIntervalMs' in event) && !('staleAfterMs' in event)),
      ).toBe(true)
      await f.store.close()
    },
  )

  it('keeps the reported aged Claude windows unknown beside fresh empty probe metadata', async () => {
    const f = await nativeClaudeFixture()
    const observedAt = '2026-10-03T05:58:33.508Z'
    const checkedAt = '2026-10-03T07:14:18.887Z'
    f.clock.ms = Date.parse(checkedAt)
    await writeFile(
      f.cachePath,
      JSON.stringify({
        oauthAccount: {
          accountUuid: 'fixture-old-account',
          emailAddress: 'fixture.person@example.test',
          organizationType: 'claude_max',
        },
        cachedUsageUtilization: {
          accountUuid: 'fixture-old-account',
          fetchedAtMs: Date.parse(observedAt),
          utilization: {
            five_hour: { utilization: 5, resets_at: '2026-10-03T09:00:00.399Z' },
            seven_day: { utilization: 84, resets_at: '2026-10-07T17:00:00.399Z' },
          },
        },
      }),
    )
    stubUsage(f.registry, WORK, async () => ({
      kind: 'reading',
      update: { planType: 'claude_max', windows: [] },
    }))
    await f.store.refresh()
    f.clock.ms = Date.parse('2026-10-03T07:21:45.183Z')
    const raw = (await f.store.read()).accounts[0]!
    expect(raw).toMatchObject({
      checkedAt,
      state: 'unknown',
      windows: [
        { usedPercent: 5, observedAt, freshness: 'stale', resetsAt: '2026-10-03T09:00:00.399Z' },
        { usedPercent: 84, observedAt, freshness: 'stale', resetsAt: '2026-10-07T17:00:00.399Z' },
      ],
    })
    const feed = (await f.store.feed()).accounts[0]!
    expect(feed).toMatchObject({
      state: 'unknown',
      checkedAt,
      source: 'passive-header',
      windows: [
        { lastSeenAt: observedAt, status: 'unknown', source: 'passive-header' },
        { lastSeenAt: observedAt, status: 'unknown', source: 'passive-header' },
      ],
    })
    await f.store.close()
  })

  it.each([
    { primary: 10080, secondary: 300, ids: ['weekly', 'session'] },
    { primary: 10080, secondary: 10080, ids: ['weekly:primary', 'weekly:secondary'] },
    { primary: null, secondary: null, ids: ['other:primary', 'other:secondary'] },
  ])(
    'projects actual proxy and model durations without rekeying or redating: %j',
    async (scenario) => {
      const f = await usageFixture()
      const observedAt = new Date(START_MS - 60_000).toISOString()
      let requests = 0
      const signals = {
        'x-codex-primary-used-percent': '65',
        'x-codex-secondary-used-percent': '20',
        'x-codex-primary-reset-after-seconds': '3600',
        ...(scenario.primary === null
          ? {}
          : { 'x-codex-primary-window-minutes': String(scenario.primary) }),
        ...(scenario.secondary === null
          ? {}
          : { 'x-codex-secondary-window-minutes': String(scenario.secondary) }),
      }
      const store = new ProviderUsageStore(f.registry, {
        now: () => f.clock.ms,
        readProxy: () =>
          readProxyUsage({
            url: 'http://localhost:18317/v1',
            secret: 'synthetic-key',
            now: () => f.clock.ms,
            fetch: async () => {
              requests += 1
              return Response.json({
                files: [
                  {
                    id: 'private-auth.json',
                    provider: 'codex',
                    email: 'fixture.person@example.test',
                    quota: { observed_at: observedAt, signals },
                    model_quotas: { 'gpt-6.1-sol': { observed_at: observedAt, signals } },
                  },
                ],
              })
            },
          }),
      })
      await store.refresh()
      const raw = (await store.read()).accounts.at(-1)!
      expect(raw.windows.map(({ id }) => id)).toEqual([
        'primary',
        'secondary',
        'model:gpt-6.1-sol:primary',
        'model:gpt-6.1-sol:secondary',
      ])
      const before = JSON.stringify(raw.windows)
      for (let read = 0; read < 2; read += 1) {
        const account = (await store.feed()).accounts.at(-1)!
        expect(account.windows.map(({ id }) => id)).toEqual([
          ...scenario.ids,
          ...scenario.ids.map((id) => `model:gpt-6.1-sol:${id}`),
        ])
        expect(account.label).toBe('fixture.person')
        expect(account.source).toBe('proxy-state')
        expect(account.windows.map(({ source }) => source)).toEqual(Array(4).fill('proxy-state'))
        expect(account.windows.map(({ lastSeenAt }) => lastSeenAt)).toEqual(
          Array(4).fill(observedAt),
        )
        expect(account.windows[0]).toMatchObject({
          usedPercent: 65,
          resetsAt: new Date(START_MS - 60_000 + 3600_000).toISOString(),
        })
        expect(new Set(account.windows.map(({ id }) => id)).size).toBe(4)
        expect(JSON.stringify(account)).not.toContain('@example.test')
        expect(requests).toBe(1)
      }
      expect(JSON.stringify((await store.read()).accounts.at(-1)!.windows)).toBe(before)
      await store.close()
    },
  )

  it('keeps native and proxy identities separate when genuine short labels coincide', async () => {
    const f = await nativeClaudeFixture('codex')
    stubUsage(f.registry, WORK, async () => ({
      kind: 'reading',
      update: {
        ...codexUsageUpdate({ primary: { usedPercent: 6, windowDurationMins: 10080 } }),
        label: 'fixture.person',
      },
    }))
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      readProxy: () =>
        readProxyUsage({
          url: 'http://localhost:18317/v1',
          secret: 'synthetic-key',
          now: () => f.clock.ms,
          fetch: async () =>
            Response.json({
              files: ['first', 'second'].map((id) => ({
                id,
                provider: 'codex',
                email: 'fixture.person@example.test',
                disabled: true,
                id_token: { plan_type: 'pro' },
              })),
            }),
        }),
    })
    await store.refresh()
    const feed = await store.feed()
    expect(feed.accounts.map(({ label }) => label)).toEqual(Array(3).fill('fixture.person'))
    expect(new Set(feed.accounts.map(({ id }) => id)).size).toBe(3)
    expect(feed.accounts.map(({ source }) => source)).toEqual([
      'passive-header',
      'proxy-state',
      'proxy-state',
    ])
    expect(feed.accounts[1]).toMatchObject({
      state: 'disabled',
      plan: 'Pro',
      windows: [],
      checkedAt: null,
    })
    await store.close()
  })

  it('projects matched Claude account metadata with fresh retained SDK-independent quota', async () => {
    const f = await nativeClaudeFixture()
    await f.writeCache('fixture-old-account', 'fixture-old-account', START_MS - 300_000, 19, {
      emailAddress: 'fixture.person@example.test',
      organizationType: 'claude_max',
    })
    const calls = stubUsage(f.registry, WORK, async () => ({ kind: 'unsupported' }))
    await f.store.refresh()
    const raw = (await f.store.read()).accounts[0]!
    expect(raw).toMatchObject({
      state: 'ready',
      windows: [{ freshness: 'fresh', usedPercent: 19 }],
    })
    expect(calls.count).toBe(1)
    const feed = (await f.store.feed()).accounts[0]!
    expect(feed).toMatchObject({
      label: 'fixture.person',
      plan: 'max',
      state: 'ready',
      source: 'passive-header',
      checkedAt: new Date(START_MS - 300_000).toISOString(),
    })
    expect(feed.windows[0]).toMatchObject({
      usedPercent: 19,
      source: 'passive-header',
      lastSeenAt: new Date(START_MS - 300_000).toISOString(),
    })
    expect(JSON.stringify(feed)).not.toContain('@example.test')
    expect(feed.id).not.toContain('fixture.person')
    f.clock.ms += 900_000
    expect((await f.store.feed()).accounts[0]!.state).toBe('unknown')
    await f.store.close()
  })

  it.each([
    {
      primary: 10080,
      secondary: 300,
      ids: ['session', 'weekly'],
      kinds: ['session', 'weekly'],
      labels: ['Session', 'Weekly'],
    },
    {
      primary: 300,
      secondary: 10080,
      ids: ['session', 'weekly'],
      kinds: ['session', 'weekly'],
      labels: ['Session', 'Weekly'],
    },
    {
      primary: null,
      secondary: null,
      ids: ['other:primary', 'other:secondary'],
      kinds: ['other', 'other'],
      labels: ['Other', 'Other'],
    },
    {
      primary: 10080,
      secondary: 10080,
      ids: ['weekly:primary', 'weekly:secondary'],
      kinds: ['weekly', 'weekly'],
      labels: ['Weekly', 'Weekly'],
    },
  ])(
    'projects native duration IDs while retaining raw merge IDs and hydrated ages: %j',
    async (scenario) => {
      const f = await nativeClaudeFixture('codex')
      const root = await mkdtemp(path.join(tmpdir(), 'usage-duration-cache-'))
      roots.push(root)
      const cacheFile = path.join(root, 'accounts.json')
      const update = codexUsageUpdate({
        limitId: 'codex',
        planType: 'pro',
        primary: {
          usedPercent: 6,
          windowDurationMins: scenario.primary,
          resetsAt: START_MS / 1000 + 3600,
        },
        secondary: {
          usedPercent: 20,
          windowDurationMins: scenario.secondary,
          resetsAt: START_MS / 1000 + 7200,
        },
        credits: null,
      })
      let probes = 0
      stubUsage(f.registry, WORK, async () => {
        probes += 1
        return { kind: 'reading', update }
      })
      const store = new ProviderUsageStore(f.registry, { now: () => f.clock.ms, cacheFile })
      await store.refresh()
      const raw = (await store.read()).accounts[0]!
      expect(raw.windows.map((window) => window.kind)).toEqual(scenario.kinds)
      expect(raw.windows.map((window) => window.label)).toEqual(scenario.labels)
      expect(new Set(raw.windows.map((window) => window.id))).toEqual(
        new Set(['primary', 'secondary']),
      )
      await store.close()
      f.clock.ms += 60_000
      const retained = new ProviderUsageStore(f.registry, { now: () => f.clock.ms, cacheFile })
      try {
        const windows = (await retained.feed()).accounts[0]!.windows
        expect(windows.map((window) => window.id)).toEqual(scenario.ids)
        expect(windows.map((window) => window.label)).toEqual(scenario.labels)
        expect(windows.map((window) => window.lastSeenAt)).toEqual([
          new Date(START_MS).toISOString(),
          new Date(START_MS).toISOString(),
        ])
        expect(windows.find((window) => window.usedPercent === 6)?.resetsAt).toBe(
          new Date(START_MS + 3600_000).toISOString(),
        )
        expect(windows.find((window) => window.usedPercent === 20)?.resetsAt).toBe(
          new Date(START_MS + 7200_000).toISOString(),
        )
        expect(probes).toBe(1)
      } finally {
        await retained.close()
      }
    },
  )

  it('updates proxy restrictions independently of retained quota ages and clears recovered cooldowns', async () => {
    const f = await usageFixture()
    const base = (await f.store.read()).accounts[0]!
    const at = new Date(START_MS).toISOString()
    let snapshot: ProviderAccountUsage = {
      ...base,
      accountKey: `proxy:${'a'.repeat(64)}`,
      source: 'cli-proxy-management',
      state: 'ready',
      stateObservedAt: at,
      checkedAt: at,
      lastSeenAt: at,
      windows: [{ ...window('primary', 30), observedAt: at }],
      routing: { mode: 'rotating', active: true, lastServedAt: null },
    }
    const root = await mkdtemp(path.join(tmpdir(), 'usage-control-state-'))
    roots.push(root)
    const cacheFile = path.join(root, 'accounts.json')
    const options = { now: () => f.clock.ms, cacheFile, readProxy: async () => [snapshot] }
    const store = new ProviderUsageStore(f.registry, options)
    await store.refresh()
    f.clock.ms += 300_000
    snapshot = {
      ...snapshot,
      state: 'disabled',
      stateObservedAt: new Date(f.clock.ms).toISOString(),
      checkedAt: null,
      lastSeenAt: null,
      windows: [],
      routing: { mode: 'rotating', active: false, lastServedAt: null },
    }
    await store.refresh()
    expect((await store.read()).accounts.at(-1)).toMatchObject({
      state: 'disabled',
      checkedAt: at,
      windows: [{ observedAt: at, usedPercent: 30 }],
      routing: { active: false },
    })
    f.clock.ms += 300_000
    const cooldown = {
      reason: 'quota' as const,
      until: new Date(f.clock.ms + 600_000).toISOString(),
      observedAt: new Date(f.clock.ms).toISOString(),
      source: 'proxy-state' as const,
    }
    snapshot = { ...snapshot, state: 'cooldown', stateObservedAt: cooldown.observedAt, cooldown }
    await store.refresh()
    expect((await store.feed()).accounts.at(-1)).toMatchObject({
      state: 'cooldown',
      checkedAt: at,
      cooldown,
      windows: [{ lastSeenAt: at }],
    })
    f.clock.ms += 300_000
    snapshot = {
      ...snapshot,
      state: 'ready',
      stateObservedAt: new Date(f.clock.ms).toISOString(),
      cooldown: undefined,
    }
    await store.refresh()
    expect((await store.read()).accounts.at(-1)).toMatchObject({ cooldown: null, checkedAt: at })
    await store.close()
    const restarted = new ProviderUsageStore(f.registry, options)
    expect((await restarted.read()).accounts.at(-1)).toMatchObject({
      cooldown: null,
      checkedAt: at,
      windows: [{ observedAt: at }],
    })
    await restarted.close()
  })

  it('does not overwrite newer control restrictions with newer quota carrying older control evidence', async () => {
    const f = await usageFixture()
    const base = (await f.store.read()).accounts[0]!
    const at = new Date(START_MS).toISOString()
    let snapshot: ProviderAccountUsage = {
      ...base,
      accountKey: `proxy:${'a'.repeat(64)}`,
      source: 'cli-proxy-management',
      state: 'disabled',
      stateObservedAt: at,
      checkedAt: at,
      windows: [{ ...window('primary', 20), observedAt: at }],
      routing: { mode: 'rotating', active: false, lastServedAt: null },
    }
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      readProxy: async () => [snapshot],
    })
    await store.refresh()
    f.clock.ms += 300_000
    const next = new Date(f.clock.ms).toISOString()
    snapshot = {
      ...snapshot,
      state: 'ready',
      stateObservedAt: new Date(START_MS - 1000).toISOString(),
      checkedAt: next,
      windows: [{ ...window('primary', 30), observedAt: next }],
      routing: { mode: 'rotating', active: true, lastServedAt: null },
    }
    await store.refresh()
    expect((await store.feed()).accounts.at(-1)).toMatchObject({
      state: 'disabled',
      checkedAt: next,
      routing: { active: false },
      windows: [{ usedPercent: 30, lastSeenAt: next }],
    })
    await store.close()
  })

  it.each(['retry', 'unavailable', 'undated-cooldown'] as const)(
    'keeps actual proxy %s restrictions over fresh quota windows',
    async (restriction) => {
      const f = await usageFixture()
      const store = new ProviderUsageStore(f.registry, {
        now: () => f.clock.ms,
        readProxy: () =>
          readProxyUsage({
            url: 'http://127.0.0.1:18317',
            secret: 'fixture-secret',
            now: () => f.clock.ms,
            fetch: async () =>
              Response.json({
                files: [
                  {
                    id: 'private-fixture',
                    provider: 'codex',
                    status: 'active',
                    ...(restriction === 'retry'
                      ? { next_retry_after: new Date(START_MS + 600_000).toISOString() }
                      : { unavailable: true }),
                    ...(restriction === 'undated-cooldown'
                      ? {
                          cooldowns: [
                            {
                              scope: 'credential',
                              reason: 'quota',
                              observed_at: new Date(START_MS - 7_200_000).toISOString(),
                            },
                          ],
                        }
                      : {}),
                    quota: {
                      observed_at: new Date(START_MS).toISOString(),
                      signals: {
                        'x-codex-primary-used-percent': '25',
                        'x-codex-primary-window-minutes': '300',
                      },
                    },
                  },
                ],
              }),
          }),
      })
      await store.refresh()
      expect((await store.feed()).accounts.at(-1)).toMatchObject({
        state: restriction === 'unavailable' ? 'unknown' : 'cooldown',
        routing: { active: false },
        windows: [{ usedPercent: 25, lastSeenAt: new Date(START_MS).toISOString() }],
      })
      await store.close()
    },
  )

  it('keeps an aged undated control restriction unknown beside newer quota until fresh ready metadata clears it', async () => {
    const f = await usageFixture()
    const base = (await f.store.read()).accounts[0]!
    const at = new Date(START_MS).toISOString()
    const cooldown = {
      reason: 'quota' as const,
      until: null,
      observedAt: at,
      source: 'proxy-state' as const,
    }
    let snapshot: ProviderAccountUsage = {
      ...base,
      accountKey: `proxy:${'a'.repeat(64)}`,
      source: 'cli-proxy-management',
      state: 'cooldown',
      stateObservedAt: at,
      checkedAt: at,
      cooldown,
      windows: [{ ...window('primary', 20), observedAt: at }],
    }
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      readProxy: async () => [snapshot],
    })
    await store.refresh()
    expect((await store.feed()).accounts.at(-1)!.state).toBe('cooldown')
    f.clock.ms += 900_000
    const quotaAt = new Date(f.clock.ms).toISOString()
    snapshot = {
      ...snapshot,
      state: 'ready',
      stateObservedAt: new Date(START_MS - 1000).toISOString(),
      cooldown: undefined,
      checkedAt: quotaAt,
      windows: [{ ...window('primary', 25), observedAt: quotaAt }],
    }
    await store.refresh()
    expect((await store.read()).accounts.at(-1)).toMatchObject({
      state: 'unknown',
      stateObservedAt: at,
      checkedAt: quotaAt,
      cooldown,
      windows: [{ freshness: 'fresh', observedAt: quotaAt }],
    })
    f.clock.ms += 300_000
    snapshot = { ...snapshot, stateObservedAt: new Date(f.clock.ms).toISOString() }
    await store.refresh()
    expect((await store.read()).accounts.at(-1)).toMatchObject({
      state: 'ready',
      checkedAt: quotaAt,
      cooldown: null,
      windows: [{ freshness: 'fresh', observedAt: quotaAt }],
    })
    await store.close()
  })

  it('clears explicit null credits while preserving omitted sparse native credits across restart', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'usage-credit-clear-'))
    roots.push(root)
    const f = await nativeClaudeFixture('codex')
    const cacheFile = path.join(root, 'accounts.json')
    const store = new ProviderUsageStore(f.registry, { now: () => f.clock.ms, cacheFile })
    let credits: { balance: number; unlimited: boolean } | null | undefined = {
      balance: 12,
      unlimited: false,
    }
    stubUsage(f.registry, WORK, async () => ({
      kind: 'reading',
      update: { planType: 'max', windows: [], ...(credits === undefined ? {} : { credits }) },
    }))
    await store.refresh()
    credits = undefined
    f.clock.ms += 300_000
    await store.refresh()
    expect((await store.feed()).accounts[0]!.credits).toEqual({ balance: 12, unlimited: false })
    credits = null
    f.clock.ms += 300_000
    await store.refresh()
    expect((await store.read()).accounts[0]!.credits).toBeNull()
    expect((await store.feed()).accounts[0]!.credits).toBeUndefined()
    await store.close()
    const restarted = new ProviderUsageStore(f.registry, { now: () => f.clock.ms, cacheFile })
    expect((await restarted.read()).accounts[0]!.credits).toBeNull()
    expect((await restarted.feed()).accounts[0]!.credits).toBeUndefined()
    await restarted.close()
  })

  it('ignores cross-driver, disabled and removed proxy memberships without suppressing native Claude', async () => {
    const f = await nativeClaudeFixture()
    const root = await mkdtemp(path.join(tmpdir(), 'usage-mapping-settings-'))
    roots.push(root)
    const settings = new SettingsStore(testSettingsOptions(root))
    settingsStores.push(settings)
    await settings.write({
      mutationId: 'cross-driver-proxy-map',
      target: 'user',
      operations: [
        {
          kind: 'set',
          key: 'providers.proxyUsageProviderInstanceIds',
          value: [WORK, PERSONAL, WORK_AGAIN],
        },
      ],
    })
    const codex = { ...mockDriver, driverKind: v.parse(providerDriverKindSchema, 'codex') }
    const registry = new ProviderAdapterRegistry({
      services: { cwd: process.cwd() },
      drivers: [{ ...mockDriver, driverKind: v.parse(providerDriverKindSchema, 'claude') }, codex],
    })
    registries.push(registry)
    const entries = [
      {
        providerInstanceId: WORK,
        driverKind: v.parse(providerDriverKindSchema, 'claude'),
        config: { credentialsPath: path.join(root, 'claude', 'credentials.json') },
        environment: [{ name: 'CLAUDE_CONFIG_DIR', value: path.join(root, 'claude') }],
      },
      {
        providerInstanceId: PERSONAL,
        driverKind: codex.driverKind,
        config: { credentialsPath: path.join(HOME, 'codex.json') },
      },
    ]
    await registry.reconcile(entries)
    const calls = stubUsage(registry, WORK, async () => reading([window('five_hour', 20)]))
    const codexCalls = stubUsage(registry, PERSONAL, async () => reading([window('primary', 40)]))
    const store = new ProviderUsageStore(registry, {
      now: () => f.clock.ms,
      proxyConfigured: () => true,
      proxyInstanceIds: () => settings.snapshot().values['providers.proxyUsageProviderInstanceIds'],
      cacheFile: path.join(root, 'usage.json'),
    })
    await store.refresh()
    expect(calls.count).toBe(1)
    expect(codexCalls.count).toBe(0)
    expect((await store.read()).accounts.at(-1)!.providerInstanceIds).toEqual([PERSONAL])
    expect((await store.read()).accounts[0]).toMatchObject({
      driverKind: 'claude',
      providerInstanceIds: [WORK],
      windows: [{ usedPercent: 20 }],
    })
    await registry.reconcile([{ ...entries[0]! }, { ...entries[1]!, enabled: false }])
    expect((await store.read()).accounts.at(-1)!.providerInstanceIds).toEqual([])
    await registry.reconcile([entries[0]!])
    expect((await store.read()).accounts.at(-1)!.providerInstanceIds).toEqual([])
    await store.close()
    const restarted = new ProviderUsageStore(registry, {
      now: () => f.clock.ms,
      cacheFile: path.join(root, 'usage.json'),
      proxyConfigured: () => true,
      proxyInstanceIds: () => settings.snapshot().values['providers.proxyUsageProviderInstanceIds'],
    })
    expect((await restarted.read()).accounts.at(-1)!.providerInstanceIds).toEqual([])
    expect((await restarted.read()).accounts[0]!.driverKind).toBe('claude')
    await restarted.close()
  })

  it('does not manufacture independent window age from account checkedAt', async () => {
    const f = await usageFixture()
    const base = (await f.store.read()).accounts[0]!
    const store = new ProviderUsageStore(f.registry, {
      now: () => f.clock.ms,
      readProxy: async () => [
        {
          ...base,
          accountKey: `proxy:${'a'.repeat(64)}`,
          source: 'cli-proxy-management',
          checkedAt: new Date(START_MS).toISOString(),
          windows: [
            { ...window('status-only', 0), usedPercent: null, status: 'warning', observedAt: null },
          ],
        },
      ],
    })
    await store.refresh()
    expect((await store.read()).accounts.at(-1)!.windows).toEqual([
      expect.objectContaining({ observedAt: null, freshness: 'unknown' }),
    ])
    expect((await store.feed()).accounts.at(-1)!.windows).toEqual([
      expect.objectContaining({ lastSeenAt: null, status: 'unknown' }),
    ])
    await store.close()
  })

  it.each(['reading', 'unsupported'] as const)(
    'observes settled native Claude %s control probes independently from old quota',
    async (kind) => {
      const root = await mkdtemp(path.join(tmpdir(), 'usage-probe-observability-'))
      roots.push(root)
      const logDir = path.join(root, 'logs')
      initializeObservability({
        OBSERVABILITY_CONSOLE: 'false',
        OBSERVABILITY_DIR: logDir,
        OBSERVABILITY_ENABLED: 'true',
        OBSERVABILITY_INFO_SAMPLE_RATE: '100',
        NODE_ENV: 'production',
      })
      const f = await nativeClaudeFixture()
      const calls = stubUsage(f.registry, WORK, async () =>
        kind === 'reading'
          ? { kind: 'reading', update: { planType: 'max', windows: [] } }
          : { kind: 'unsupported' },
      )
      await f.store.refresh()
      expect(calls.count).toBe(1)
      await flushObservability()
      const events = []
      for await (const event of readFsLogs({ dir: logDir })) events.push(event)
      expect(
        events.filter((event) => event.action === 'chat.pipeline.provider_usage.probe'),
      ).toEqual([
        expect.objectContaining({
          driverKind: 'claude',
          outcome: kind,
          source: 'claude-sdk-control',
        }),
      ])
      const window = (await f.store.read()).accounts[0]!.windows[0]!
      expect(window).toMatchObject({
        usedPercent: 23,
        observedAt: new Date(START_MS - 600_000).toISOString(),
        source: 'claude-local-cache',
      })
      await f.store.close()
    },
  )

  it('backs off cache writes, warns once per failed series and reports recovery counts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'usage-write-series-'))
    roots.push(root)
    const logDir = path.join(root, 'logs')
    initializeObservability({
      OBSERVABILITY_CONSOLE: 'false',
      OBSERVABILITY_DIR: logDir,
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_INFO_SAMPLE_RATE: '100',
      NODE_ENV: 'production',
    })
    const blocker = path.join(root, 'blocked')
    await writeFile(blocker, 'fixture blocks cache directory')
    const f = await usageFixture()
    const cacheFile = path.join(blocker, 'accounts.json')
    const store = new ProviderUsageStore(f.registry, { now: () => f.clock.ms, cacheFile })
    for (let count = 0; count < 5; count += 1)
      store.accept(limitsEvent(WORK, [window('five_hour', count)]))
    f.clock.ms += 600_000
    store.accept(limitsEvent(WORK, [window('five_hour', 10)]))
    await flushObservability()
    const events = []
    for await (const event of readFsLogs({ dir: logDir })) events.push(event)
    expect(
      events.filter((event) => event.action === 'chat.pipeline.provider_usage.cache_write_failed'),
    ).toHaveLength(1)
    await rm(blocker)
    // Recovery waits for the same configured failure cooldown, then persists latest memory.
    store.accept(limitsEvent(WORK, [window('five_hour', 11)]))
    f.clock.ms += 600_000
    store.accept(limitsEvent(WORK, [window('five_hour', 12)]))
    await flushObservability()
    const recovered = []
    for await (const event of readFsLogs({ dir: logDir })) recovered.push(event)
    expect(
      recovered.filter(
        (event) => event.action === 'chat.pipeline.provider_usage.cache_write_recovered',
      ),
    ).toEqual([expect.objectContaining({ failedAttempts: 2, suppressedWrites: 5 })])
    expect(
      JSON.parse(await readFile(cacheFile, 'utf8')).accounts[0].snapshot.windows[0].usedPercent,
    ).toBe(12)
    await store.close()
  })

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

  it('retains a native no-data account when control is unsupported and accepts Claude passive evidence', async () => {
    const f = await nativeClaudeFixture()
    await f.writeCache('fixture-old-account', 'fixture-other-account', START_MS, 19)
    const calls = stubUsage(f.registry, WORK, async () => ({ kind: 'unsupported' }))
    await f.store.refresh()
    const empty = (await f.store.read()).accounts[0]
    f.store.accept(limitsEvent(WORK, [window('five_hour', 5)]))
    expect((await f.store.read()).accounts[0]).toMatchObject({
      state: 'ready',
      checkedAt: new Date(START_MS).toISOString(),
      windows: [{ usedPercent: 5, source: 'rate-limit-event' }],
    })
    expect(empty).toMatchObject({
      state: 'no-data',
      checkedAt: null,
      lastSeenAt: null,
      windows: [],
    })
    f.clock.ms += 300_000
    await f.store.refresh()
    expect(calls.count).toBe(2)
    expect((await f.store.read()).accounts[0]).toMatchObject({
      checkedAt: new Date(START_MS).toISOString(),
      windows: [{ usedPercent: 5, source: 'rate-limit-event' }],
    })
  })

  it('retains matched local-cache observations across unsupported SDK refresh and restart without redating', async () => {
    const f = await nativeClaudeFixture()
    const root = await mkdtemp(path.join(tmpdir(), 'usage-unsupported-'))
    roots.push(root)
    const options = { cacheFile: path.join(root, 'accounts.json'), now: () => f.clock.ms }
    const store = new ProviderUsageStore(f.registry, options)
    const observedAt = new Date(START_MS).toISOString()
    await f.writeCache('fixture-old-account', 'fixture-old-account', START_MS, 19)
    const calls = stubUsage(f.registry, WORK, async () => ({ kind: 'unsupported' }))
    await store.refresh()
    expect(calls.count).toBe(0)
    expect((await store.read()).accounts[0]).toMatchObject({
      checkedAt: observedAt,
      windows: [{ usedPercent: 19, observedAt, source: 'claude-local-cache' }],
    })
    f.clock.ms += 300_000
    await store.refresh()
    expect(calls.count).toBe(1)
    expect((await store.read()).accounts[0]).toMatchObject({
      checkedAt: observedAt,
      lastSeenAt: observedAt,
      windows: [{ usedPercent: 19, observedAt, source: 'claude-local-cache', freshness: 'fresh' }],
    })
    await store.close()
    const restarted = new ProviderUsageStore(f.registry, options)
    expect((await restarted.feed()).accounts[0]).toMatchObject({
      checkedAt: observedAt,
      lastSeenAt: observedAt,
      windows: [{ usedPercent: 19, lastSeenAt: observedAt, source: 'passive-header' }],
    })
    await restarted.refresh()
    expect(calls.count).toBe(1)
    f.clock.ms += 900_000
    await restarted.refresh()
    expect(calls.count).toBe(2)
    expect((await restarted.read()).accounts[0]).toMatchObject({
      state: 'unknown',
      checkedAt: observedAt,
      windows: [{ usedPercent: 19, observedAt, source: 'claude-local-cache', freshness: 'stale' }],
    })
    restarted.accept({
      ...limitsEvent(WORK, [window('five_hour', 25)]),
      createdAt: new Date(f.clock.ms).toISOString(),
    })
    expect((await restarted.read()).accounts[0]).toMatchObject({
      state: 'ready',
      checkedAt: new Date(f.clock.ms).toISOString(),
      windows: [{ usedPercent: 25, source: 'rate-limit-event', freshness: 'fresh' }],
    })
    await restarted.close()
    const final = new ProviderUsageStore(f.registry, options)
    expect((await final.feed()).accounts[0]).toMatchObject({
      source: 'passive-header',
      windows: [{ usedPercent: 25, source: 'passive-header' }],
    })
    await final.close()
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
      source: 'passive-header',
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

  it.each(['reading', 'unsupported'] as const)(
    'keeps a newer passive observation when an older local cache and delayed SDK %s arrive',
    async (kind) => {
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
      response.resolve(
        kind === 'reading'
          ? {
              kind: 'reading',
              update: { planType: 'older-plan', windows: [window('five_hour', 90)] },
            }
          : { kind: 'unsupported' },
      )
      await refresh
      expect((await f.store.read()).accounts[0]).toMatchObject({
        planType: 'event-plan',
        checkedAt: new Date(f.clock.ms).toISOString(),
        windows: [{ usedPercent: 20, source: 'rate-limit-event' }],
      })
    },
  )

  it.each(['reading', 'unsupported'] as const)(
    'clears prior UUID observations at the same home and discards its delayed old %s',
    async (kind) => {
      const f = await nativeClaudeFixture()
      const response = Promise.withResolvers<ProviderUsageProbe>()
      const started = Promise.withResolvers<void>()
      const calls = stubUsage(f.registry, WORK, () => {
        started.resolve()
        return response.promise
      })
      await f.writeCache('fixture-old-account', 'fixture-old-account', START_MS - 600_000, 23, {
        emailAddress: 'prior.person@example.test',
      })
      const refresh = f.store.refresh()
      await started.promise
      expect((await f.store.feed()).accounts[0]!.label).toBe('prior.person')
      await f.writeCache('fixture-new-account', 'fixture-old-account', START_MS, 70, {
        emailAddress: 'unrelated.person@example.test',
      })
      response.resolve(
        kind === 'reading' ? reading([window('five_hour', 90)]) : { kind: 'unsupported' },
      )
      await refresh
      expect((await f.store.read()).accounts[0]).toMatchObject({
        checkedAt: null,
        state: 'no-data',
        windows: [],
      })
      expect((await f.store.feed()).accounts[0]!.label).not.toMatch(
        /prior\.person|unrelated\.person/,
      )
      f.clock.ms += 300_000
      await f.writeCache('fixture-new-account', 'fixture-new-account', f.clock.ms, 5, {
        emailAddress: 'new.person@example.test',
      })
      await f.store.refresh()
      expect(calls.count).toBe(1)
      expect((await f.store.feed()).accounts[0]!.label).toBe('new.person')
      expect((await f.store.read()).accounts[0]?.windows).toEqual([
        expect.objectContaining({ usedPercent: 5, source: 'claude-local-cache' }),
      ])
    },
  )

  it.each(['reading', 'unsupported'] as const)(
    'invalidates a credential-file generation before delayed %s without reading its contents',
    async (kind) => {
      const root = await mkdtemp(path.join(tmpdir(), 'usage-credentials-'))
      roots.push(root)
      const f = await usageFixture()
      await f.registry.reconcile([
        {
          ...instance(WORK, 'work.json'),
          config: { credentialsPath: path.join(root, 'auth.json') },
        },
      ])
      await writeFile(path.join(root, 'auth.json'), 'first-private-auth-record')
      const response = Promise.withResolvers<ProviderUsageProbe>()
      const calls = stubUsage(f.registry, WORK, () => response.promise)
      f.store.accept(limitsEvent(WORK, [window('five_hour', 40)]))
      const refresh = f.store.refresh()
      expect(calls.count).toBe(1)
      await writeFile(path.join(root, 'auth.json'), 'second-distinct-private-auth-record')
      expect((await f.store.read()).accounts[0]?.windows).toEqual([])
      response.resolve(
        kind === 'reading' ? reading([window('five_hour', 80)]) : { kind: 'unsupported' },
      )
      await refresh
      expect((await f.store.read()).accounts[0]?.windows).toEqual([])
    },
  )

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
    const f = await nativeClaudeFixture('codex')
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
      providerInstanceIds: [WORK],
      routing: { mode: 'unknown', active: null },
    })
    expect(accounts.some((account) => account.windows.length)).toBe(false)
    await mapped.close()
    let proxyReads = 0
    const unconfigured = new ProviderUsageStore(f.registry, {
      proxyInstanceIds: () => [WORK],
      proxyConfigured: () => false,
      readProxy: async () => {
        proxyReads += 1
        return []
      },
    })
    unconfigured.accept(limitsEvent(WORK, [window('five_hour', 80)]))
    await unconfigured.refresh()
    expect((await unconfigured.read()).accounts).toEqual([])
    expect(proxyReads).toBe(0)
    expect(calls.count).toBe(0)
    await unconfigured.close()
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
  const writeCache = (
    current: string,
    cached: string,
    fetchedAtMs: number,
    utilization: number,
    metadata: { emailAddress?: string; organizationType?: string } = {},
  ) =>
    writeFile(
      path.join(root, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: current, ...metadata },
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
    cachePath: path.join(root, '.claude.json'),
    writeCache,
    store: new ProviderUsageStore(registry, { now: () => clock.ms }),
  }
}
