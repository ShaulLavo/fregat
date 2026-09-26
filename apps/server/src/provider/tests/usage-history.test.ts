import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { ProviderUsagePurpose } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { initializePlatformDatabase } from '../../db/initialize'
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
    const fixture = historyFixture()
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

  it('reads recorded provider and catalog costs, and flags unknown costs', () => {
    const fixture = historyFixture()
    fixture.insert({ costUsd: 0.42, model: 'claude-opus-5-5', turnId: 'claude' })
    fixture.insert({
      cacheReadTokens: 1_000_000,
      costUsd: 3.5,
      priceSnapshot: {
        provider: 'openai',
        model: 'gpt-5.5',
        fetchedAt: '2026-09-25T00:00:00.000Z',
        input: 2,
        output: 10,
        cacheRead: 0.5,
        cacheWrite: null,
      },
      driverKind: 'codex',
      inputTokens: 1_000_000,
      model: 'gpt-5.5',
      outputTokens: 100_000,
      turnId: 'codex',
    })
    fixture.insert({ costUsd: null, driverKind: 'codex', model: 'gpt-mystery', turnId: 'mystery' })

    const history = fixture.read(30)

    expect(history.models).toEqual([
      expect.objectContaining({ costSource: 'catalog', costUsd: 3.5, model: 'gpt-5.5' }),
      expect.objectContaining({ costSource: 'provider', costUsd: 0.42, model: 'claude-opus-5-5' }),
      expect.objectContaining({ costSource: 'none', costUsd: null, model: 'gpt-mystery' }),
    ])
    expect(history.totals.costUsd).toBeCloseTo(3.92)
    expect(history.totals.unpricedTokens).toBe(150)
  })

  it('carries one set of recorded rates per model and splits each day by model', () => {
    const fixture = historyFixture()
    const price = (input: number) => ({
      cacheRead: 0.5,
      cacheWrite: null,
      fetchedAt: '2026-09-25T00:00:00.000Z',
      input,
      model: 'gpt-5.5',
      output: 10,
      provider: 'openai',
    })
    fixture.insert({
      costUsd: 1,
      driverKind: 'codex',
      model: 'gpt-5.5',
      priceSnapshot: price(2),
      turnId: 'a',
    })
    fixture.insert({
      costUsd: 1,
      driverKind: 'codex',
      model: 'gpt-5.5',
      priceSnapshot: price(2),
      turnId: 'b',
    })
    fixture.insert({
      costUsd: 1,
      driverKind: 'codex',
      model: 'gpt-4',
      priceSnapshot: price(2),
      turnId: 'c',
    })
    fixture.insert({
      costUsd: 1,
      driverKind: 'codex',
      model: 'gpt-4',
      priceSnapshot: price(3),
      turnId: 'd',
    })
    fixture.insert({ costUsd: null, driverKind: 'codex', model: 'gpt-mystery', turnId: 'e' })

    const history = fixture.read(7)

    expect(history.models.find((row) => row.model === 'gpt-5.5')?.rates).toEqual({
      cacheRead: 0.5,
      cacheWrite: null,
      input: 2,
      output: 10,
    })
    expect(history.models.find((row) => row.model === 'gpt-4')?.rates).toBeNull()
    expect(history.daily).toEqual([
      expect.objectContaining({
        models: expect.arrayContaining([
          expect.objectContaining({ model: 'gpt-mystery', costUsd: null, tokens: 150 }),
          expect.objectContaining({ model: 'gpt-5.5', costUsd: 2, tokens: 300 }),
        ]),
        unpricedTokens: 150,
      }),
    ])
  })

  it("totals one session's priced turns and names its unpriced tokens apart", () => {
    const fixture = historyFixture()
    fixture.insert({ costUsd: 0.3, model: 'claude-opus-5-5', turnId: 'chat' })
    fixture.insert({ costUsd: 0.1, model: 'claude-haiku-4-5', turnId: 'chat' })
    fixture.insert({ costUsd: null, model: 'gpt-mystery', turnId: 'second' })
    fixture.insert({ costUsd: 9, sessionId: 'other', turnId: 'elsewhere' })

    const total = fixture.readSession('session-1')

    expect(total).toMatchObject({ tokens: 450, turns: 2, unpricedTokens: 150 })
    expect(total.costUsd).toBeCloseTo(0.4)
    expect(fixture.readSession('empty')).toEqual({
      costUsd: null,
      tokens: 0,
      turns: 0,
      unpricedTokens: 0,
    })
  })

  it('splits spend by purpose and counts a two-model turn once', () => {
    const fixture = historyFixture()
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
  priceSnapshot?: typeof schema.providerUsageTurns.$inferInsert.priceSnapshot
  cacheReadTokens?: number
  costUsd?: number | null
  driverKind?: string
  inputTokens?: number
  model?: string
  outputTokens?: number
  purpose?: ProviderUsagePurpose
  recordedAt?: string
  sessionId?: string
  turnId: string
}

function historyFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  initializePlatformDatabase(database)
  closers.push(() => sqlite.close())
  const reader = new ProviderUsageHistoryReader(database, { now: () => NOW })

  return {
    insert: (row: TurnRow) =>
      database
        .insert(schema.providerUsageTurns)
        .values({
          accountKey: null,
          priceSnapshot: row.priceSnapshot,
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
          sessionId: row.sessionId ?? 'session-1',
          turnId: row.turnId,
        })
        .run(),
    read: (days: 7 | 30 | 90) => reader.read({ days, utcOffsetMinutes: UTC_PLUS_3 }),
    readSession: (sessionId: string) => reader.readSession(sessionId),
  }
}
