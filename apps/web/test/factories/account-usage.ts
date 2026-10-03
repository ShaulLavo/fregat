import { providerDriverKindSchema, providerInstanceIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

/** Synthetic native observation and a configured unseen peer in one mapped group. */
export function accountUsageFixture(nowMs: number) {
  const instance = v.parse(providerInstanceIdSchema, 'usage-group-fixture')
  const at = (minutes: number) => new Date(nowMs + minutes * 60_000).toISOString()
  return {
    accounts: [
      {
        accountKey: 'first',
        driverKind: v.parse(providerDriverKindSchema, 'codex'),
        providerInstanceIds: [instance],
        planType: 'pro',
        checkedAt: at(-2),
        source: 'cli-proxy-management',
        routing: { mode: 'rotating', active: null, lastServedAt: null },
        credits: { balance: 2.5, unlimited: false },
        resetCredits: { available: 1, accountKey: 'first', creditId: null },
        windows: [
          {
            id: 'primary',
            kind: 'weekly',
            label: 'Weekly',
            usedPercent: 81,
            resetsAt: at(-1),
            windowMinutes: 10080,
            status: null,
            observedAt: at(-120),
            source: 'proxy-state',
            freshness: 'reset-passed',
          },
        ],
      },
      {
        accountKey: 'second',
        driverKind: v.parse(providerDriverKindSchema, 'codex'),
        providerInstanceIds: [instance],
        planType: null,
        checkedAt: null,
        windows: [],
        source: 'cli-proxy-management',
        state: 'no-data',
      },
    ],
  } satisfies import('@workspace/contracts').ProviderUsageResult
}
