import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { initializePlatformDatabase } from '../../db/initialize'
import * as schema from '../../db/schema'
import { ProviderPriceCatalog } from '../price-catalog'
import bundledPrices from '../model-prices.json'
import { estimateUsageCost, modelPrice, parseModelPrices } from '../utils/model-prices'

const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0).reverse()) close()
  vi.restoreAllMocks()
})

const catalogResponse = {
  openai: {
    models: {
      'catalog-test': { cost: { input: 2, output: 10, cache_read: 0.5 } },
      'missing-cache': { cost: { input: 3, output: 12 } },
      invalid: { cost: { input: -1, output: 10 } },
    },
  },
}

it('prefers newer bundled rates over an old cache on an offline upgrade', () => {
  const db = database()
  db.insert(schema.providerPriceCatalog)
    .values({
      id: 1,
      snapshotJson: JSON.stringify({
        fetchedAt: '2020-01-01T00:00:00.000Z',
        prices: { 'openai/gpt-5.5': { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: null } },
      }),
    })
    .run()
  const catalog = new ProviderPriceCatalog(db, async () => new Response(null, { status: 503 }))
  closers.push(() => catalog.close())
  expect(catalog.lookup('codex', 'gpt-5.5')).toMatchObject({
    ...bundledPrices.prices['openai/gpt-5.5'],
    fetchedAt: bundledPrices.fetchedAt,
  })
})

it('uses bundled prices on the first offline launch', async () => {
  const catalog = new ProviderPriceCatalog(
    database(),
    async () => new Response(null, { status: 503 }),
  )
  closers.push(() => catalog.close())
  const bundled = catalog.lookup('codex', 'gpt-5.5')
  expect(bundled).toMatchObject({ provider: 'openai', model: 'gpt-5.5' })
  await catalog.refresh()
  expect(catalog.lookup('codex', 'gpt-5.5')).toEqual(bundled)
  expect(catalog.lookup('unsupported-provider', 'gpt-5.5')).toBeNull()
})

it('refreshes once, persists valid rates, and reads them after a restart without a network call', async () => {
  const db = database()
  let calls = 0
  const catalog = new ProviderPriceCatalog(db, async () => {
    calls += 1
    return Response.json(catalogResponse)
  })
  closers.push(() => catalog.close())

  expect(catalog.lookup('codex', 'gpt-5.5')).toMatchObject({ provider: 'openai', model: 'gpt-5.5' })
  await Promise.all([catalog.refresh(), catalog.refresh()])
  expect(calls).toBe(1)
  expect(catalog.lookup('codex', 'catalog-test')).toMatchObject({ input: 2, cacheRead: 0.5 })
  expect(catalog.lookup('claude', 'catalog-test')).toBeNull()
  expect(catalog.lookup('codex', 'invalid')).toBeNull()
  expect(catalog.lookup('codex', 'catalog-test-new-version')).toBeNull()
  catalog.close()

  const restarted = new ProviderPriceCatalog(db, async () => {
    calls += 1
    return new Response(null, { status: 503 })
  })
  closers.push(() => restarted.close())
  expect(restarted.lookup('codex', 'catalog-test')?.input).toBe(2)
  await restarted.refresh()
  expect(calls).toBe(1)
})

it('keeps a stale local catalog after an invalid refresh and backs off subsequent attempts', async () => {
  const cachedAt = new Date(Date.parse(bundledPrices.fetchedAt) + 86_400_000).toISOString()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(cachedAt) + 2 * 86_400_000)
  const db = database()
  db.insert(schema.providerPriceCatalog)
    .values({
      id: 1,
      snapshotJson: JSON.stringify(parseModelPrices(catalogResponse, cachedAt)),
    })
    .run()
  let calls = 0
  const catalog = new ProviderPriceCatalog(db, async () => {
    calls += 1
    return Response.json({ openai: { models: {} } })
  })
  closers.push(() => catalog.close())
  expect(catalog.lookup('codex', 'catalog-test')?.input).toBe(2)
  await catalog.refresh()
  await catalog.refresh()
  expect(calls).toBe(2)
  expect(catalog.lookup('codex', 'catalog-test')?.input).toBe(2)
  expect(db.select().from(schema.providerPriceCatalog).get()?.snapshotJson).toContain(cachedAt)
})

it('prices cache reads separately, includes reasoning once, and never invents missing cache rates', () => {
  const snapshot = parseModelPrices(catalogResponse, '2026-09-25T00:00:00.000Z')
  const price = modelPrice(snapshot, 'codex', 'catalog-test')
  const missing = modelPrice(snapshot, 'codex', 'missing-cache')
  expect(price).not.toBeNull()
  expect(missing).not.toBeNull()
  if (!price || !missing) return
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
    reasoningTokens: 50_000,
    costUsd: null,
  }
  expect(estimateUsageCost(usage, price)).toBe(3.5)
  expect(estimateUsageCost(usage, missing)).toBeNull()
  expect(estimateUsageCost({ ...usage, cacheWriteTokens: 1 }, price)).toBeNull()
  expect(estimateUsageCost({ ...usage, cacheReadTokens: 0 }, missing)).toBe(4.2)
})

function database() {
  const sqlite = new Database(':memory:')
  closers.push(() => sqlite.close())
  const db = drizzle({ client: sqlite, schema })
  initializePlatformDatabase(db)
  return db
}
