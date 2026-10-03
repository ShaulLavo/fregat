import { afterEach, expect, test } from 'vitest'
import { CodexUsageRequestBudget } from '../usage-proxy-budget'
import { PROXY_USAGE_NOW as NOW, proxyUsageFixture } from '../../testing/proxy-usage'

const HOUR = 3_600_000
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test.each(['disappears', 'appears'] as const)(
  'same selector keeps its cap when identity proof %s',
  async (transition) => {
    const f = await proxyUsageFixture(cleanup)
    f.status = 401
    if (transition === 'appears') delete f.files[0]!.id_token
    const store = f.makeStore()
    await store.refresh()
    expect(f.requests).toBe(1)
    if (transition === 'disappears') delete f.files[0]!.id_token
    else f.files[0]!.id_token = { chatgpt_account_id: 'synthetic-account' }
    f.now = NOW + 1000
    await store.refresh()
    expect(f.requests).toBe(1)
  },
)

test.each([false, true])(
  'fresh passive alias suppresses the shared account request regardless of row order (%s)',
  async (freshFirst) => {
    const f = await proxyUsageFixture(cleanup)
    const freshAlias = {
      ...f.files[0],
      id: 'synthetic-other-file',
      auth_index: 'other-selector',
      quota: {
        observed_at: new Date(NOW - 60_000).toISOString(),
        signals: {
          'x-codex-primary-used-percent': '19',
          'x-codex-primary-window-minutes': '300',
        },
      },
    }
    f.files = freshFirst ? [freshAlias, ...f.files] : [...f.files, freshAlias]
    const store = f.makeStore()
    await store.refresh()
    expect(f.requests).toBe(0)
    expect((await store.read()).accounts[0]?.windows[0]?.usedPercent).toBe(19)
  },
)

test('same selector keeps its hourly cap after proof disappears and store restarts', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.status = 401
  const store = f.makeStore()
  await store.refresh()
  expect(f.requests).toBe(1)
  await store.close()
  delete f.files[0]!.id_token
  f.now = NOW + 1000
  await f.makeStore().refresh()
  expect(f.requests).toBe(1)
})

test('unrepresentable provider duration keeps the retained truthful quota', async () => {
  const f = await proxyUsageFixture(cleanup)
  const observedAt = new Date(NOW - 2 * HOUR).toISOString()
  f.files[0]!.quota = {
    observed_at: observedAt,
    signals: { 'x-codex-primary-used-percent': '19', 'x-codex-primary-window-minutes': '300' },
  }
  f.status = 401
  const store = f.makeStore()
  await store.refresh()
  expect((await store.read()).accounts[0]?.windows[0]?.usedPercent).toBe(19)
  f.status = 200
  f.response = { rate_limit: { primary_window: { used_percent: 37, limit_window_seconds: 1 } } }
  f.now = NOW + HOUR
  await store.refresh()
  expect((await store.read()).accounts[0]).toMatchObject({
    checkedAt: observedAt,
    lastSeenAt: observedAt,
    windows: [{ usedPercent: 19, observedAt, windowMinutes: 300 }],
  })
})

test.each(['fresh', 'blocked'] as const)(
  'proof learned while %s preserves the floor through alias transitions and restart',
  async (learning) => {
    const f = await proxyUsageFixture(cleanup)
    f.status = 401
    delete f.files[0]!.id_token
    const store = f.makeStore()
    await store.refresh()
    expect(f.requests).toBe(1)
    f.now = NOW + 1000
    f.files[0]!.id_token = { chatgpt_account_id: 'synthetic-account' }
    if (learning === 'fresh') {
      f.files[0]!.quota = {
        observed_at: new Date(NOW).toISOString(),
        signals: { 'x-codex-primary-used-percent': '19' },
      }
    }
    await store.refresh()
    expect(f.requests).toBe(1)
    await store.close()
    f.files = [{ ...f.files[0], id: 'synthetic-other-file', auth_index: 'other-selector' }]
    delete f.files[0]!.quota
    f.now = NOW + 2000
    const restarted = f.makeStore()
    await restarted.refresh()
    expect(f.requests).toBe(1)
    await restarted.close()
    delete f.files[0]!.id_token
    f.now = NOW + 3000
    await f.makeStore().refresh()
    expect(f.requests).toBe(1)
  },
)

test('proof and alias transitions keep failure counts and the longest deadline', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.status = 401
  delete f.files[0]!.id_token
  const store = f.makeStore()
  await store.refresh()
  f.now = NOW + HOUR
  await store.refresh()
  expect(f.requests).toBe(2)
  f.files[0]!.id_token = { chatgpt_account_id: 'synthetic-account' }
  f.now = NOW + HOUR + 1000
  await store.refresh()
  expect(f.requests).toBe(2)
  f.files = [{ ...f.files[0], id: 'synthetic-other-file', auth_index: 'other-selector' }]
  f.now = NOW + 3 * HOUR - 1
  await store.refresh()
  expect(f.requests).toBe(2)
  await store.close()
  delete f.files[0]!.id_token
  const restarted = f.makeStore()
  f.now = NOW + 3 * HOUR
  await restarted.refresh()
  expect(f.requests).toBe(3)
  f.now = NOW + 20 * HOUR
  await restarted.refresh()
  expect(f.requests).toBe(3)
})

test('joining separately reserved aliases keeps both failure counts and the longest floor', async () => {
  const f = await proxyUsageFixture(cleanup)
  f.status = 401
  const first = { ...f.files[0] }
  delete first.id_token
  const second = { ...first, id: 'synthetic-other-file', auth_index: 'other-selector' }
  f.files = [first]
  f.intervalHours = 4
  const store = f.makeStore()
  await store.refresh()
  f.files = [second]
  f.intervalHours = 1
  f.now = NOW + HOUR
  await store.refresh()
  expect(f.requests).toBe(2)
  f.files = [first, second].map((file) => ({
    ...file,
    id_token: { chatgpt_account_id: 'synthetic-account' },
  }))
  f.now = NOW + HOUR + 1000
  await store.refresh()
  expect(f.requests).toBe(2)
  await store.close()
  f.files = [first]
  const restarted = f.makeStore()
  f.now = NOW + 4 * HOUR - 1
  await restarted.refresh()
  expect(f.requests).toBe(2)
  f.now = NOW + 4 * HOUR
  await restarted.refresh()
  expect(f.requests).toBe(3)
  f.now = NOW + 100 * HOUR
  await restarted.refresh()
  expect(f.requests).toBe(3)
})

test('settling an earlier alias request cannot reset merged failures at the same timestamp', async () => {
  const f = await proxyUsageFixture(cleanup)
  let now = NOW - HOUR
  const budget = new CodexUsageRequestBudget(
    `${f.cacheFile}.codex-requests`,
    () => now,
    () => 1,
    'd'.repeat(64),
  )
  const first = 'a'.repeat(64)
  const second = 'b'.repeat(64)
  const proof = 'c'.repeat(64)
  expect(budget.reserve(first, null)).not.toBeNull()
  now = NOW
  expect(budget.reserve(first, null)).toMatchObject({ failures: 2 })
  const reservation = budget.reserve(second, null)!
  expect(reservation).toMatchObject({ failures: 1 })
  expect(budget.link(first, proof)).toBe(true)
  expect(budget.link(second, proof)).toBe(true)
  budget.settle(reservation, true)
  now = NOW + 2 * HOUR
  expect(budget.reserve(proof, null)).toBeNull()
})

test.each([59, 61, 18001, 31536001])(
  'invalid projected duration %s retains every prior field and observation age',
  async (seconds) => {
    const f = await proxyUsageFixture(cleanup)
    const store = f.makeStore()
    await store.refresh()
    const before = (await store.read()).accounts[0]!
    f.response = {
      plan_type: 'plus',
      rate_limit: {
        primary_window: { used_percent: 87, limit_window_seconds: seconds },
        secondary_window: { used_percent: 99, limit_window_seconds: 604800 },
      },
    }
    f.now = NOW + HOUR
    await store.refresh()
    const after = (await store.read()).accounts[0]!
    expect(after).toMatchObject({
      planType: before.planType,
      checkedAt: before.checkedAt,
      lastSeenAt: before.lastSeenAt,
      credits: before.credits,
      routing: before.routing,
      windows: before.windows.map((window) => ({
        ...window,
        freshness: window.id === 'primary' ? 'reset-passed' : 'stale',
      })),
    })
    await store.close()
    f.now = NOW + 2 * HOUR - 1
    await f.makeStore().refresh()
    expect(f.requests).toBe(2)
  },
)
