import { onTestFinished } from 'vitest'
import * as v from 'valibot'
import {
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type ProviderReportedCache,
} from '@workspace/contracts'
import {
  ProviderAdapterRegistry,
  ProviderPriceCatalog,
  ProviderUsageRecorder,
} from 'server/testing'
import type { TestServer } from '../server'
import { TEST_ENVIRONMENT_ID } from './chat'

export function recordSessionCacheFixture(
  server: TestServer,
  reportedCache: ProviderReportedCache,
) {
  const registry = new ProviderAdapterRegistry({
    adapters: [server.providerAdapter],
    services: { cwd: server.root },
  })
  const prices = new ProviderPriceCatalog(server.database.db, async () => Response.json({}))
  onTestFinished(() => prices.close())
  const sessionId = v.parse(sessionIdSchema, crypto.randomUUID())
  new ProviderUsageRecorder(server.database.db, registry, prices).accept(
    {
      type: 'usage.totals',
      eventId: 'session-cache-fixture',
      createdAt: '2026-09-25T06:00:00.000Z',
      runtimeEpoch: 'fixture-epoch',
      providerInstanceId: v.parse(providerInstanceIdSchema, 'mock'),
      sessionId,
      turnId: v.parse(turnIdSchema, 'cache-turn'),
      payload: {
        totals: [
          {
            model: 'fixture-model',
            scope: 'fixture-scope',
            continuesEarlierTurns: false,
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            costUsd: 0,
            reportedCache,
          },
        ],
      },
    },
    'turn',
  )
  return { environmentId: TEST_ENVIRONMENT_ID, sessionId }
}
