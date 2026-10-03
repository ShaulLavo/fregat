import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { LocalTranscriptUsageService } from '../transcript-history'
import { codexRolloutUsage } from '../utils/imported-usage'
import { usageTokenCount } from '@workspace/contracts'
import {
  transcriptHistoryFixture,
  nativeClaudeResponse,
  TRANSCRIPT_FIXTURE_NOW as now,
} from '../../testing/transcript-usage'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
const query = { days: 7 as const, utcOffsetMinutes: 0 }

it('finds native usage outside Fregat projects; range reads never scan', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  await writeFile(
    join(f.transcripts, 'session.jsonl'),
    JSON.stringify(nativeClaudeResponse('request-1')) + '\n',
  )
  expect(f.service.read(query).totals.tokens).toBe(0)
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(120)
  expect(f.service.read(query).coverage).toMatchObject({
    scope: 'local-transcripts',
    accountAttribution: 'unverified',
    sources: [{ status: 'ready', records: 1 }],
  })
  await appendFile(
    join(f.transcripts, 'session.jsonl'),
    JSON.stringify(nativeClaudeResponse('request-2')) + '\n',
  )
  expect(f.service.read({ ...query, days: 30 }).totals.tokens).toBe(120)
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(240)
})

it('keeps incomplete tails out, resumes appends and takes maxima across Claude fragments and copies', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const file = join(f.transcripts, 'main.jsonl')
  const partial = JSON.stringify(nativeClaudeResponse('request-1', 40))
  await writeFile(
    file,
    JSON.stringify(nativeClaudeResponse('request-1')) + '\n' + partial.slice(0, 40),
  )
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(120)
  await appendFile(file, partial.slice(40) + '\n')
  await writeFile(join(f.transcripts, 'copy.jsonl'), partial + '\n')
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(140)
  const cold = f.service.read(query).coverage?.bytesRead
  await f.service.refresh()
  expect(f.service.read(query).coverage?.bytesRead).toBe(0)
  expect(cold).toBeGreaterThan(0)
})

it('rebuilds replaced and truncated file contributions and preserves vanished history on restart', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const file = join(f.transcripts, 'session.jsonl')
  await writeFile(file, JSON.stringify(nativeClaudeResponse('old', 80)) + '\n')
  await f.service.refresh()
  await writeFile(file, JSON.stringify(nativeClaudeResponse('new', 1)) + '\n')
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(101)
  await rm(file)
  await f.service.refresh()
  f.service.close()
  const restarted = new LocalTranscriptUsageService(f.options)
  cleanup.push(async () => restarted.close())
  await restarted.initialize()
  expect(restarted.read(query).totals.tokens).toBe(101)
})

it('rebuckets timestamps, leaves unknown price explicit, and never adds reasoning twice', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const event = nativeClaudeResponse('unknown')
  event.timestamp = '2026-10-02T23:30:00Z'
  event.message.model = 'unknown-model'
  await writeFile(join(f.transcripts, 'session.jsonl'), JSON.stringify(event) + '\n')
  await f.service.refresh()
  const report = f.service.read({ ...query, utcOffsetMinutes: 180 })
  expect(report.daily[0]?.day).toBe('2026-10-03')
  expect(report.totals).toMatchObject({ costUsd: null, tokens: 120, unpricedTokens: 120 })
})

it('uses persistent Codex cumulative baselines across append, copies and forked child rollouts', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  const service = new LocalTranscriptUsageService({
    ...f.options,
    sources: [{ id: 'codex-native', driverKind: 'codex', roots: [f.transcripts] }],
  })
  cleanup.push(async () => service.close())
  await service.initialize()
  const total = (input: number, output: number, lastInput = input, lastOutput = output) => ({
    type: 'event_msg',
    timestamp: '2026-10-03T11:00:00Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          output_tokens: output,
          cached_input_tokens: 10,
          reasoning_output_tokens: 4,
        },
        last_token_usage: { input_tokens: lastInput, output_tokens: lastOutput },
      },
    },
  })
  const context = (turn_id: string) => ({
    type: 'turn_context',
    payload: { turn_id, model: 'gpt-test' },
  })
  const file = join(f.transcripts, 'parent.jsonl')
  await writeFile(
    file,
    [{ type: 'session_meta', payload: { id: 'parent' } }, context('turn-1'), total(100, 20)]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(120)
  await appendFile(
    file,
    [total(100, 20), total(140, 30, 40, 10)].map((row) => JSON.stringify(row)).join('\n') + '\n',
  )
  await writeFile(
    join(f.transcripts, 'copy.jsonl'),
    await import('node:fs/promises').then((fs) => fs.readFile(file)),
  )
  await mkdir(join(f.transcripts, 'subagents'))
  await writeFile(
    join(f.transcripts, 'subagents', 'child.jsonl'),
    [
      { type: 'session_meta', payload: { id: 'child', forked_from_id: 'parent' } },
      context('turn-child'),
      total(160, 40, 20, 10),
      total(160, 40, 20, 10),
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(200)
  expect(service.read(query).models[0]?.reasoningTokens).toBe(4)
  expect(service.read(query).coverage?.sources[0]?.records).toBe(2)
})

it('bounds cold scans, stages rewrites atomically, and streams huge conversation fields without caching them', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  const service = new LocalTranscriptUsageService({
    ...f.options,
    limits: { ...f.options.limits, maxBytes: 512, maxLineBytes: 512, readChunkBytes: 97 },
  })
  cleanup.push(async () => service.close())
  await service.initialize()
  const line = nativeClaudeResponse('large')
  const file = join(f.transcripts, 'large.jsonl')
  await writeFile(
    file,
    JSON.stringify({
      ...line,
      message: { ...line.message, content: 'PRIVATE-CONTENT-'.repeat(2000) },
    }) + '\n',
  )
  for (let index = 0; index < 80 && service.read(query).totals.tokens === 0; index++) {
    await service.refresh()
    expect(service.read(query).coverage?.bytesRead).toBeLessThanOrEqual(512)
  }
  expect(service.read(query).totals.tokens).toBe(120)
  const { Database } = await import('bun:sqlite')
  const database = new Database(join(f.options.cacheDirectory, 'transcript-history.sqlite'))
  expect(
    database
      .query<{ value: string }, []>('SELECT value FROM files')
      .all()
      .map((row) => row.value)
      .join(''),
  ).not.toContain('PRIVATE-CONTENT')
  database.close()
  await writeFile(
    file,
    JSON.stringify({
      ...nativeClaudeResponse('replacement', 80),
      message: {
        ...nativeClaudeResponse('replacement', 80).message,
        content: 'replacement'.repeat(2000),
      },
    }) + '\n',
  )
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(120)
  for (let index = 0; index < 80 && service.read(query).totals.tokens !== 180; index++)
    await service.refresh()
  expect(service.read(query).totals.tokens).toBe(180)
})

it('restarts partial projection safely, invalidates corrupt/parser-version cache and reports malformed input', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const file = join(f.transcripts, 'session.jsonl')
  const text = JSON.stringify(nativeClaudeResponse('request-1'))
  await writeFile(file, text.slice(0, 80))
  await f.service.refresh()
  f.service.close()
  const restarted = new LocalTranscriptUsageService(f.options)
  cleanup.push(async () => restarted.close())
  await restarted.initialize()
  await appendFile(file, text.slice(80) + '\n{invalid-json}\n')
  await restarted.refresh()
  expect(restarted.read(query).totals.tokens).toBe(120)
  expect(restarted.read(query).coverage?.sources[0]).toMatchObject({
    status: 'partial',
    malformedLines: 1,
  })
  restarted.close()
  const { Database } = await import('bun:sqlite')
  const database = new Database(join(f.options.cacheDirectory, 'transcript-history.sqlite'))
  database.query('UPDATE files SET value = ?').run('{"version":0}')
  database.close()
  const invalidated = new LocalTranscriptUsageService(f.options)
  cleanup.push(async () => invalidated.close())
  await invalidated.initialize()
  expect(invalidated.read(query).totals.tokens).toBe(0)
  await invalidated.refresh()
  expect(invalidated.read(query).totals.tokens).toBe(120)
})

it('retains source-scoped unknown identities, exposes absent roots, and rolls back cancelled scans', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const event = nativeClaudeResponse('')
  await writeFile(join(f.transcripts, 'unknown.jsonl'), JSON.stringify(event) + '\n')
  await writeFile(join(f.transcripts, 'other.jsonl'), JSON.stringify(event) + '\n')
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(240)
  expect(f.service.read(query).coverage?.sources[0]?.unidentifiedRecords).toBe(2)
  const abort = new AbortController()
  abort.abort()
  await expect(f.service.refresh({ signal: abort.signal })).rejects.toThrow()
  expect(f.service.read(query).totals.tokens).toBe(240)
  f.service.close()
  const absent = new LocalTranscriptUsageService({
    ...f.options,
    sources: [{ id: 'absent', driverKind: 'claude', roots: [join(f.root, 'not-installed')] }],
  })
  cleanup.push(async () => absent.close())
  await absent.initialize()
  await absent.refresh()
  expect(absent.read(query).coverage?.sources[0]?.status).toBe('absent')
})

it('keeps ephemeral Fregat utilities once while excluding recorder turns already covered by transcripts', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const { Database } = await import('bun:sqlite')
  const { drizzle } = await import('drizzle-orm/bun-sqlite')
  const schema = await import('../../db/schema')
  const { initializePlatformDatabase } = await import('../../db/initialize')
  const { ProviderUsageHistoryReader } = await import('../usage-history')
  const sqlite = new Database(':memory:')
  const database = drizzle({ client: sqlite, schema })
  initializePlatformDatabase(database)
  cleanup.push(async () => sqlite.close())
  const common = {
    accountKey: null,
    driverKind: 'claude',
    providerInstanceId: 'claude',
    sessionId: 'fregat-session',
    model: 'test-model',
    recordedAt: '2026-10-03T10:00:00.000Z',
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.01,
  }
  database
    .insert(schema.providerUsageTurns)
    .values([
      { ...common, purpose: 'turn', turnId: 'chat-turn' },
      { ...common, purpose: 'title', turnId: 'utility-title' },
      { ...common, driverKind: 'opencode', purpose: 'turn', turnId: 'uncovered-chat' },
    ])
    .run()
  await writeFile(
    join(f.transcripts, 'native.jsonl'),
    JSON.stringify(nativeClaudeResponse('native-chat-response')) + '\n',
  )
  f.service.close()
  const service = new LocalTranscriptUsageService({
    ...f.options,
    utilityHistory: new ProviderUsageHistoryReader(database, { now: () => now }),
  })
  cleanup.push(async () => service.close())
  await service.initialize()
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(360)
  expect(service.read(query).purposes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ purpose: 'title', turns: 1 }),
      expect.objectContaining({ purpose: 'turn', turns: 2 }),
    ]),
  )
  expect(service.read(query).coverage?.sources).toContainEqual(
    expect.objectContaining({ sourceKind: 'fregat-utility', records: 1 }),
  )
  expect(service.read(query).coverage?.sources).toContainEqual(
    expect.objectContaining({ sourceKind: 'fregat-session', records: 1 }),
  )
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(360)
})

it('projects local catalog prices without making provider or pricing network calls', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const { Database } = await import('bun:sqlite')
  const { drizzle } = await import('drizzle-orm/bun-sqlite')
  const schema = await import('../../db/schema')
  const { initializePlatformDatabase } = await import('../../db/initialize')
  const { ProviderPriceCatalog } = await import('../price-catalog')
  const sqlite = new Database(':memory:')
  const database = drizzle({ client: sqlite, schema })
  initializePlatformDatabase(database)
  let calls = 0
  const catalog = new ProviderPriceCatalog(database, async () => {
    calls++
    return new Response(null, { status: 503 })
  })
  cleanup.push(async () => {
    catalog.close()
    sqlite.close()
  })
  f.service.close()
  const service = new LocalTranscriptUsageService({ ...f.options, priceCatalog: catalog })
  cleanup.push(async () => service.close())
  await service.initialize()
  await writeFile(
    join(f.transcripts, 'native.jsonl'),
    JSON.stringify(nativeClaudeResponse('request')) + '\n',
  )
  await service.refresh()
  for (const days of [7, 30, 90] as const) service.read({ ...query, days })
  expect(calls).toBe(0)
})

it('recreates a corrupt SQLite cache and rebuilds only from local transcripts', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  await writeFile(
    join(f.transcripts, 'native.jsonl'),
    JSON.stringify(nativeClaudeResponse('native')) + '\n',
  )
  f.service.close()
  await writeFile(join(f.options.cacheDirectory, 'transcript-history.sqlite'), 'broken sqlite')
  const service = new LocalTranscriptUsageService(f.options)
  cleanup.push(async () => service.close())
  await service.initialize()
  expect(service.read(query).totals.tokens).toBe(0)
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(120)
})

it('detects same-size replacement and changed prefixes on a growing file', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const file = join(f.transcripts, 'native.jsonl')
  await writeFile(file, JSON.stringify(nativeClaudeResponse('old')) + '\n')
  await f.service.refresh()
  await rm(file)
  await writeFile(file, JSON.stringify(nativeClaudeResponse('new')) + '\n')
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(120)
  await writeFile(
    file,
    JSON.stringify(nativeClaudeResponse('changed', 80)) +
      '\n' +
      JSON.stringify(nativeClaudeResponse('next')) +
      '\n',
  )
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(300)
})

it('keeps recorded price provenance, including unknown prices, across appends and restart', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  let priced = false
  const options = {
    ...f.options,
    priceCatalog: {
      lookupLocal: (driver: string, model: string) =>
        priced ? f.options.priceCatalog.lookupLocal(driver, model) : null,
    },
  }
  const service = new LocalTranscriptUsageService(options)
  cleanup.push(async () => service.close())
  await service.initialize()
  const file = join(f.transcripts, 'native.jsonl')
  await writeFile(file, JSON.stringify(nativeClaudeResponse('unknown')) + '\n')
  await service.refresh()
  priced = true
  await appendFile(
    file,
    JSON.stringify(nativeClaudeResponse('unknown', 40)) +
      '\n' +
      JSON.stringify(nativeClaudeResponse('priced')) +
      '\n',
  )
  await service.refresh()
  const report = service.read(query)
  expect(report.totals.unpricedTokens).toBe(140)
  expect(report.totals.costUsd).toBeCloseTo(0.00014)
  service.close()
  priced = false
  const restarted = new LocalTranscriptUsageService(options)
  cleanup.push(async () => restarted.close())
  await restarted.initialize()
  expect(restarted.read(query).totals).toEqual(report.totals)
})

it('resumes UTF-8 codepoint boundaries across bounded passes and process restart', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  const text = JSON.stringify(nativeClaudeResponse('native-🚀')) + '\n'
  const budget = Buffer.byteLength(text.slice(0, text.indexOf('🚀'))) + 1
  const options = {
    ...f.options,
    limits: { ...f.options.limits, maxBytes: budget, readChunkBytes: budget },
  }
  const service = new LocalTranscriptUsageService(options)
  cleanup.push(async () => service.close())
  await service.initialize()
  await writeFile(join(f.transcripts, 'native.jsonl'), text)
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(0)
  service.close()
  const restarted = new LocalTranscriptUsageService(options)
  cleanup.push(async () => restarted.close())
  await restarted.initialize()
  for (let index = 0; index < 5 && !restarted.read(query).totals.tokens; index++)
    await restarted.refresh()
  expect(restarted.read(query).totals.tokens).toBe(120)
  await restarted.refresh()
  expect(restarted.read(query).coverage?.bytesRead).toBe(0)
})

it('coalesces concurrent refreshes and rolls back cancellation after actual file work', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const file = join(f.transcripts, 'native.jsonl')
  await writeFile(file, JSON.stringify(nativeClaudeResponse('initial')) + '\n')
  const results = await Promise.all([f.service.refresh(), f.service.refresh(), f.service.refresh()])
  expect(results[0]).toBe(results[1])
  expect(results[1]).toBe(results[2])
  f.service.close()
  const abort = new AbortController()
  let seen = 0
  const service = new LocalTranscriptUsageService({
    ...f.options,
    priceCatalog: {
      lookupLocal: (driver: string, model: string) => {
        seen++
        abort.abort()
        return f.options.priceCatalog.lookupLocal(driver, model)
      },
    },
  })
  cleanup.push(async () => service.close())
  await service.initialize()
  const before = service.read(query)
  await appendFile(file, JSON.stringify(nativeClaudeResponse('cancelled')) + '\n')
  await expect(service.refresh({ signal: abort.signal })).rejects.toThrow()
  expect(seen).toBe(1)
  expect(service.read(query)).toEqual(before)
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(240)
})

it('reports oversized selected metadata and enforces viewer-local range boundaries', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const old = nativeClaudeResponse('old')
  old.timestamp = '2026-09-27T02:59:59Z'
  const boundary = nativeClaudeResponse('boundary')
  boundary.timestamp = '2026-09-27T03:00:00Z'
  const future = nativeClaudeResponse('future')
  future.timestamp = '2026-10-03T12:00:01Z'
  await writeFile(
    join(f.transcripts, 'native.jsonl'),
    [old, boundary, future, nativeClaudeResponse('x'.repeat(70000))]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  await f.service.refresh()
  expect(f.service.read({ ...query, utcOffsetMinutes: -180 }).totals.tokens).toBe(120)
  expect(f.service.read(query).coverage?.sources[0]).toMatchObject({
    status: 'partial',
    oversizedLines: 1,
  })
})

it('groups Claude tool-round billing responses by sanitized native user prompts', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const rows = [
    { type: 'user', uuid: 'prompt-1', message: { content: 'PRIVATE PROMPT' } },
    nativeClaudeResponse('round-1'),
    {
      type: 'user',
      uuid: 'tool-uuid',
      message: { content: [{ type: 'tool_result', content: 'PRIVATE TOOL' }] },
    },
    nativeClaudeResponse('round-2'),
    nativeClaudeResponse('round-3'),
    { type: 'user', uuid: 'interrupted', message: { content: '[Request interrupted by user]' } },
    { type: 'user', uuid: 'meta', isMeta: true, message: { content: 'PRIVATE META' } },
    {
      type: 'user',
      uuid: 'prompt-2',
      message: { content: [{ type: 'text', text: 'PRIVATE NEXT' }] },
    },
    nativeClaudeResponse('round-4'),
    nativeClaudeResponse('round-5'),
  ]
  await writeFile(
    join(f.transcripts, 'claude.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  )
  await f.service.refresh()
  expect(f.service.read(query).totals).toMatchObject({ turns: 2, tokens: 600 })
  const { Database } = await import('bun:sqlite')
  const database = new Database(join(f.options.cacheDirectory, 'transcript-history.sqlite'))
  expect(
    database
      .query<{ value: string }, []>('SELECT value FROM files')
      .all()
      .map((row) => row.value)
      .join(''),
  ).not.toContain('PRIVATE')
  database.close()
})

it.each([
  { source: 'cli', forked_from_id: 'parent' },
  { source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } },
  { source: { subagent: 'review' }, forked_from_id: 'parent' },
])('honors native fork and subagent cumulative baselines: %j', async (metadata) => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  const service = new LocalTranscriptUsageService({
    ...f.options,
    sources: [{ id: 'codex', driverKind: 'codex', roots: [f.transcripts] }],
  })
  cleanup.push(async () => service.close())
  await service.initialize()
  const rows = [
    { type: 'session_meta', payload: { id: 'child', ...metadata } },
    { type: 'turn_context', payload: { turn_id: 'child-turn', model: 'gpt-test' } },
    {
      type: 'event_msg',
      timestamp: '2026-10-03T10:00:00Z',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 150, output_tokens: 30 },
          last_token_usage: { input_tokens: 50, output_tokens: 10 },
        },
      },
    },
  ]
  await writeFile(
    join(f.transcripts, 'codex.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  )
  await service.refresh()
  expect(service.read(query).totals.tokens).toBe(60)
  expect(codexRolloutUsage(rows).reduce((total, row) => total + usageTokenCount(row), 0)).toBe(60)
})

it('rotates shared scan budgets so earlier stores cannot starve later stores', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const other = join(f.root, 'other-native')
  await mkdir(other)
  await writeFile(
    join(f.transcripts, 'first.jsonl'),
    JSON.stringify(nativeClaudeResponse('first')) + '\n',
  )
  await writeFile(
    join(other, 'second.jsonl'),
    JSON.stringify(nativeClaudeResponse('second')) + '\n',
  )
  f.service.close()
  const service = new LocalTranscriptUsageService({
    ...f.options,
    limits: { ...f.options.limits, maxFiles: 2 },
    sources: [
      { id: 'first', driverKind: 'claude', roots: [f.transcripts] },
      { id: 'second', driverKind: 'claude', roots: [other] },
    ],
  })
  cleanup.push(async () => service.close())
  await service.initialize()
  for (let index = 0; index < 6; index++) await service.refresh()
  expect(service.read(query).totals.tokens).toBe(240)
  expect(service.read(query).coverage?.sources.map((source) => source.records)).toEqual([1, 1])
})

it('continues discovering readable siblings after a queued child disappears', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const good = join(f.transcripts, 'good')
  const bad = join(f.transcripts, 'bad')
  await mkdir(good)
  await mkdir(bad)
  const file = join(good, 'native.jsonl')
  await writeFile(file, JSON.stringify(nativeClaudeResponse('good')) + '\n')
  const { walkTranscriptRoot } = await import('../utils/transcript-scan')
  const walker = walkTranscriptRoot(f.transcripts)
  await walker.next()
  await walker.next()
  await walker.next()
  await rm(bad, { recursive: true })
  const remaining = []
  for await (const entry of walker) remaining.push(entry)
  expect(remaining).toContain(file)
  expect(remaining).toContainEqual({ kind: 'error', reason: 'absent' })
})

it('keeps complete JSON without a newline pending until the native writer terminates the record', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const file = join(f.transcripts, 'native.jsonl')
  await writeFile(file, JSON.stringify(nativeClaudeResponse('tail')))
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(0)
  expect(f.service.read(query).coverage?.sources[0]?.status).toBe('partial')
  await appendFile(file, '\n')
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(120)
  expect(f.service.read(query).coverage?.sources[0]?.status).toBe('ready')
})

it('documents the append-only assumption for arbitrary interior edits that preserve both sampled guards', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  const file = join(f.transcripts, 'native.jsonl')
  const padding = JSON.stringify({ type: 'progress', content: 'x'.repeat(1000) }) + '\n'
  await writeFile(file, padding + JSON.stringify(nativeClaudeResponse('old', 20)) + '\n' + padding)
  await f.service.refresh()
  await writeFile(
    file,
    padding +
      JSON.stringify(nativeClaudeResponse('new', 80)) +
      '\n' +
      padding +
      JSON.stringify(nativeClaudeResponse('append')) +
      '\n',
  )
  await f.service.refresh()
  // Native writers append; detecting this unsupported interior edit would require rereading the consumed prefix.
  expect(f.service.read(query).totals.tokens).toBe(240)
  await writeFile(file, padding + JSON.stringify(nativeClaudeResponse('new', 80)) + '\n' + padding)
  await f.service.refresh()
  expect(f.service.read(query).totals.tokens).toBe(180)
})

it.each(
  ['input', 'output', 'cacheRead', 'cacheWrite', 'costUsd', 'reportedCostUsd'].flatMap((field) =>
    ['-1000', '1e999', 'NaN'].map((value) => ({ field, value })),
  ),
)('rejects corrupt saved monetary fields on restart: %j', async ({ field, value }) => {
  const f = await transcriptHistoryFixture(cleanup)
  await writeFile(
    join(f.transcripts, 'native.jsonl'),
    JSON.stringify(nativeClaudeResponse('priced')) + '\n',
  )
  await writeFile(
    join(f.transcripts, 'retained.jsonl'),
    JSON.stringify(nativeClaudeResponse('retained')) + '\n',
  )
  await f.service.refresh()
  f.service.close()
  await rm(join(f.transcripts, 'retained.jsonl'))
  const { Database } = await import('bun:sqlite')
  const database = new Database(join(f.options.cacheDirectory, 'transcript-history.sqlite'))
  const row = database
    .query<{ id: string; value: string }, []>(
      "SELECT id, value FROM files WHERE value LIKE '%native.jsonl%'",
    )
    .get()
  expect(row).toBeDefined()
  if (!row) return
  const corrupted = row.value.replace(new RegExp(`"${field}":[^,}]+`), `"${field}":${value}`)
  expect(corrupted).not.toBe(row.value)
  database.query('UPDATE files SET value = ? WHERE id = ?').run(corrupted, row.id)
  database.close()
  const restarted = new LocalTranscriptUsageService(f.options)
  cleanup.push(async () => restarted.close())
  await restarted.initialize()
  expect(restarted.read(query).totals.tokens).toBe(120)
  expect(restarted.read(query).totals.costUsd).toBeCloseTo(0.00014)
  expect(restarted.read(query).coverage?.status).toBe('pending')
  await restarted.refresh()
  expect(restarted.read(query).totals.tokens).toBe(240)
  expect(restarted.read(query).totals.costUsd).toBeCloseTo(0.00028)
})

it('persists Codex baselines through model changes, cumulative resets and repeated observations', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  const options = {
    ...f.options,
    sources: [{ id: 'codex', driverKind: 'codex' as const, roots: [f.transcripts] }],
  }
  const service = new LocalTranscriptUsageService(options)
  cleanup.push(async () => service.close())
  await service.initialize()
  const file = join(f.transcripts, 'codex.jsonl')
  await writeFile(
    file,
    [
      { type: 'session_meta', payload: { source: 'cli' } },
      { type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-old' } },
      {
        type: 'event_msg',
        timestamp: '2026-10-03T10:00:00Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 8 },
          },
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  await service.refresh()
  service.close()
  const restarted = new LocalTranscriptUsageService(options)
  cleanup.push(async () => restarted.close())
  await restarted.initialize()
  const reset = {
    type: 'event_msg',
    timestamp: '2026-10-03T11:00:00Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 30, output_tokens: 20, reasoning_output_tokens: 2 },
      },
    },
  }
  await appendFile(
    file,
    [
      { type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-new' } },
      {
        type: 'event_msg',
        timestamp: '2026-10-03T10:30:00Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 130, output_tokens: 20, reasoning_output_tokens: 8 },
          },
        },
      },
      { type: 'turn_context', payload: { turn_id: 'turn-2', model: 'gpt-new' } },
      reset,
      reset,
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  await restarted.refresh()
  const report = restarted.read(query)
  expect(report.totals).toMatchObject({ tokens: 200, turns: 2 })
  expect(report.models).toHaveLength(2)
  expect(report.models.reduce((total, row) => total + row.reasoningTokens, 0)).toBe(10)
})
