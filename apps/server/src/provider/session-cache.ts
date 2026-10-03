import {
  SESSION_CACHE_TURN_LIMIT,
  type ProviderReportedCache,
  type ProviderSessionCache,
} from '@workspace/contracts'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PlatformDatabase } from '../db/client'
import { projectionTurns, providerUsageTurns as turns } from '../db/schema'
import { reportedCacheDelta } from './utils/usage-totals'

/** Reads diagnostic snapshots only; accounting totals and retained owner records stay intact. */
export function readSessionCache(
  database: PlatformDatabase,
  sessionId: string,
): ProviderSessionCache {
  const recent = database
    .select({ turnId: turns.turnId, recordedAt: sql<string>`max(${turns.recordedAt})` })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.purpose, 'turn')))
    .groupBy(turns.turnId)
    .orderBy(desc(sql`max(${turns.recordedAt})`), desc(turns.turnId))
    .limit(SESSION_CACHE_TURN_LIMIT)
    .all()
  if (recent.length === 0)
    return { turns: [], readTokens: null, writeTokens: null, writeShare: null }

  const rows = database
    .select({
      turnId: turns.turnId,
      model: turns.model,
      contributions: turns.contributions,
      requestedAt: projectionTurns.requestedAt,
      startedAt: projectionTurns.startedAt,
      completedAt: projectionTurns.completedAt,
    })
    .from(turns)
    .leftJoin(
      projectionTurns,
      and(eq(projectionTurns.sessionId, turns.sessionId), eq(projectionTurns.turnId, turns.turnId)),
    )
    .where(
      and(
        eq(turns.sessionId, sessionId),
        eq(turns.purpose, 'turn'),
        inArray(
          turns.turnId,
          recent.map((turn) => turn.turnId),
        ),
      ),
    )
    .all()
  const cacheTurns = recent.map((turn) => {
    const models = rows.filter((row) => row.turnId === turn.turnId)
    const counters = models.flatMap((row) =>
      row.contributions.length > 0
        ? row.contributions.map((entry) => reportedCacheDelta(entry.after, entry.before))
        : [{ readTokens: null, writeTokens: null }],
    )
    const cache = sumReportedCache(counters)
    return {
      ...turn,
      ...cache,
      models: models.map((row) => row.model).toSorted(),
      requestedAt: models[0]?.requestedAt ?? null,
      startedAt: models[0]?.startedAt ?? null,
      completedAt: models[0]?.completedAt ?? null,
      writeShare: cacheWriteShare(cache),
    }
  })
  const cache = sumReportedCache(cacheTurns)
  return { ...cache, turns: cacheTurns, writeShare: cacheWriteShare(cache) }
}

function sumReportedCache(counters: readonly ProviderReportedCache[]): ProviderReportedCache {
  return {
    readTokens: counters.some((item) => item.readTokens === null)
      ? null
      : counters.reduce((sum, item) => sum + (item.readTokens ?? 0), 0),
    writeTokens: counters.some((item) => item.writeTokens === null)
      ? null
      : counters.reduce((sum, item) => sum + (item.writeTokens ?? 0), 0),
  }
}

function cacheWriteShare(cache: ProviderReportedCache) {
  if (cache.readTokens === null || cache.writeTokens === null) return null
  const total = cache.readTokens + cache.writeTokens
  return total > 0 ? cache.writeTokens / total : null
}
