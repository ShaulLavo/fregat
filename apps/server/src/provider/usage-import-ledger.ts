import { and, eq } from 'drizzle-orm'
import type { PlatformDatabase } from '../db/client'
import { providerUsageImportRequests as requests } from '../db/schema'
import type { ProviderImportedUsage } from './types'
import type { ProviderUsageAmounts } from './utils/usage-totals'

type ImportOwner = {
  accountKey: string | null
  driverKind: string
  providerInstanceId: string
  sessionId: string
}

export type ImportedUsageTurn = Omit<ProviderImportedUsage, 'billingKey'>
type RequestRow = typeof requests.$inferSelect

/** Native request IDs survive CLI forks. The first import owns each bill permanently. */
export function recordImportedUsage(
  database: PlatformDatabase,
  owner: ImportOwner,
  usage: readonly ProviderImportedUsage[],
) {
  const billingScope = JSON.stringify([
    owner.driverKind,
    owner.accountKey ?? { instance: owner.providerInstanceId },
  ])
  const changed = new Map<string, RequestRow>()
  for (const request of usage) {
    const row = recordRequest(database, owner, billingScope, request)
    changed.set(JSON.stringify([row.sessionId, row.turnId, row.model]), row)
  }
  return [...changed.values()].map((row) => ({
    owner: { ...owner, sessionId: row.sessionId, providerInstanceId: row.providerInstanceId },
    turn: importedTurn(database, row),
  }))
}

function recordRequest(
  database: PlatformDatabase,
  owner: ImportOwner,
  billingScope: string,
  request: ProviderImportedUsage,
) {
  const { billingKey, model, turnKey, recordedAt, ...amounts } = request
  const previous = database
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.billingScope, billingScope),
        eq(requests.billingKey, billingKey),
        eq(requests.model, model),
      ),
    )
    .get()
  const row: RequestRow = {
    billingScope,
    billingKey,
    model,
    amounts,
    sessionId: owner.sessionId,
    providerInstanceId: owner.providerInstanceId,
    turnId: turnKey,
    recordedAt,
    ...previous,
  }
  row.amounts = maximumAmounts(amounts, previous?.amounts)
  if (recordedAt > row.recordedAt) row.recordedAt = recordedAt
  database
    .insert(requests)
    .values(row)
    .onConflictDoUpdate({
      target: [requests.billingScope, requests.billingKey, requests.model],
      set: { amounts: row.amounts, recordedAt: row.recordedAt },
    })
    .run()
  return row
}

function maximumAmounts(
  current: ProviderUsageAmounts,
  previous?: ProviderUsageAmounts,
): ProviderUsageAmounts {
  if (!previous) return current
  return {
    inputTokens: Math.max(current.inputTokens, previous.inputTokens),
    outputTokens: Math.max(current.outputTokens, previous.outputTokens),
    cacheReadTokens: Math.max(current.cacheReadTokens, previous.cacheReadTokens),
    cacheWriteTokens: Math.max(current.cacheWriteTokens, previous.cacheWriteTokens),
    reasoningTokens: Math.max(current.reasoningTokens, previous.reasoningTokens),
    costUsd: current.costUsd,
  }
}

function importedTurn(database: PlatformDatabase, owner: RequestRow): ImportedUsageTurn {
  const rows = database
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.sessionId, owner.sessionId),
        eq(requests.turnId, owner.turnId),
        eq(requests.model, owner.model),
      ),
    )
    .all()
  const turn: ImportedUsageTurn = {
    turnKey: owner.turnId,
    model: owner.model,
    recordedAt: owner.recordedAt,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
  }
  for (const row of rows) {
    turn.inputTokens += row.amounts.inputTokens
    turn.outputTokens += row.amounts.outputTokens
    turn.cacheReadTokens += row.amounts.cacheReadTokens
    turn.cacheWriteTokens += row.amounts.cacheWriteTokens
    turn.reasoningTokens += row.amounts.reasoningTokens
    if (row.recordedAt > turn.recordedAt) turn.recordedAt = row.recordedAt
  }
  return turn
}
