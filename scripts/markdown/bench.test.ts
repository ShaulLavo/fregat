import { expect, test } from 'vitest'
import { parseBrowserBenchmarkLog } from './bench-browser'
import {
  benchmarkStreamUnits,
  completedTrial,
  referenceTrial,
  streamingTrials,
} from './bench-native'
import { runMarkdownBenchmarks } from './bench-run'
import { readyRemarkExtensions } from '../../packages/markdown/test/qualification'
import { percentile, summarizeBenchmarks, type BenchmarkSample } from './bench-types'
import {
  BENCHMARK_FAMILIES,
  BENCHMARK_PROFILES,
  fixedChunks,
  mixedWorkload,
  pathologicalWorkloads,
  referenceRevisions,
  timelineWorkloads,
} from './workloads'

test('workloads retain exact byte scales and reproducible large shapes', () => {
  for (const bytes of [1024, 8192, 1048576]) {
    const workloads = pathologicalWorkloads(bytes)
    expect(workloads).toHaveLength(6)
    expect(workloads.every((entry) => entry.sourceBytes === bytes)).toBe(true)
    expect(workloads).toEqual(pathologicalWorkloads(bytes))
  }
  expect(mixedWorkload(256).sourceBytes).toBe(256)
  expect(BENCHMARK_FAMILIES).toHaveLength(9)
  expect(BENCHMARK_PROFILES.promotion.trials).toBeGreaterThanOrEqual(20)
})

test('fixed schedules yield lazily and include the full final source exactly once', () => {
  const source = '0123456789'
  const frames = fixedChunks(source, 3)
  expect(Array.isArray(frames)).toBe(false)
  expect(Array.from(frames)).toEqual([
    { offset: 3, text: '012' },
    { offset: 6, text: '012345' },
    { offset: 9, text: '012345678' },
    { offset: 10, text: source },
  ])
  expect(Array.from(fixedChunks(source, 10))).toEqual([{ offset: 10, text: source }])
})

test('reference workloads exercise addition, edit, removal and definition-before-use', () => {
  const frames = referenceRevisions()
  expect(frames.map((frame) => frame.id)).toEqual([
    'unresolved',
    'late-definition',
    'edited-definition',
    'removed-definition',
    'early-definition',
  ])
  expect(frames[0]?.source).toEqual(frames[3]?.source)
  expect(frames[4]?.source.startsWith('[target]:')).toBe(true)
  expect(timelineWorkloads(500, 'one message')).toHaveLength(500)
})

const record = {
  family: 'warm-completed',
  fixture: 'plain',
  revision: 1,
  field: 'completedToPaintMs',
  sample: 12,
  unit: 'ms',
  sourceBytes: 123,
  outputMatches: true,
  build: 'development',
  engine: 'remark',
  trial: 0,
  cacheState: 'warm',
}

test('browser records preserve their build and actual output coverage', () => {
  const records = parseBrowserBenchmarkLog(
    `unrelated test output\n  MARKDOWN_BROWSER_METRIC ${JSON.stringify(record)}\n`,
  )
  expect(records).toEqual([{ ...record, domain: 'browser' }])
  expect(parseBrowserBenchmarkLog('no records')).toEqual([])
})

test('invalid and fabricated browser record boundaries fail', () => {
  for (const invalid of [
    { ...record, engine: 'candidate' },
    { ...record, family: 'parse-as-paint' },
    { ...record, sample: '12' },
    { ...record, outputMatches: undefined },
    { ...record, unit: 'fps' },
  ]) {
    expect(() =>
      parseBrowserBenchmarkLog(`MARKDOWN_BROWSER_METRIC ${JSON.stringify(invalid)}`),
    ).toThrow()
  }
})

test('summaries keep native and painted work separate and expose failed output', () => {
  const base = {
    ...record,
    family: 'warm-completed',
    build: 'development',
    engine: 'remark',
    unit: 'ms',
  } satisfies Omit<BenchmarkSample, 'domain'>
  const samples: BenchmarkSample[] = [
    { ...base, domain: 'browser', sample: 10, trial: 0 },
    { ...base, domain: 'browser', sample: 20, trial: 1, outputMatches: false },
    { ...base, domain: 'native', sample: 1, trial: 0, field: 'nativeUpdateMs' },
  ]
  const summaries = summarizeBenchmarks(samples)
  expect(summaries).toHaveLength(2)
  expect(summaries[0]).toMatchObject({
    p50: 10,
    p95: 20,
    independentTrials: 2,
    outputMatches: false,
  })
  expect(summaries[1]).toMatchObject({ domain: 'native', p95: 1 })
  expect(percentile([1, 2, 3], 0.95)).toBe(3)
})

test('real native sessions settle streamed source and reuse completed block projections', async () => {
  const extensions = await readyRemarkExtensions()
  const source = 'First paragraph.\n\n**Second paragraph**'
  const entry = {
    id: 'native-proof',
    source,
    shape: 'proof',
    sourceBytes: Buffer.byteLength(source),
  }
  const complete = completedTrial({
    family: 'warm-completed',
    workload: entry,
    trial: 0,
    extensions,
  })
  const stream = streamingTrials({
    family: 'streaming-replay',
    workload: entry,
    trial: 0,
    extensions,
  })
  expect(complete.failures).toEqual([])
  expect(stream.failures).toEqual([])
  expect(
    stream.samples
      .filter((sample) => sample.field === 'settlementMs')
      .every((sample) => sample.outputMatches),
  ).toBe(true)
  expect(stream.samples.some((sample) => (sample.detail?.reusedBlocks ?? 0) > 0)).toBe(true)
  expect(
    stream.samples
      .filter((sample) => sample.field === 'nativeUpdateMs')
      .every((sample) => sample.outputMatches === null),
  ).toBe(true)
  expect(referenceTrial({ trial: 0, extensions }).failures).toEqual([])
})

test('large streaming matrix has bounded schedules and preserves unqualified cells', () => {
  expect(benchmarkStreamUnits(8192)).toEqual([1, 8, 24, 64, 256])
  expect(benchmarkStreamUnits(131072)).toEqual([24, 64, 256])
})

test('filters cannot turn missing candidate or omitted families into qualification', async () => {
  const report = await runMarkdownBenchmarks({
    mode: 'quick',
    families: [],
    fixtureIds: ['plain-paragraph'],
  })
  expect(report.verdict).toBe('NOT VERIFIED')
  expect(report.candidate.status).toBe('NOT_MEASURED')
  expect(report.pairedQualification.status).toBe('NOT_MEASURED')
  expect(report.families).toHaveLength(9)
  expect(report.families.every((family) => family.status === 'NOT_MEASURED')).toBe(true)
})
