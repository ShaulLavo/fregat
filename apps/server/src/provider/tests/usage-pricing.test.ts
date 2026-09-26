import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  providerUsageHistorySchema,
  sessionIdSchema,
  turnIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { expect, it } from 'vitest'
import { initializePlatformDatabase } from '../../db/initialize'
import * as schema from '../../db/schema'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { ProviderPriceCatalog } from '../price-catalog'
import { providerRoutes } from '../routes'
import type { ProviderRuntimeEvent } from '../types'
import { ProviderMaintenance } from '../provider-maintenance'
import { ProviderUsageHistoryReader } from '../usage-history'
import { ProviderUsageRecorder } from '../usage-recorder'
import { ProviderUsageStore } from '../usage-store'
import { codexUsageTotals } from '../utils/usage-totals'

it('serves automatically priced usage from the real catalog, recorder and history route', async () => {
  const sqlite = new Database(':memory:')
  const database = drizzle({ client: sqlite, schema })
  initializePlatformDatabase(database)
  const registry = new ProviderAdapterRegistry({ drivers: [] })
  const prices = new ProviderPriceCatalog(database, async () =>
    Response.json({
      openai: { models: { 'pricing-test': { cost: { input: 2, output: 10, cache_read: 0.5 } } } },
    }),
  )
  try {
    await prices.refresh()
    const recorder = new ProviderUsageRecorder(database, registry, prices)
    const event: Extract<ProviderRuntimeEvent, { type: 'usage.totals' }> = {
      type: 'usage.totals',
      eventId: 'test-usage',
      createdAt: new Date().toISOString(),
      runtimeEpoch: 'test',
      provider: v.parse(providerDriverKindSchema, 'codex'),
      providerInstanceId: v.parse(providerInstanceIdSchema, 'test-codex'),
      sessionId: v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc'),
      turnId: v.parse(turnIdSchema, 'test-turn'),
      payload: {
        totals: [
          codexUsageTotals('conversation', 'pricing-test', false, {
            inputTokens: 2_000_000,
            cachedInputTokens: 1_000_000,
            outputTokens: 100_000,
            reasoningOutputTokens: 50_000,
            totalTokens: 2_100_000,
          }),
        ],
      },
    }
    recorder.accept(event, 'turn')
    recorder.accept(event, 'turn')
    const app = providerRoutes(
      registry,
      new ProviderUsageStore(registry),
      new ProviderUsageHistoryReader(database),
      new ProviderMaintenance(registry),
    )
    const response = await app.handle(
      new Request('http://localhost/providers/usage/history?days=7&utcOffsetMinutes=0'),
    )
    expect(response.status).toBe(200)
    const history = v.parse(providerUsageHistorySchema, await response.json())
    expect(history.totals).toEqual({ costUsd: 3.5, tokens: 2_100_000, turns: 1, unpricedTokens: 0 })
    expect(history.models[0]).toMatchObject({
      model: 'pricing-test',
      costSource: 'catalog',
      costUsd: 3.5,
    })
    expect(database.select().from(schema.providerUsageTurns).get()?.priceSnapshot).toMatchObject({
      input: 2,
      output: 10,
      cacheRead: 0.5,
    })
  } finally {
    prices.close()
    await registry.dispose()
    sqlite.close()
  }
})
