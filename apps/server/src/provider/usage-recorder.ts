import type { ProviderUsagePurpose } from '@workspace/contracts'
import type { ProviderInstanceId } from '@workspace/contracts'
import { and, eq, sql } from 'drizzle-orm'
import * as v from 'valibot'
import type { PlatformDatabase } from '../db/client'
import { providerUsageBaselines, providerUsageTurns } from '../db/schema'
import {
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../orchestration/orchestration-logging'
import type { ProviderAdapterRegistry } from './provider-adapter-registry'
import type { ProviderRuntimeEvent } from './types'
import {
  isEmptyUsage,
  usageDelta,
  type ProviderUsageAmounts,
  type ProviderUsageTotals,
} from './utils/usage-totals'

const amountsSchema = v.object({
  cacheReadTokens: v.number(),
  cacheWriteTokens: v.number(),
  costUsd: v.nullable(v.number()),
  inputTokens: v.number(),
  outputTokens: v.number(),
  reasoningTokens: v.number(),
})

type UsageTotalsEvent = Extract<ProviderRuntimeEvent, { type: 'usage.totals' }>

type RecordedTurn = {
  accountKey: string | null
  driverKind: string
  providerInstanceId: string
  purpose: ProviderUsagePurpose
  recordedAt: string
  sessionId: string
  turnId: string
}

/**
 * Turns the running totals adapters emit at the end of a turn into per-turn rows.
 * The baseline is persisted, so a resumed conversation whose first totals already
 * include earlier turns records only what the new turn added.
 */
export class ProviderUsageRecorder {
  private readonly database: PlatformDatabase
  private readonly accounts: Pick<ProviderAdapterRegistry, 'usageAccount'>

  constructor(database: PlatformDatabase, accounts: Pick<ProviderAdapterRegistry, 'usageAccount'>) {
    this.database = database
    this.accounts = accounts
  }

  accept(event: UsageTotalsEvent, purpose: ProviderUsagePurpose) {
    if (!event.turnId || !event.providerInstanceId) return

    try {
      const recorded = this.record(event, event.turnId, event.providerInstanceId, purpose)
      recordChatPipelineInfo('chat.pipeline.provider_usage.recorded', {
        costUsd: recorded.reduce((sum, delta) => sum + (delta.costUsd ?? 0), 0),
        models: recorded.map((delta) => delta.model),
        providerInstanceId: event.providerInstanceId,
        purpose,
        sessionId: event.sessionId,
        tokens: recorded.reduce((sum, delta) => sum + delta.inputTokens + delta.outputTokens, 0),
        turnId: event.turnId,
      })
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_usage.record_failed', {
        error,
        providerInstanceId: event.providerInstanceId,
        sessionId: event.sessionId,
        turnId: event.turnId,
      })
    }
  }

  private record(
    event: UsageTotalsEvent,
    turnId: string,
    providerInstanceId: ProviderInstanceId,
    purpose: ProviderUsagePurpose,
  ) {
    const account = this.accounts.usageAccount(providerInstanceId)
    const turn: RecordedTurn = {
      accountKey: account?.accountKey ?? null,
      driverKind: account?.driverKind ?? event.provider ?? 'unknown',
      providerInstanceId,
      purpose,
      recordedAt: event.createdAt,
      sessionId: event.sessionId,
      turnId,
    }

    return this.database.transaction(() =>
      event.payload.totals.flatMap((totals) => this.recordTotals(turn, totals)),
    )
  }

  private recordTotals(turn: RecordedTurn, totals: ProviderUsageTotals) {
    if (isEmptyUsage(totals)) return []

    const key = and(
      eq(providerUsageBaselines.sessionId, turn.sessionId),
      eq(providerUsageBaselines.scope, totals.scope),
      eq(providerUsageBaselines.model, totals.model),
    )
    const stored = this.database.select().from(providerUsageBaselines).where(key).get()
    const baseline = stored ? parseAmounts(stored.totalsJson) : null
    // Unknown history: seed the baseline and let the next turn count, rather than
    // record a whole resumed conversation as one turn.
    const delta = !baseline && totals.continuesEarlierTurns ? null : usageDelta(totals, baseline)
    this.database
      .insert(providerUsageBaselines)
      .values({
        model: totals.model,
        scope: totals.scope,
        sessionId: turn.sessionId,
        totalsJson: JSON.stringify(amounts(totals)),
      })
      .onConflictDoUpdate({
        set: { totalsJson: JSON.stringify(amounts(totals)) },
        target: [
          providerUsageBaselines.sessionId,
          providerUsageBaselines.scope,
          providerUsageBaselines.model,
        ],
      })
      .run()
    if (!delta) return []

    this.addToTurn(turn, totals.model, delta)
    return [{ ...delta, model: totals.model }]
  }

  /** A turn that ends twice (a retried completion) adds, never overwrites. */
  private addToTurn(turn: RecordedTurn, model: string, delta: ProviderUsageAmounts) {
    const cost = providerUsageTurns.costUsd
    this.database
      .insert(providerUsageTurns)
      .values({ ...turn, ...delta, model })
      .onConflictDoUpdate({
        set: {
          cacheReadTokens: sql`${providerUsageTurns.cacheReadTokens} + excluded.cache_read_tokens`,
          cacheWriteTokens: sql`${providerUsageTurns.cacheWriteTokens} + excluded.cache_write_tokens`,
          costUsd: sql`CASE WHEN ${cost} IS NULL AND excluded.cost_usd IS NULL THEN NULL ELSE COALESCE(${cost}, 0) + COALESCE(excluded.cost_usd, 0) END`,
          inputTokens: sql`${providerUsageTurns.inputTokens} + excluded.input_tokens`,
          outputTokens: sql`${providerUsageTurns.outputTokens} + excluded.output_tokens`,
          reasoningTokens: sql`${providerUsageTurns.reasoningTokens} + excluded.reasoning_tokens`,
          recordedAt: sql`excluded.recorded_at`,
        },
        target: [providerUsageTurns.sessionId, providerUsageTurns.turnId, providerUsageTurns.model],
      })
      .run()
  }
}

function amounts(totals: ProviderUsageTotals): ProviderUsageAmounts {
  return {
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    costUsd: totals.costUsd,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
  }
}

/** A baseline this build cannot read is treated as absent. */
function parseAmounts(json: string): ProviderUsageAmounts | null {
  try {
    const parsed = v.safeParse(amountsSchema, JSON.parse(json))
    return parsed.success ? parsed.output : null
  } catch {
    return null
  }
}
