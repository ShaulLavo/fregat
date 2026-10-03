import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { ProviderTranscriptCollection } from '../transcript-collection'
import { systemErrors } from '../../system/structured-errors'
import { transcriptHistoryFixture, nativeClaudeResponse } from '../../testing/transcript-usage'

const cleanup: Array<() => Promise<void>> = []
const query = { days: 7 as const, utcOffsetMinutes: 0 }
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.useRealTimers()
})

test('lifecycle scans start independently of reads, follow the configured cadence and stop on close', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  const file = join(f.transcripts, 'native.jsonl')
  await writeFile(file, JSON.stringify(nativeClaudeResponse('one')) + '\n')
  const collector = new ProviderTranscriptCollection(
    () => f.options,
    () => 60_000,
  )
  cleanup.push(() => collector.close())
  await collector.initialize()
  expect(collector.read(query).totals.tokens).toBe(0)
  vi.useFakeTimers()
  collector.start()
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => expect(collector.read(query).totals.tokens).toBe(120))
  expect(vi.getTimerCount()).toBe(1)
  await appendFile(file, JSON.stringify(nativeClaudeResponse('two')) + '\n')
  await vi.advanceTimersByTimeAsync(59_000)
  expect(collector.read(query).totals.tokens).toBe(120)
  await vi.advanceTimersByTimeAsync(1000)
  await vi.waitFor(() => expect(collector.read(query).totals.tokens).toBe(240))
  expect(vi.getTimerCount()).toBe(1)
  await collector.close()
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(vi.getTimerCount()).toBe(0)
})

test('refresh changes configured native roots without mixing the previous source into the new snapshot', async () => {
  const f = await transcriptHistoryFixture(cleanup)
  f.service.close()
  await writeFile(
    join(f.transcripts, 'old.jsonl'),
    JSON.stringify(nativeClaudeResponse('old', 80)) + '\n',
  )
  let sources = f.options.sources
  const collector = new ProviderTranscriptCollection(
    () => ({ ...f.options, sources }),
    () => 60_000,
  )
  cleanup.push(() => collector.close())
  await collector.refresh()
  expect(collector.read(query).totals.tokens).toBe(180)
  const replacement = join(f.root, 'replacement')
  await mkdir(replacement)
  await writeFile(
    join(replacement, 'new.jsonl'),
    JSON.stringify(nativeClaudeResponse('new')) + '\n',
  )
  sources = [{ id: 'new-native-home', driverKind: 'claude', roots: [replacement] }]
  expect(collector.read(query).totals.tokens).toBe(180)
  await collector.refresh()
  expect(collector.read(query).totals.tokens).toBe(120)
  expect(collector.read(query).coverage.sources.map((source) => source.id)).toEqual([
    'new-native-home',
  ])
})

test('defers transcript configuration until initialize and closes safely without identity', async () => {
  let reads = 0
  const failure = systemErrors.MACHINE_ID_UNAVAILABLE({
    internal: { platform: 'darwin', exitCode: 1 },
  })
  const options = () => {
    reads += 1
    throw failure
  }
  const unopened = new ProviderTranscriptCollection(options, () => 60_000)
  cleanup.push(() => unopened.close())
  expect(unopened.read(query)).toMatchObject({
    totals: { tokens: 0 },
    coverage: { status: 'pending', scannedAt: null, sources: [] },
  })
  await expect(unopened.close()).resolves.toBeUndefined()
  await expect(unopened.initialize()).resolves.toBeUndefined()
  expect(reads).toBe(0)
  const failed = new ProviderTranscriptCollection(options, () => 60_000)
  cleanup.push(() => failed.close())
  await expect(failed.initialize()).rejects.toBe(failure)
  expect(reads).toBe(1)
  expect(failed.read(query).coverage.status).toBe('pending')
  await expect(failed.close()).resolves.toBeUndefined()
})
