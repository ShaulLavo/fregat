import type {
  ModelPrice,
  ModelPrices,
  ProviderUsageCostSource,
  ProviderUsageDayRow,
  ProviderUsageHistory,
  ProviderUsageHistoryQuery,
  ProviderUsageModelRow,
  ProviderUsagePurpose,
  ProviderUsagePurposeRow,
} from '@workspace/contracts'
import { usageTokenCount } from '@workspace/contracts'
import { gte, sql } from 'drizzle-orm'
import type { PlatformDatabase } from '../db/client'
import { providerUsageTurns as turns } from '../db/schema'

const DAY_MS = 24 * 60 * 60_000
const COST_SOURCE_RANK: Record<ProviderUsageCostSource, number> = { provider: 0, price: 1, none: 2 }

type UsageGroup = {
  day: string
  model: string
  driverKind: string
  purpose: ProviderUsagePurpose
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  costUsd: number | null
  costSource: ProviderUsageCostSource
}

/**
 * The usage page's one read. A Codex row carries no cost, so it is priced here from the
 * user's per-model price: a corrected price corrects history, and no price means the
 * cost is unknown rather than zero.
 */
export class ProviderUsageHistoryReader {
  private readonly database: PlatformDatabase
  private readonly prices: () => ModelPrices
  private readonly now: () => number

  constructor(
    database: PlatformDatabase,
    prices: () => ModelPrices,
    options: { now?: () => number } = {},
  ) {
    this.database = database
    this.prices = prices
    this.now = options.now ?? Date.now
  }

  read(query: ProviderUsageHistoryQuery): ProviderUsageHistory {
    const since = rangeStart(this.now(), query)
    const prices = this.prices()
    const groups = this.groups(query, since).map((group) => priced(group, prices))

    return {
      daily: dailyRows(groups),
      days: query.days,
      models: modelRows(groups),
      purposes: this.purposeRows(groups, since),
      since,
      totals: {
        costUsd: sumKnownCost(groups),
        tokens: sum(groups, usageTokenCount),
        turns: this.distinctTurns(since),
        unpricedTokens: sum(
          groups.filter((group) => group.costSource === 'none'),
          usageTokenCount,
        ),
      },
    }
  }

  /** One row per viewer-local day, model, purpose and whether the provider priced it. */
  private groups(query: ProviderUsageHistoryQuery, since: string) {
    const day = sql<string>`date(${turns.recordedAt}, ${offsetModifier(query.utcOffsetMinutes)})`
    const unpriced = sql<number>`${turns.costUsd} IS NULL`

    return this.database
      .select({
        cacheReadTokens: sql<number>`sum(${turns.cacheReadTokens})`,
        cacheWriteTokens: sql<number>`sum(${turns.cacheWriteTokens})`,
        costUsd: sql<number | null>`sum(${turns.costUsd})`,
        day,
        driverKind: turns.driverKind,
        inputTokens: sql<number>`sum(${turns.inputTokens})`,
        model: turns.model,
        outputTokens: sql<number>`sum(${turns.outputTokens})`,
        purpose: turns.purpose,
        reasoningTokens: sql<number>`sum(${turns.reasoningTokens})`,
        turns: sql<number>`count(*)`,
        unpriced,
      })
      .from(turns)
      .where(gte(turns.recordedAt, since))
      .groupBy(day, turns.model, turns.driverKind, turns.purpose, unpriced)
      .all()
  }

  /** A turn that used two models is one turn, so turns are counted apart from token rows. */
  private distinctTurns(since: string, purpose?: ProviderUsagePurpose) {
    const row = this.database
      .select({ turns: sql<number>`count(DISTINCT ${turns.sessionId} || ':' || ${turns.turnId})` })
      .from(turns)
      .where(
        purpose
          ? sql`${turns.recordedAt} >= ${since} AND ${turns.purpose} = ${purpose}`
          : gte(turns.recordedAt, since),
      )
      .get()

    return row?.turns ?? 0
  }

  private purposeRows(groups: readonly UsageGroup[], since: string): ProviderUsagePurposeRow[] {
    const byPurpose = new Map<ProviderUsagePurpose, UsageGroup[]>()
    for (const group of groups) {
      const rows = byPurpose.get(group.purpose) ?? []
      rows.push(group)
      byPurpose.set(group.purpose, rows)
    }

    return [...byPurpose].map(([purpose, rows]) => ({
      costUsd: sumKnownCost(rows),
      purpose,
      tokens: sum(rows, usageTokenCount),
      turns: this.distinctTurns(since, purpose),
    }))
  }
}

/** Local midnight `days - 1` days ago, as a UTC instant the stored ISO stamps compare against. */
function rangeStart(nowMs: number, query: ProviderUsageHistoryQuery) {
  const offsetMs = query.utcOffsetMinutes * 60_000
  const localNow = nowMs + offsetMs
  const localMidnight = localNow - (((localNow % DAY_MS) + DAY_MS) % DAY_MS)

  return new Date(localMidnight - (query.days - 1) * DAY_MS - offsetMs).toISOString()
}

function offsetModifier(utcOffsetMinutes: number) {
  return `${utcOffsetMinutes >= 0 ? '+' : ''}${utcOffsetMinutes} minutes`
}

function priced(
  group: Omit<UsageGroup, 'costSource'> & { unpriced: number },
  prices: ModelPrices,
): UsageGroup {
  const { unpriced, ...rest } = group
  if (!unpriced) return { ...rest, costSource: 'provider' }

  const price = prices[group.model]
  if (!price) return { ...rest, costSource: 'none', costUsd: null }

  return { ...rest, costSource: 'price', costUsd: priceCost(group, price) }
}

// Cache writes are billed as input where a provider has no separate rate for them.
function priceCost(group: Omit<UsageGroup, 'costSource'>, price: ModelPrice) {
  const microDollars =
    (group.inputTokens + group.cacheWriteTokens) * price.input +
    group.cacheReadTokens * price.cachedInput +
    group.outputTokens * price.output

  return microDollars / 1_000_000
}

function modelRows(groups: readonly UsageGroup[]): ProviderUsageModelRow[] {
  const byModel = new Map<string, ProviderUsageModelRow>()
  for (const group of groups) {
    const key = `${group.driverKind}\0${group.model}`
    const row = byModel.get(key)
    byModel.set(key, row ? addModelGroup(row, group) : modelRow(group))
  }

  return [...byModel.values()].toSorted(
    (left, right) =>
      (right.costUsd ?? 0) - (left.costUsd ?? 0) || usageTokenCount(right) - usageTokenCount(left),
  )
}

function modelRow(group: UsageGroup): ProviderUsageModelRow {
  return {
    cacheReadTokens: group.cacheReadTokens,
    cacheWriteTokens: group.cacheWriteTokens,
    costSource: group.costSource,
    costUsd: group.costUsd,
    driverKind: group.driverKind,
    inputTokens: group.inputTokens,
    model: group.model,
    outputTokens: group.outputTokens,
    reasoningTokens: group.reasoningTokens,
    turns: group.turns,
  }
}

/** The weakest source wins, so a model with any unpriced usage says its cost is incomplete. */
function addModelGroup(row: ProviderUsageModelRow, group: UsageGroup): ProviderUsageModelRow {
  const costSource =
    COST_SOURCE_RANK[group.costSource] > COST_SOURCE_RANK[row.costSource]
      ? group.costSource
      : row.costSource

  return {
    ...row,
    cacheReadTokens: row.cacheReadTokens + group.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens + group.cacheWriteTokens,
    costSource,
    costUsd: addCost(row.costUsd, group.costUsd),
    inputTokens: row.inputTokens + group.inputTokens,
    outputTokens: row.outputTokens + group.outputTokens,
    reasoningTokens: row.reasoningTokens + group.reasoningTokens,
    turns: row.turns + group.turns,
  }
}

function dailyRows(groups: readonly UsageGroup[]): ProviderUsageDayRow[] {
  const byDay = new Map<string, ProviderUsageDayRow>()
  for (const group of groups) {
    const row = byDay.get(group.day) ?? { costUsd: 0, day: group.day, tokens: 0 }
    byDay.set(group.day, {
      ...row,
      costUsd: row.costUsd + (group.costUsd ?? 0),
      tokens: row.tokens + usageTokenCount(group),
    })
  }

  return [...byDay.values()].toSorted((left, right) => left.day.localeCompare(right.day))
}

function addCost(left: number | null, right: number | null) {
  if (left === null) return right
  if (right === null) return left

  return left + right
}

function sumKnownCost(groups: readonly UsageGroup[]) {
  return groups.reduce((total, group) => total + (group.costUsd ?? 0), 0)
}

function sum<Row>(rows: readonly Row[], value: (row: Row) => number) {
  return rows.reduce((total, row) => total + value(row), 0)
}
