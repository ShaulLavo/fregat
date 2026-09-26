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
import type { ProviderPriceCatalog } from '../price-catalog'
import { ProviderUsageHistoryReader } from '../usage-history'
import { ProviderUsageRecorder } from '../usage-recorder'
import { claudeTranscriptUsage, codexRolloutUsage } from '../utils/imported-usage'
import type { ProviderUsageTotals } from '../utils/usage-totals'

const INSTANCE = v.parse(providerInstanceIdSchema, 'claude')
const SESSION = v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('provider usage recorder', () => {
  it('counts the first resumed turn after receiving its pre-turn native baseline', () => {
    const { recorder, rows } = recorderFixture()
    const before = totalsEvent('resumed', [
      totals({ continuesEarlierTurns: true, inputTokens: 1000 }),
    ])
    recorder.accept(before, 'turn')
    recorder.accept(
      totalsEvent('resumed', [totals({ continuesEarlierTurns: true, inputTokens: 1100 })]),
      'turn',
    )
    expect(rows()).toEqual([expect.objectContaining({ inputTokens: 100, turnId: 'resumed' })])
  })

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

it('freezes each turn rate across catalog updates, repeated completions and recorder restarts', () => {
  let input = 2
  const fixture = recorderFixture((driver, model) => {
    expect(driver).toBe('codex')
    return {
      input,
      output: 10,
      cacheRead: 0.5,
      cacheWrite: null,
      provider: 'openai',
      model,
      fetchedAt: '2026-09-25T00:00:00.000Z',
    }
  }, 'codex')
  const usage = { costUsd: null, model: 'gpt-test', inputTokens: 1_000_000 }
  fixture.recorder.accept(totalsEvent('first', [totals(usage)]), 'turn')
  input = 4
  fixture.recorder.accept(
    totalsEvent('second', [totals({ ...usage, inputTokens: 2_000_000 })]),
    'turn',
  )
  fixture
    .restart()
    .accept(totalsEvent('first', [totals({ ...usage, inputTokens: 3_000_000 })]), 'turn')
  fixture
    .restart()
    .accept(totalsEvent('first', [totals({ ...usage, inputTokens: 3_000_000 })]), 'turn')
  expect(fixture.rows()).toEqual([
    expect.objectContaining({
      turnId: 'first',
      costUsd: 4,
      priceSnapshot: expect.objectContaining({ input: 2 }),
    }),
    expect.objectContaining({
      turnId: 'second',
      costUsd: 4,
      priceSnapshot: expect.objectContaining({ input: 4 }),
    }),
  ])
  input = 100
  expect(fixture.history().totals.costUsd).toBe(8)
  expect(fixture.history().models[0]?.costSource).toBe('catalog')
})

it('prefers a provider estimate without fetching rates, including an explicit zero', () => {
  let lookups = 0
  const fixture = recorderFixture(() => {
    lookups += 1
    return null
  })
  fixture.recorder.accept(totalsEvent('free', [totals({ inputTokens: 1, costUsd: 0 })]), 'turn')
  fixture.recorder.accept(totalsEvent('paid', [totals({ inputTokens: 2, costUsd: 0.25 })]), 'turn')
  expect(lookups).toBe(0)
  expect(fixture.rows().map((row) => [row.costUsd, row.priceSnapshot])).toEqual([
    [0, null],
    [0.25, null],
  ])
})

it.each([3, 0])(
  'replaces a catalog estimate with a later provider total of $%s after restart',
  (costUsd) => {
    const fixture = recorderFixture((_driver, model) => ({
      input: 2,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      provider: 'anthropic',
      model,
      fetchedAt: '2026-09-25T00:00:00.000Z',
    }))
    const usage = { inputTokens: 1_000_000, costUsd: null }
    fixture.recorder.accept(totalsEvent('late', [totals(usage)]), 'turn')
    expect(fixture.rows()[0]?.costUsd).toBe(2)
    const restarted = fixture.restart()
    restarted.accept(totalsEvent('late', [totals({ ...usage, costUsd })]), 'turn')
    restarted.accept(totalsEvent('late', [totals({ ...usage, costUsd })]), 'turn')
    expect(fixture.rows()[0]).toMatchObject({
      costUsd,
      priceSnapshot: null,
      inputTokens: 1_000_000,
    })
    expect(fixture.history().models[0]).toMatchObject({ costUsd, costSource: 'provider' })
  },
)

it('corrects one conversation without replacing another conversation in the same turn', () => {
  const fixture = estimatedFixture()
  const root = { inputTokens: 1_000_000, costUsd: null }
  fixture.recorder.accept(
    totalsEvent('turn', [totals(root), totals({ scope: 'child', inputTokens: 100, costUsd: 4 })]),
    'turn',
  )
  expect(fixture.rows()[0]?.costUsd).toBe(6)
  fixture.restart().accept(totalsEvent('turn', [totals({ ...root, costUsd: 3 })]), 'turn')
  expect(fixture.rows()[0]).toMatchObject({
    costUsd: 7,
    priceSnapshot: null,
    inputTokens: 1_000_100,
  })
  expect(fixture.history().models[0]).toMatchObject({ costUsd: 7, costSource: 'provider' })
})

it('subtracts the cost before the turn when a cumulative provider total arrives late', () => {
  const fixture = estimatedFixture()
  fixture.recorder.accept(
    totalsEvent('before', [totals({ inputTokens: 1_000_000, costUsd: 5 })]),
    'turn',
  )
  fixture.recorder.accept(
    totalsEvent('late', [totals({ inputTokens: 2_000_000, costUsd: null })]),
    'turn',
  )
  fixture
    .restart()
    .accept(totalsEvent('late', [totals({ inputTokens: 2_000_000, costUsd: 8 })]), 'turn')
  expect(fixture.rows().map((row) => [row.turnId, row.costUsd])).toEqual([
    ['before', 5],
    ['late', 3],
  ])
})

it('does not assign earlier unreported costs to a later turn', () => {
  const fixture = estimatedFixture()
  fixture.recorder.accept(
    totalsEvent('before', [totals({ inputTokens: 1_000_000, costUsd: null })]),
    'turn',
  )
  fixture.recorder.accept(
    totalsEvent('next', [totals({ inputTokens: 2_000_000, costUsd: 8 })]),
    'turn',
  )
  fixture.recorder.accept(
    totalsEvent('priced', [totals({ inputTokens: 3_000_000, costUsd: 10 })]),
    'turn',
  )
  expect(fixture.rows().map((row) => [row.turnId, row.costUsd])).toEqual([
    ['before', 2],
    ['next', 2],
    ['priced', 2],
  ])
})

it('keeps a reported prefix when later tokens temporarily have no reported cost', () => {
  const fixture = estimatedFixture()
  fixture.recorder.accept(
    totalsEvent('turn', [totals({ inputTokens: 1_000_000, costUsd: 3 })]),
    'turn',
  )
  fixture.recorder.accept(
    totalsEvent('turn', [totals({ inputTokens: 1_000_000, costUsd: null })]),
    'turn',
  )
  fixture.recorder.accept(
    totalsEvent('turn', [totals({ inputTokens: 2_000_000, costUsd: null })]),
    'turn',
  )
  expect(fixture.rows()[0]?.costUsd).toBe(5)
  fixture.recorder.accept(
    totalsEvent('turn', [totals({ inputTokens: 2_000_000, costUsd: 7 })]),
    'turn',
  )
  expect(fixture.rows()[0]).toMatchObject({ costUsd: 7, priceSnapshot: null })
})

it('keeps completed estimates when a conversation counter resets within the turn', () => {
  const fixture = estimatedFixture()
  fixture.recorder.accept(
    totalsEvent('turn', [totals({ inputTokens: 1_000_000, costUsd: null })]),
    'turn',
  )
  fixture.recorder.accept(
    totalsEvent('turn', [totals({ inputTokens: 500_000, costUsd: null })]),
    'turn',
  )
  fixture.recorder.accept(
    totalsEvent('turn', [totals({ inputTokens: 500_000, costUsd: 1.5 })]),
    'turn',
  )
  expect(fixture.rows()[0]).toMatchObject({ costUsd: 3.5, inputTokens: 1_500_000 })
})

function estimatedFixture() {
  return recorderFixture((_driver, model) => ({
    input: 2,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    provider: 'anthropic',
    model,
    fetchedAt: '2026-09-25T00:00:00.000Z',
  }))
}

it('keeps a turn unknown when prices arrive after its first completion', () => {
  let known = false
  const fixture = recorderFixture(
    (_driver, model) =>
      known
        ? {
            input: 2,
            output: 10,
            cacheRead: 0,
            cacheWrite: 0,
            provider: 'openai',
            model,
            fetchedAt: '2026-09-25T00:00:00.000Z',
          }
        : null,
    'codex',
  )
  fixture.recorder.accept(
    totalsEvent('first', [totals({ costUsd: null, inputTokens: 10 })]),
    'turn',
  )
  known = true
  fixture.recorder.accept(
    totalsEvent('first', [totals({ costUsd: null, inputTokens: 20 })]),
    'turn',
  )
  expect(fixture.rows()[0]?.costUsd).toBeNull()
  const history = fixture.history()
  expect(history.totals).toMatchObject({ costUsd: null, unpricedTokens: 20 })
  expect(history.daily[0]?.costUsd).toBeNull()
  expect(history.purposes[0]?.costUsd).toBeNull()
})

it('labels what the spend was for', () => {
  const { recorder, rows } = recorderFixture()
  recorder.accept(totalsEvent('title-turn', [totals({ costUsd: 0.01, outputTokens: 12 })]), 'title')

  expect(rows()).toEqual([expect.objectContaining({ costUsd: 0.01, purpose: 'title' })])
})

it.each(['claude', 'codex'] as const)(
  'bills copied %s requests once across fork imports in either order and across restarts',
  (driver) => {
    const transcripts = importedForkUsage(driver)
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const fixture = recorderFixture(() => null, driver)
      for (const index of order) {
        const transcript = transcripts[index]!
        fixture
          .restart()
          .importTurns(
            { providerInstanceId: INSTANCE, sessionId: transcript.sessionId },
            transcript.usage,
          )
      }
      for (const transcript of transcripts)
        fixture
          .restart()
          .importTurns(
            { providerInstanceId: INSTANCE, sessionId: transcript.sessionId },
            transcript.usage,
          )
      expect(fixture.history().totals).toMatchObject({ tokens: 60, turns: 3 })
    }
  },
)

function importedForkUsage(driver: 'claude' | 'codex') {
  const at = '2026-09-24T09:00:00.000Z'
  function usage(turns: { id: string; tokens: number }[]) {
    if (driver === 'claude')
      return claudeTranscriptUsage(
        turns.flatMap(({ id, tokens }) => [
          { type: 'user', uuid: `prompt-${id}`, timestamp: at, message: { content: id } },
          {
            type: 'assistant',
            timestamp: at,
            message: { id, model: 'claude-opus-5-5', usage: { output_tokens: tokens } },
          },
        ]),
        [],
      )
    let total = 0
    return codexRolloutUsage(
      turns.flatMap(({ id, tokens }) => {
        total += tokens
        return [
          { type: 'turn_context', payload: { turn_id: id, model: 'gpt-5.5' } },
          {
            type: 'event_msg',
            timestamp: at,
            payload: { type: 'token_count', info: { total_token_usage: { output_tokens: total } } },
          },
        ]
      }),
    )
  }
  return [
    {
      sessionId: 'parent',
      usage: usage([
        { id: 'shared', tokens: 10 },
        { id: 'parent-own', tokens: 20 },
      ]),
    },
    {
      sessionId: 'fork',
      usage: usage([
        { id: 'shared', tokens: 10 },
        { id: 'fork-own', tokens: 30 },
      ]),
    },
  ]
}

it.each([false, true])(
  'keeps complete bills when fork requests share a prompt and arrive in reverse order: %s',
  (reverse) => {
    const fixture = estimatedFixture()
    const shared = importedResponse('shared', 20)
    const parent = { sessionId: 'parent', usage: [shared] }
    const fork = { sessionId: 'fork', usage: [shared, importedResponse('child-only', 30)] }
    const imports = reverse ? [fork, parent] : [parent, fork]
    for (const transcript of imports)
      fixture
        .restart()
        .importTurns(
          { providerInstanceId: INSTANCE, sessionId: transcript.sessionId },
          transcript.usage,
        )
    fixture
      .restart()
      .importTurns({ providerInstanceId: INSTANCE, sessionId: 'parent' }, [
        importedResponse('shared', 2),
      ])
    expect(fixture.history().totals).toMatchObject({ tokens: 50, costUsd: 0.0005 })
    expect(fixture.rows().reduce((total, row) => total + row.outputTokens, 0)).toBe(50)
  },
)

it.each([null, 'shared-account'])(
  'scopes native billing IDs by known account or provider instance: %s',
  (accountKey) => {
    const fixture = recorderFixture(
      () => null,
      'claude',
      () => accountKey,
    )
    fixture.recorder.importTurns({ providerInstanceId: INSTANCE, sessionId: 'first' }, [
      importedResponse('same-id', 20),
    ])
    fixture
      .restart()
      .importTurns(
        { providerInstanceId: v.parse(providerInstanceIdSchema, 'other'), sessionId: 'second' },
        [importedResponse('same-id', 20)],
      )
    expect(fixture.history().totals.tokens).toBe(accountKey ? 20 : 40)
  },
)

it('keeps native billing IDs separate between accounts', () => {
  const fixture = recorderFixture(
    () => null,
    'claude',
    (instance) => instance,
  )
  fixture.recorder.importTurns({ providerInstanceId: INSTANCE, sessionId: 'first' }, [
    importedResponse('same-id', 20),
  ])
  fixture
    .restart()
    .importTurns(
      { providerInstanceId: v.parse(providerInstanceIdSchema, 'other'), sessionId: 'second' },
      [importedResponse('same-id', 20)],
    )
  expect(fixture.history().totals.tokens).toBe(40)
})

function importedResponse(billingKey: string, outputTokens: number) {
  return {
    billingKey,
    outputTokens,
    turnKey: 'shared-prompt',
    model: 'claude-opus-5-5',
    recordedAt: '2026-09-24T09:00:00.000Z',
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
  }
}

it('imports transcript turns priced from the catalog, and a re-read replaces only its own rows', () => {
  const fixture = estimatedFixture()
  const imported = (outputTokens: number) => ({
    billingKey: 'message-1',
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    inputTokens: 1_000_000,
    model: 'claude-opus-5-5',
    outputTokens,
    reasoningTokens: 0,
    recordedAt: '2026-09-24T09:00:00.000Z',
    turnKey: 'prompt-1',
  })
  fixture.recorder.importTurns({ providerInstanceId: INSTANCE, sessionId: SESSION }, [
    imported(100_000),
  ])
  fixture.recorder.importTurns({ providerInstanceId: INSTANCE, sessionId: SESSION }, [
    imported(200_000),
  ])
  expect(fixture.rows()).toEqual([
    expect.objectContaining({
      costUsd: 4,
      outputTokens: 200_000,
      recordedAt: '2026-09-24T09:00:00.000Z',
      source: 'import',
      turnId: 'import:prompt-1',
    }),
  ])

  // Continued here: the resumed totals already hold the imported turn, so they only seed.
  fixture.recorder.accept(
    totalsEvent('turn-live', [
      totals({ continuesEarlierTurns: true, inputTokens: 1_000_000, outputTokens: 200_000 }),
    ]),
    'turn',
  )
  expect(fixture.rows()).toHaveLength(1)
})

function recorderFixture(
  lookup: ProviderPriceCatalog['lookup'] = () => null,
  driverKind: 'claude' | 'codex' = 'claude',
  accountKeyFor: (instance: ProviderInstanceId) => string | null = () => 'account-1',
) {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migratePlatformDatabase(database)
  closers.push(() => sqlite.close())
  const accounts = {
    usageAccount: (providerInstanceId: ProviderInstanceId) => {
      const accountKey = accountKeyFor(providerInstanceId)
      if (accountKey === null) return null
      return {
        accountKey,
        driverKind: v.parse(providerDriverKindSchema, driverKind),
        enabled: true,
      }
    },
  }

  return {
    recorder: new ProviderUsageRecorder(database, accounts, { lookup }),
    restart: () => new ProviderUsageRecorder(database, accounts, { lookup }),
    history: () =>
      new ProviderUsageHistoryReader(database, {
        now: () => Date.parse('2026-09-25T12:00:00.000Z'),
      }).read({ days: 7, utcOffsetMinutes: 0 }),
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
