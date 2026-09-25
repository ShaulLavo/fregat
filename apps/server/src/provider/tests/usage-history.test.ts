import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { ModelPrices, ProviderUsagePurpose } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { migratePlatformDatabase } from '../../db/migrations'
import * as schema from '../../db/schema'
import { ProviderUsageHistoryReader } from '../usage-history'

// 2026-09-25 10:00 in UTC+3, the viewer's zone below.
const NOW = Date.parse('2026-09-25T07:00:00.000Z')
const UTC_PLUS_3 = 180
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('provider usage history', () => {
  it('groups by the viewer’s calendar day and starts the range at their midnight', () => {
    const fixture = historyFixture({})
    // 23:30 UTC on the 23rd is 02:30 on the 24th in UTC+3.
    fixture.insert({ recordedAt: '2026-09-23T23:30:00.000Z', turnId: 'late' })
    fixture.insert({ recordedAt: '2026-09-25T06:00:00.000Z', turnId: 'today' })
    // 20:59 UTC on the 18th is 23:59 on the 18th locally: one minute before a 7-day range.
    fixture.insert({ recordedAt: '2026-09-18T20:59:00.000Z', turnId: 'outside' })

    const history = fixture.read(7)

    expect(history.since).toBe('2026-09-18T21:00:00.000Z')
    expect(history.daily.map((row) => row.day)).toEqual(['2026-09-24', '2026-09-25'])
    expect(history.totals.turns).toBe(2)
  })

  it('keeps the provider’s cost, prices a model that has none, and flags one with no price', () => {
    const fixture = historyFixture({ 'gpt-5.5': { cachedInput: 0.5, input: 2, output: 10 } })
    fixture.insert({ costUsd: 0.42, model: 'claude-opus-5-5', turnId: 'claude' })
    fixture.insert({
      cacheReadTokens: 1_000_000,
      costUsd: null,
      driverKind: 'codex',
      inputTokens: 1_000_000,
      model: 'gpt-5.5',
      outputTokens: 100_000,
      turnId: 'codex',
    })
    fixture.insert({ costUsd: null, driverKind: 'codex', model: 'gpt-mystery', turnId: 'mystery' })

    const history = fixture.read(30)

    expect(history.models).toEqual([
      expect.objectContaining({ costSource: 'price', costUsd: 3.5, model: 'gpt-5.5' }),
      expect.objectContaining({ costSource: 'provider', costUsd: 0.42, model: 'claude-opus-5-5' }),
      expect.objectContaining({ costSource: 'none', costUsd: null, model: 'gpt-mystery' }),
    ])
    expect(history.totals.costUsd).toBeCloseTo(3.92)
    expect(history.totals.unpricedTokens).toBe(150)
  })

  it('splits spend by purpose and counts a two-model turn once', () => {
    const fixture = historyFixture({})
    fixture.insert({ costUsd: 0.3, model: 'claude-opus-5-5', turnId: 'chat' })
    fixture.insert({ costUsd: 0.1, model: 'claude-haiku-4-5', turnId: 'chat' })
    fixture.insert({ costUsd: 0.01, purpose: 'title', turnId: 'title' })

    const history = fixture.read(7)

    expect(history.totals.turns).toBe(2)
    expect(history.purposes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: 'turn', turns: 1 }),
        expect.objectContaining({ costUsd: 0.01, purpose: 'title', turns: 1 }),
      ]),
    )
    expect(history.purposes.find((row) => row.purpose === 'turn')?.costUsd).toBeCloseTo(0.4)
  })
})

type TurnRow = {
  cacheReadTokens?: number
  costUsd?: number | null
  driverKind?: string
  inputTokens?: number
  model?: string
  outputTokens?: number
  purpose?: ProviderUsagePurpose
  recordedAt?: string
  turnId: string
}

function historyFixture(prices: ModelPrices) {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migratePlatformDatabase(database)
  closers.push(() => sqlite.close())
  const reader = new ProviderUsageHistoryReader(database, () => prices, { now: () => NOW })

  return {
    insert: (row: TurnRow) =>
      database
        .insert(schema.providerUsageTurns)
        .values({
          accountKey: null,
          cacheReadTokens: row.cacheReadTokens ?? 0,
          cacheWriteTokens: 0,
          costUsd: row.costUsd === undefined ? 0 : row.costUsd,
          driverKind: row.driverKind ?? 'claude',
          inputTokens: row.inputTokens ?? 100,
          model: row.model ?? 'claude-opus-5-5',
          outputTokens: row.outputTokens ?? 50,
          providerInstanceId: row.driverKind ?? 'claude',
          purpose: row.purpose ?? 'turn',
          reasoningTokens: 0,
          recordedAt: row.recordedAt ?? '2026-09-25T06:00:00.000Z',
          sessionId: 'session-1',
          turnId: row.turnId,
        })
        .run(),
    read: (days: 7 | 30 | 90) => reader.read({ days, utcOffsetMinutes: UTC_PLUS_3 }),
  }
}
