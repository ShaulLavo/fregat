import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type ProviderInstanceId,
} from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, describe, expect, it } from 'vitest'
import { migratePlatformDatabase } from '../../db/migrations'
import * as schema from '../../db/schema'
import type { ProviderRuntimeEvent } from '../types'

type UsageTotalsEvent = Extract<ProviderRuntimeEvent, { type: 'usage.totals' }>
import { ProviderUsageRecorder } from '../usage-recorder'
import type { ProviderUsageTotals } from '../utils/usage-totals'

const INSTANCE = v.parse(providerInstanceIdSchema, 'claude')
const SESSION = v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('provider usage recorder', () => {
  it('records what each turn added to the running totals, with the provider cost', () => {
    const { recorder, rows } = recorderFixture()
    recorder.accept(totalsEvent('turn-1', [totals({ costUsd: 0.5, inputTokens: 100 })]), 'turn')
    recorder.accept(totalsEvent('turn-2', [totals({ costUsd: 0.75, inputTokens: 160 })]), 'turn')

    expect(rows()).toEqual([
      expect.objectContaining({
        accountKey: 'account-1',
        costUsd: 0.5,
        inputTokens: 100,
        turnId: 'turn-1',
      }),
      expect.objectContaining({ costUsd: 0.25, inputTokens: 60, turnId: 'turn-2' }),
    ])
  })

  it('seeds a resumed conversation without recording its history as one turn', () => {
    const { recorder, rows } = recorderFixture()
    recorder.accept(
      totalsEvent('turn-1', [totals({ continuesEarlierTurns: true, inputTokens: 9000 })]),
      'turn',
    )
    recorder.accept(
      totalsEvent('turn-2', [totals({ continuesEarlierTurns: true, inputTokens: 9040 })]),
      'turn',
    )

    expect(rows()).toEqual([expect.objectContaining({ inputTokens: 40, turnId: 'turn-2' })])
  })

  it('ignores a zeroed reading and counts a restarted scope in full', () => {
    const { recorder, rows } = recorderFixture()
    recorder.accept(totalsEvent('turn-1', [totals({ inputTokens: 100 })]), 'turn')
    recorder.accept(totalsEvent('turn-2', [totals({ inputTokens: 0 })]), 'turn')
    recorder.accept(totalsEvent('turn-3', [totals({ inputTokens: 130 })]), 'turn')
    recorder.accept(
      totalsEvent('turn-4', [totals({ inputTokens: 20, scope: 'after-clear' })]),
      'turn',
    )

    expect(rows().map((row) => [row.turnId, row.inputTokens])).toEqual([
      ['turn-1', 100],
      ['turn-3', 30],
      ['turn-4', 20],
    ])
  })

  it('keeps each model apart, leaves an unpriced cost null and adds a repeated turn end', () => {
    const { recorder, rows } = recorderFixture()
    const codex = { costUsd: null, model: 'gpt-5.5', scope: 'conversation-codex' }
    recorder.accept(totalsEvent('turn-1', [totals({ ...codex, outputTokens: 10 })]), 'turn')
    recorder.accept(totalsEvent('turn-1', [totals({ ...codex, outputTokens: 25 })]), 'turn')

    expect(rows()).toEqual([
      expect.objectContaining({ costUsd: null, model: 'gpt-5.5', outputTokens: 25 }),
    ])
  })
})

it('labels what the spend was for', () => {
  const { recorder, rows } = recorderFixture()
  recorder.accept(totalsEvent('title-turn', [totals({ costUsd: 0.01, outputTokens: 12 })]), 'title')

  expect(rows()).toEqual([expect.objectContaining({ costUsd: 0.01, purpose: 'title' })])
})

function recorderFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migratePlatformDatabase(database)
  closers.push(() => sqlite.close())
  const accounts = {
    usageAccount: (providerInstanceId: ProviderInstanceId) => ({
      accountKey: 'account-1',
      driverKind: v.parse(providerDriverKindSchema, providerInstanceId),
      enabled: true,
    }),
  }

  return {
    recorder: new ProviderUsageRecorder(database, accounts),
    rows: () => database.select().from(schema.providerUsageTurns).all(),
  }
}

function totals(overrides: Partial<ProviderUsageTotals>): ProviderUsageTotals {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    continuesEarlierTurns: false,
    costUsd: 0,
    inputTokens: 0,
    model: 'claude-opus-5-5',
    outputTokens: 0,
    reasoningTokens: 0,
    scope: 'conversation-1',
    ...overrides,
  }
}

function totalsEvent(turnId: string, entries: ProviderUsageTotals[]): UsageTotalsEvent {
  return {
    createdAt: '2026-09-25T10:00:00.000Z',
    eventId: `totals-${turnId}`,
    payload: { totals: entries },
    providerInstanceId: INSTANCE,
    runtimeEpoch: 'epoch-1',
    sessionId: SESSION,
    turnId: v.parse(turnIdSchema, turnId),
    type: 'usage.totals',
  }
}
