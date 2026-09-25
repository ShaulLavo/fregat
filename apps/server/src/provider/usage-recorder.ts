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
import type { ProviderPriceCatalog } from './price-catalog'
import {
  contributionCost,
  needsUsagePrice,
  updateUsageContributions,
} from './utils/usage-contributions'
import type { ProviderImportedUsage, ProviderRuntimeEvent } from './types'
import { recordImportedUsage, type ImportedUsageTurn } from './usage-import-ledger'
import {
  isEmptyUsage,
  usageDelta,
  usageAmounts,
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
  private readonly prices: Pick<ProviderPriceCatalog, 'lookup'>

  constructor(
    database: PlatformDatabase,
    accounts: Pick<ProviderAdapterRegistry, 'usageAccount'>,
    prices: Pick<ProviderPriceCatalog, 'lookup'>,
  ) {
    this.database = database
    this.accounts = accounts
    this.prices = prices
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

  /**
   * Turns read back from a transcript. A re-read replaces the rows it wrote before,
   * and never a live row: once a session continues here the recorder owns it.
   */
  importTurns(
    input: { providerInstanceId: ProviderInstanceId; sessionId: string },
    usage: readonly ProviderImportedUsage[],
  ) {
    if (usage.length === 0) return
    const account = this.accounts.usageAccount(input.providerInstanceId)
    const base = {
      accountKey: account?.accountKey ?? null,
      driverKind: account?.driverKind ?? 'unknown',
      providerInstanceId: input.providerInstanceId,
      sessionId: input.sessionId,
    }
    try {
      this.database.transaction(() => {
        for (const { owner, turn } of recordImportedUsage(this.database, base, usage))
          this.importTurn(owner, turn)
      })
      recordChatPipelineInfo('chat.pipeline.provider_usage.imported', {
        models: [...new Set(usage.map((turn) => turn.model))],
        providerInstanceId: input.providerInstanceId,
        rows: usage.length,
        sessionId: input.sessionId,
        tokens: usage.reduce((sum, turn) => sum + turn.inputTokens + turn.outputTokens, 0),
      })
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_usage.import_failed', {
        error,
        providerInstanceId: input.providerInstanceId,
        sessionId: input.sessionId,
      })
    }
  }

  private importTurn(
    base: Pick<RecordedTurn, 'accountKey' | 'driverKind' | 'providerInstanceId' | 'sessionId'>,
    turn: ImportedUsageTurn,
  ) {
    const { model, recordedAt, turnKey, ...amounts } = turn
    const contributions = [{ after: amounts, before: null, scope: 'import' }]
    const priceSnapshot = this.prices.lookup(base.driverKind, model)
    const costUsd = contributionCost(contributions, priceSnapshot)
    this.database
      .insert(providerUsageTurns)
      .values({
        ...base,
        ...amounts,
        contributions,
        costUsd,
        model,
        priceSnapshot,
        purpose: 'turn',
        recordedAt,
        source: 'import',
        turnId: `import:${turnKey}`,
      })
      .onConflictDoUpdate({
        set: {
          cacheReadTokens: sql`excluded.cache_read_tokens`,
          cacheWriteTokens: sql`excluded.cache_write_tokens`,
          contributions: sql`excluded.contributions_json`,
          costUsd: sql`excluded.cost_usd`,
          inputTokens: sql`excluded.input_tokens`,
          outputTokens: sql`excluded.output_tokens`,
          priceSnapshot: sql`excluded.price_snapshot`,
          reasoningTokens: sql`excluded.reasoning_tokens`,
          recordedAt: sql`excluded.recorded_at`,
        },
        setWhere: eq(providerUsageTurns.source, 'import'),
        target: [providerUsageTurns.sessionId, providerUsageTurns.turnId, providerUsageTurns.model],
      })
      .run()
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
    if (!delta && baseline) return []
    this.database
      .insert(providerUsageBaselines)
      .values({
        model: totals.model,
        scope: totals.scope,
        sessionId: turn.sessionId,
        totalsJson: JSON.stringify(usageAmounts(totals)),
      })
      .onConflictDoUpdate({
        set: { totalsJson: JSON.stringify(usageAmounts(totals)) },
        target: [
          providerUsageBaselines.sessionId,
          providerUsageBaselines.scope,
          providerUsageBaselines.model,
        ],
      })
      .run()
    if (!delta) return []

    const costUsd = this.addToTurn(turn, totals, baseline, delta)
    return [{ ...delta, costUsd, model: totals.model }]
  }

  /** Tokens add once; a late provider cost replaces only its own contribution. */
  private addToTurn(
    turn: RecordedTurn,
    totals: ProviderUsageTotals,
    baseline: ProviderUsageAmounts | null,
    delta: ProviderUsageAmounts,
  ) {
    const { model } = totals
    const existing = this.database
      .select()
      .from(providerUsageTurns)
      .where(
        and(
          eq(providerUsageTurns.sessionId, turn.sessionId),
          eq(providerUsageTurns.turnId, turn.turnId),
          eq(providerUsageTurns.model, model),
        ),
      )
      .get()
    const previous = existing?.contributions ?? []
    const contributions = updateUsageContributions(previous, totals, baseline)
    let priceSnapshot = existing?.priceSnapshot ?? null
    if (!needsUsagePrice(contributions)) priceSnapshot = null
    if (needsUsagePrice(contributions) && !priceSnapshot && !needsUsagePrice(previous)) {
      priceSnapshot = this.prices.lookup(turn.driverKind, model)
    }
    const costUsd = contributionCost(contributions, priceSnapshot)
    this.database
      .insert(providerUsageTurns)
      .values({
        ...turn,
        ...delta,
        model,
        costUsd,
        priceSnapshot,
        contributions,
      })
      .onConflictDoUpdate({
        set: {
          cacheReadTokens: sql`${providerUsageTurns.cacheReadTokens} + excluded.cache_read_tokens`,
          cacheWriteTokens: sql`${providerUsageTurns.cacheWriteTokens} + excluded.cache_write_tokens`,
          costUsd: sql`excluded.cost_usd`,
          priceSnapshot: sql`excluded.price_snapshot`,
          contributions: sql`excluded.contributions_json`,
          inputTokens: sql`${providerUsageTurns.inputTokens} + excluded.input_tokens`,
          outputTokens: sql`${providerUsageTurns.outputTokens} + excluded.output_tokens`,
          reasoningTokens: sql`${providerUsageTurns.reasoningTokens} + excluded.reasoning_tokens`,
          recordedAt: sql`excluded.recorded_at`,
        },
        target: [providerUsageTurns.sessionId, providerUsageTurns.turnId, providerUsageTurns.model],
      })
      .run()
    return costUsd === null ? null : costUsd - (existing?.costUsd ?? 0)
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
