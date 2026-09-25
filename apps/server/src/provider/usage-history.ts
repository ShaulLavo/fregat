import type {
  ProviderUsageCostSource,
  ProviderUsageDayRow,
  ProviderUsageHistory,
  ProviderUsageHistoryQuery,
  ProviderUsageModelRow,
  ProviderUsagePurpose,
  ProviderUsagePurposeRow,
  ProviderUsageSessionTotal,
} from '@workspace/contracts'
import { usageTokenCount } from '@workspace/contracts'
import { eq, gte, sql } from 'drizzle-orm'
import type { PlatformDatabase } from '../db/client'
import { providerUsageTurns as turns } from '../db/schema'

const DAY_MS = 24 * 60 * 60_000
const COST_SOURCE_RANK: Record<ProviderUsageCostSource, number> = {
  provider: 0,
  catalog: 1,
  none: 2,
}

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

/** Aggregates recorded costs without repricing history from the current catalog. */
export class ProviderUsageHistoryReader {
  private readonly database: PlatformDatabase
  private readonly now: () => number

  constructor(database: PlatformDatabase, options: { now?: () => number } = {}) {
    this.database = database
    this.now = options.now ?? Date.now
  }

  read(query: ProviderUsageHistoryQuery): ProviderUsageHistory {
    const since = rangeStart(this.now(), query)
    const groups = this.groups(query, since)

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

  /** Everything recorded for one session, every purpose included. */
  readSession(sessionId: string): ProviderUsageSessionTotal {
    const row = this.database
      .select({
        cacheReadTokens: sql<number>`coalesce(sum(${turns.cacheReadTokens}), 0)`,
        cacheWriteTokens: sql<number>`coalesce(sum(${turns.cacheWriteTokens}), 0)`,
        costUsd: sql<number | null>`sum(${turns.costUsd})`,
        inputTokens: sql<number>`coalesce(sum(${turns.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${turns.outputTokens}), 0)`,
        turns: sql<number>`count(DISTINCT ${turns.turnId})`,
        unpricedTokens: sql<number>`coalesce(sum(CASE WHEN ${turns.costUsd} IS NULL THEN ${turns.inputTokens} + ${turns.outputTokens} + ${turns.cacheReadTokens} + ${turns.cacheWriteTokens} ELSE 0 END), 0)`,
      })
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .get()

    return {
      costUsd: row?.costUsd ?? null,
      tokens: row ? usageTokenCount(row) : 0,
      turns: row?.turns ?? 0,
      unpricedTokens: row?.unpricedTokens ?? 0,
    }
  }

  /** One row per viewer-local day, model, purpose and whether the provider priced it. */
  private groups(query: ProviderUsageHistoryQuery, since: string) {
    const day = sql<string>`date(${turns.recordedAt}, ${offsetModifier(query.utcOffsetMinutes)})`
    const costSource = sql<ProviderUsageCostSource>`CASE WHEN ${turns.costUsd} IS NULL THEN 'none' WHEN ${turns.priceSnapshot} IS NULL THEN 'provider' ELSE 'catalog' END`

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
        costSource,
      })
      .from(turns)
      .where(gte(turns.recordedAt, since))
      .groupBy(day, turns.model, turns.driverKind, turns.purpose, costSource)
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
    const row = byDay.get(group.day) ?? { costUsd: null, day: group.day, tokens: 0 }
    byDay.set(group.day, {
      ...row,
      costUsd: addCost(row.costUsd, group.costUsd),
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
  if (groups.length > 0 && groups.every((group) => group.costUsd === null)) return null
  return groups.reduce((total, group) => total + (group.costUsd ?? 0), 0)
}

function sum<Row>(rows: readonly Row[], value: (row: Row) => number) {
  return rows.reduce((total, row) => total + value(row), 0)
}
