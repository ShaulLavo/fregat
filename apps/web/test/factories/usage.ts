import { onTestFinished } from 'vitest'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  MockProviderAdapter,
  ProviderAdapterRegistry,
  ProviderPriceCatalog,
  ProviderUsageRecorder,
} from 'server/testing'
import type { TestServer } from '../server'

/** The real catalog and recorder write the database the owner's history route reads. */
export async function recordUsageFixture(server: TestServer, inputRate: number) {
  const instance = v.parse(providerInstanceIdSchema, 'usage-fixture')
  const registry = new ProviderAdapterRegistry({
    services: { cwd: process.cwd() },
    adapters: [
      new MockProviderAdapter({
        driverKind: v.parse(providerDriverKindSchema, 'codex'),
        providerInstanceId: instance,
      }),
    ],
  })
  const prices = new ProviderPriceCatalog(server.database.db, async () =>
    Response.json({
      openai: {
        models: { 'fixture-model': { cost: { input: inputRate, output: 10, cache_read: 0.5 } } },
      },
    }),
  )
  await prices.refresh()
  onTestFinished(async () => {
    prices.close()
    await registry.dispose()
  })
  const recorder = new ProviderUsageRecorder(server.database.db, registry, prices)
  const sessionId = v.parse(sessionIdSchema, crypto.randomUUID())
  const record = (turn: string, model = 'fixture-model', cached = 500_000) =>
    recorder.accept(
      {
        type: 'usage.totals',
        eventId: `usage-${turn}`,
        createdAt: new Date().toISOString(),
        runtimeEpoch: 'fixture-epoch',
        providerInstanceId: instance,
        sessionId,
        turnId: v.parse(turnIdSchema, turn),
        payload: {
          totals: [
            {
              model,
              scope: turn,
              continuesEarlierTurns: false,
              inputTokens: 1_000_000,
              outputTokens: 100_000,
              cacheReadTokens: cached,
              cacheWriteTokens: 0,
              reasoningTokens: 50_000,
              costUsd: null,
            },
          ],
        },
      },
      'turn',
    )
  record('known')
  return { record }
}
