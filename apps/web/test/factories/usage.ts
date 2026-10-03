import { onTestFinished } from 'vitest'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type ProviderUsageWindow,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  MockProviderAdapter,
  ProviderAdapterRegistry,
  ProviderPriceCatalog,
  ProviderUsageRecorder,
} from 'server/testing'
import type { TestServer } from '../server'

/** Real catalog-priced utility generations exercise the owner's retained Fregat history. */
export async function recordUtilityUsageFixture(
  server: TestServer,
  inputRate: number,
  recordedAt = new Date().toISOString(),
) {
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
        eventId: `usage-${sessionId}-${turn}`,
        createdAt: recordedAt,
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
      'title',
    )
  record('known')
  return { record }
}

/** External adapter boundary with observable usage reads and passive quota updates. */
export class UsageObservationFixtureAdapter extends MockProviderAdapter {
  constructor() {
    super({
      driverKind: v.parse(providerDriverKindSchema, 'mock'),
      providerInstanceId: v.parse(providerInstanceIdSchema, 'usage-observation-fixture'),
    })
  }

  usageReads = 0
  async readUsage() {
    this.usageReads += 1
    return { kind: 'reading' as const, update: { planType: 'pro', windows: [] } }
  }

  usageObservation(observedAt: string): import('server/testing').ProviderRuntimeEvent {
    const now = observedAt
    return {
      type: 'account.rate-limits.updated',
      createdAt: now,
      eventId: 'idle-quota-fixture',
      runtimeEpoch: 'usage-fixture',
      providerInstanceId: this.adapterKey,
      sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000042'),
      payload: {
        planType: 'pro',
        windows: [
          {
            id: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            usedPercent: 42,
            resetsAt: null,
            windowMinutes: 10080,
            status: 'allowed',
          },
        ],
      },
    }
  }
}

export class ResetCreditFixtureAdapter extends MockProviderAdapter {
  readonly keys: string[] = []
  async consumeResetCredit(input: { idempotencyKey: string }) {
    this.keys.push(input.idempotencyKey)
    return 'reset' as const
  }
  async readUsage() {
    const window: ProviderUsageWindow = {
      id: 'primary',
      kind: 'session',
      label: 'Session',
      usedPercent: this.keys.length ? 0 : 100,
      resetsAt: new Date(Date.now() + 60_000).toISOString(),
      windowMinutes: 5,
      status: 'allowed',
    }
    return {
      kind: 'reading' as const,
      update: { planType: 'pro', windows: [window] },
      resetCredits: {
        available: this.keys.length ? 0 : 1,
        accountKey: `fixture-account-${this.adapterKey}`,
        creditId: `fixture-credit-${this.adapterKey}`,
      },
    }
  }
}
