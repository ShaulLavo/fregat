import { once } from 'node:events'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { afterEach, expect, test } from 'vitest'
import { readFsLogs } from 'evlog/fs'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import { CodexUsageRequestBudget } from '../usage-proxy-budget'
import { PROXY_USAGE_NOW as NOW, proxyUsageFixture } from '../../testing/proxy-usage'

const HOUR = 3_600_000
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await resetObservabilityForTests()
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test('missing pooled Codex usage uses exactly the T3 usage request and truthful provenance', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.files.push({ id: 'synthetic-claude', auth_index: 'claude-selector', provider: 'claude' })
  const store = f.makeStore()
  await store.refresh()
  expect(f.requests).toBe(1)
  expect(f.payloads).toEqual([
    {
      auth_index: 'synthetic-selector',
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      header: {
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'codex-1',
        Originator: 'Codex Desktop',
        'Chatgpt-Account-Id': 'synthetic-account',
      },
    },
  ])
  const account = (await store.read()).accounts[0]!
  expect(account).toMatchObject({
    planType: 'Pro',
    checkedAt: new Date(NOW).toISOString(),
    windows: [
      {
        id: 'primary',
        usedPercent: 37,
        windowMinutes: 300,
        observedAt: new Date(NOW).toISOString(),
        source: 'cliproxy-usage-probe',
      },
      { id: 'secondary', usedPercent: 61, windowMinutes: 10080 },
    ],
    routing: { mode: 'rotating', active: true },
  })
  const before = f.managementReads
  const feed = await store.feed()
  await store.read()
  expect(f.managementReads).toBe(before)
  expect(f.requests).toBe(1)
  expect(feed.accounts[0]?.windows[0]).toMatchObject({
    source: 'proxy-state',
    lastSeenAt: new Date(NOW).toISOString(),
  })
  const saved =
    (await readFile(f.cacheFile, 'utf8')) +
    (await readFile(`${f.cacheFile}.codex-requests`, 'utf8'))
  expect((await stat(`${f.cacheFile}.codex-requests`)).mode & 0o777).toBe(0o600)
  expect(saved).not.toContain('synthetic-account')
  expect(saved).not.toContain('synthetic-selector')
  expect(saved).not.toContain('synthetic-management-secret')
})

test('fresh passive account skips requests while stale and missing accounts are independently bounded', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.files = ['fresh', 'stale', 'missing'].map((id) => ({
    id,
    auth_index: id,
    provider: 'codex',
    id_token: { chatgpt_account_id: id },
    quota:
      id === 'missing'
        ? undefined
        : {
            observed_at: new Date(id === 'fresh' ? NOW - 60_000 : NOW - HOUR).toISOString(),
            signals: {
              'x-codex-primary-used-percent': '20',
              'x-codex-primary-window-minutes': '300',
            },
          },
  }))
  const store = f.makeStore()
  await Promise.all([store.refresh(), store.refresh(), store.refresh()])
  expect(f.requests).toBe(2)
  expect(f.payloads).toMatchObject([{ auth_index: 'stale' }, { auth_index: 'missing' }])
  f.now = NOW + 1000
  await store.refresh()
  expect(f.requests).toBe(2)
  await store.close()
  const restarted = f.makeStore()
  await restarted.refresh()
  expect(f.requests).toBe(2)
  f.now = NOW + HOUR - 1
  await restarted.refresh()
  expect(f.requests).toBe(3)
  f.now = NOW + HOUR
  await restarted.refresh()
  expect(f.requests).toBe(5)
})

test('failed requests consume the persisted hourly cap, back off and give up without changing old ages', async () => {
  const f = await proxyUsageFixture(cleanup)
  const observedAt = new Date(NOW - 2 * HOUR).toISOString()
  f.files[0]!.quota = { observed_at: observedAt, signals: { 'x-codex-primary-used-percent': '19' } }
  f.status = 401
  let store = f.makeStore()
  await store.refresh()
  expect(f.requests).toBe(1)
  f.now = NOW + HOUR - 1
  await store.refresh()
  expect(f.requests).toBe(1)
  await store.close()
  store = f.makeStore()
  await store.refresh()
  expect(f.requests).toBe(1)
  f.now = NOW + HOUR
  await store.refresh()
  expect(f.requests).toBe(2)
  f.now = NOW + 2 * HOUR
  await store.refresh()
  expect(f.requests).toBe(2)
  f.now = NOW + 3 * HOUR
  await store.refresh()
  expect(f.requests).toBe(3)
  f.now = NOW + 20 * HOUR
  await store.refresh()
  await store.refresh()
  expect(f.requests).toBe(3)
  expect((await store.read()).accounts[0]).toMatchObject({
    checkedAt: observedAt,
    windows: [{ observedAt, usedPercent: 19 }],
  })
})

test.each(['off', 'source', 'credential'] as const)(
  'discards in-flight usage after %s rotation and preserves its reservation',
  async (rotation) => {
    const f = await proxyUsageFixture(cleanup)
    let release!: () => void
    let entered!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    f.beforeResponse = () => {
      entered()
      return pending
    }
    const store = f.makeStore()
    const refresh = store.refresh()
    await started
    if (rotation === 'off') f.source = null
    if (rotation === 'source') f.source = 'http://127.0.0.1:19317'
    if (rotation === 'credential') f.secret = 'rotated-synthetic-secret'
    store.reconfigure()
    release()
    await refresh
    expect((await store.read()).accounts.every((account) => account.windows.length === 0)).toBe(
      true,
    )
    f.source = 'http://127.0.0.1:18317'
    store.reconfigure()
    f.now = NOW + 1000
    await store.refresh()
    expect(f.requests).toBe(1)
  },
)

test('disabled accounts get a fresh reading while keeping disabled routing and truthful reset times', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.files[0]!.disabled = true
  f.files[0]!.status = 'disabled'
  const store = f.makeStore()
  await store.refresh()
  expect(f.requests).toBe(1)
  expect((await store.read()).accounts[0]).toMatchObject({
    state: 'disabled',
    routing: { mode: 'rotating', active: false, lastServedAt: null },
    credits: null,
    windows: [
      { freshness: 'fresh', resetsAt: new Date(NOW + HOUR).toISOString() },
      { freshness: 'fresh', resetsAt: new Date(NOW + 168 * HOUR).toISOString() },
    ],
  })
})

test('an off source performs no management or provider reads on lifecycle refresh or feed reads', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.source = null
  const store = f.makeStore()
  await store.refresh()
  await store.feed()
  await store.read()
  expect(f.managementReads).toBe(0)
  expect(f.requests).toBe(0)
})

test('two concurrent owners share the durable cap and duplicates share one identity reservation', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.files.push({ ...f.files[0], id: 'synthetic-other-file', auth_index: 'other-selector' })
  const a = f.makeStore()
  const b = f.makeStore()
  await Promise.all([a.refresh(), b.refresh()])
  expect(f.requests).toBe(1)
  f.now = NOW + HOUR - 1
  await Promise.all([a.refresh(), b.refresh()])
  expect(f.requests).toBe(1)
})

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'invalid interval %s still permits at most one request per hour',
  async (interval) => {
    const f = await proxyUsageFixture(cleanup)
    f.intervalHours = interval
    const store = f.makeStore()
    await store.refresh()
    f.now = NOW + HOUR - 1
    await store.refresh()
    expect(f.requests).toBe(1)
    f.now = NOW + HOUR
    await store.refresh()
    expect(f.requests).toBe(2)
  },
)

test('a larger configured interval persists when a restart lowers the setting', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.intervalHours = 4
  const store = f.makeStore()
  await store.refresh()
  await store.close()
  f.intervalHours = 1
  const restarted = f.makeStore()
  f.now = NOW + 4 * HOUR - 1
  await restarted.refresh()
  expect(f.requests).toBe(1)
  f.now = NOW + 4 * HOUR
  await restarted.refresh()
  expect(f.requests).toBe(2)
})

test('newer passive observations rearm give-up without bypassing the durable deadline', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.status = 401
  const store = f.makeStore()
  await store.refresh()
  f.now = NOW + HOUR
  await store.refresh()
  f.now = NOW + 3 * HOUR
  await store.refresh()
  expect(f.requests).toBe(3)
  f.now = NOW + 4 * HOUR
  f.files[0]!.quota = {
    observed_at: new Date(NOW + 3 * HOUR).toISOString(),
    signals: { 'x-codex-primary-used-percent': '23' },
  }
  await store.refresh()
  expect(f.requests).toBe(3)
  f.status = 200
  f.now = NOW + 7 * HOUR
  await store.refresh()
  expect(f.requests).toBe(4)
})

test('a corrupt budget fails closed across restarts', async () => {
  const f = await proxyUsageFixture(cleanup)
  await writeFile(`${f.cacheFile}.codex-requests`, 'synthetic interruption')
  const store = f.makeStore()
  await store.refresh()
  await store.close()
  await f.makeStore().refresh()
  expect(f.requests).toBe(0)
})

test.skipIf(!['linux', 'darwin'].includes(process.platform)).each([false, true])(
  'a killed lock owner releases collection while its reserved=%s hourly floor survives',
  async (reserve) => {
    const f = await proxyUsageFixture(cleanup)
    const store = f.makeStore()
    const child = await f.holdBudget(reserve)
    await store.refresh()
    expect(f.requests).toBe(0)
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    f.now = NOW + HOUR - 1
    await store.refresh()
    expect(f.requests).toBe(reserve ? 0 : 1)
    f.now = NOW + HOUR
    await store.refresh()
    expect(f.requests).toBe(1)
  },
)

test('an abandoned lock file cannot wedge collection after restart', async () => {
  const f = await proxyUsageFixture(cleanup)
  await writeFile(`${f.cacheFile}.codex-requests.lock`, 'synthetic interruption')
  const store = f.makeStore()
  await store.refresh()
  expect(f.requests).toBe(1)
})

test('an interrupted reservation survives restart without a response or an account cache', async () => {
  const f = await proxyUsageFixture(cleanup)
  let now = NOW
  const key = 'a'.repeat(64)
  const file = `${f.cacheFile}.codex-requests`
  const budget = new CodexUsageRequestBudget(
    file,
    () => now,
    () => 1,
    'b'.repeat(64),
  )
  expect(budget.reserve(key, null)).not.toBeNull()
  const restarted = new CodexUsageRequestBudget(
    file,
    () => now,
    () => 1,
    'b'.repeat(64),
  )
  now = NOW + HOUR - 1
  expect(restarted.reserve(key, null)).toBeNull()
  now = NOW + HOUR
  expect(restarted.reserve(key, null)).not.toBeNull()
  expect(
    new CodexUsageRequestBudget(
      undefined,
      () => now,
      () => 1,
      'b'.repeat(64),
    ).reserve(key, null),
  ).toBeNull()
})

test('reset-passed windows do not skip collection and malformed provider data cannot re-age quota', async () => {
  const f = await proxyUsageFixture(cleanup)
  const observedAt = new Date(NOW - 60_000).toISOString()
  f.files[0]!.quota = {
    observed_at: observedAt,
    signals: {
      'x-codex-primary-used-percent': '19',
      'x-codex-primary-reset-at': String(NOW / 1000 - 1),
    },
  }
  f.response = { rate_limit: { primary_window: { used_percent: 101 } } }
  const store = f.makeStore()
  await store.refresh()
  expect(f.requests).toBe(1)
  expect((await store.read()).accounts[0]).toMatchObject({
    checkedAt: observedAt,
    windows: [{ observedAt, usedPercent: 19 }],
  })
  await store.refresh()
  expect(f.requests).toBe(1)
})

test('request events are bounded, redact identities, and report failure recovery counts', async () => {
  const f = await proxyUsageFixture(cleanup)
  const logDir = `${f.root}/logs`
  initializeObservability({
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
  })
  f.status = 401
  const store = f.makeStore()
  for (let i = 0; i < 20; i += 1) {
    f.now = NOW + i
    await store.refresh()
  }
  f.now = NOW + HOUR
  f.status = 200
  await store.refresh()
  await flushObservability()
  const events = []
  for await (const event of readFsLogs({ dir: logDir })) events.push(event)
  const requests = events.filter(
    (event) => event.action === 'chat.pipeline.provider_usage.proxy_probe',
  )
  expect(requests).toHaveLength(2)
  expect(requests).toMatchObject([
    { outcome: 'provider-refused', providerRequests: 1, failedAttempts: 1 },
    { outcome: 'reading', providerRequests: 1, recoveredFailures: 1 },
  ])
  const serialized = JSON.stringify(events)
  for (const privateValue of [
    'synthetic-account',
    'synthetic-file',
    'synthetic-selector',
    'synthetic-management-secret',
  ])
    expect(serialized).not.toContain(privateValue)
})

test('a changed private identity context keeps the longest deferred deadline', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.status = 401
  const store = f.makeStore()
  await store.refresh()
  f.now = NOW + HOUR
  await store.refresh()
  await store.close()
  expect(f.requests).toBe(2)
  await writeFile(`${f.cacheFile}.identity`, 'f'.repeat(64))
  const restarted = f.makeStore()
  f.now = NOW + 3 * HOUR - 1
  await restarted.refresh()
  expect(f.requests).toBe(2)
  f.status = 200
  f.now = NOW + 3 * HOUR
  await restarted.refresh()
  expect(f.requests).toBe(3)
})

test('owners with different private contexts cannot alternate epochs inside an hourly floor', async () => {
  const f = await proxyUsageFixture(cleanup)
  let now = NOW
  const budget = (context: string) =>
    new CodexUsageRequestBudget(
      `${f.cacheFile}.codex-requests`,
      () => now,
      () => 1,
      context,
    )
  const previous = budget('a'.repeat(64))
  const current = budget('b'.repeat(64))
  expect(previous.reserve('c'.repeat(64), null)).not.toBeNull()
  expect(current.reserve('d'.repeat(64), null)).toBeNull()
  now = NOW + HOUR
  expect(current.reserve('d'.repeat(64), null)).not.toBeNull()
  expect(previous.reserve('c'.repeat(64), null)).toBeNull()
  now = NOW + 2 * HOUR
  expect(previous.reserve('c'.repeat(64), null)).not.toBeNull()
  expect(current.reserve('d'.repeat(64), null)).toBeNull()
})

test('a changed private identity context waits for persisted deadlines then resumes collection', async () => {
  const f = await proxyUsageFixture(cleanup)
  const store = f.makeStore()
  await store.refresh()
  await store.close()
  await writeFile(`${f.cacheFile}.identity`, 'f'.repeat(64))
  const restarted = f.makeStore()
  f.now = NOW + HOUR - 1
  await restarted.refresh()
  expect(f.requests).toBe(1)
  f.now = NOW + HOUR
  await restarted.refresh()
  expect(f.requests).toBe(2)
})
