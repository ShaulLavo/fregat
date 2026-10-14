import { execFile } from 'node:child_process'
import { hash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import { readyRemarkExtensions } from '../../packages/markdown/test/qualification'
import { createScriptError } from '../structured-errors'
import { parseBrowserBenchmarkLog } from './bench-browser'
import { coldTrial } from './bench-cold'
import {
  collectGarbage,
  benchmarkStreamUnits,
  completedTrial,
  referenceTrial,
  resourcesTrial,
  streamingTrials,
  type NativeTrial,
} from './bench-native'
import {
  summarizeBenchmarks,
  type BenchmarkReport,
  type BenchmarkSample,
  type FamilyResult,
  type MissingMeasurement,
} from './bench-types'
import {
  BENCHMARK_FAMILIES,
  BENCHMARK_PROFILES,
  mixedWorkload,
  pathologicalWorkloads,
  referenceRevisions,
  STREAM_UNITS,
  workload,
  type BenchmarkFamily,
  type BenchmarkMode,
  type Workload,
} from './workloads'

const execute = promisify(execFile)
const checkout = fileURLToPath(new URL('../../', import.meta.url))

export type BenchmarkOptions = {
  readonly mode: BenchmarkMode
  readonly families?: readonly BenchmarkFamily[]
  readonly fixtureIds?: readonly string[]
  readonly browserLog?: string
}

const BROWSER_FIELDS: Record<BenchmarkFamily, readonly string[]> = {
  'cold-mount': ['firstMeaningfulPaintMs', 'fullyReadyPaintMs', 'assetFetchDecodeMs'],
  'warm-completed': ['reactCommitMs', 'layoutPaintMs', 'completedToPaintMs'],
  'streaming-replay': [
    'receiptToMatchingPaintMs',
    'heldReleasePaintMs',
    'mainThreadCpuMs',
    'deferredUpdates',
  ],
  'pathological-scaling': ['largeMessagePaintMs', 'worstFrameDelayMs'],
  'reference-invalidation': ['earlierLinkPaintMs', 'domReplacements'],
  'highlighting-extensions': ['highlighterMs', 'extensionLoaderMs', 'combinedReadyPaintMs'],
  'timeline-input': [
    'timelineReadyPaintMs',
    'inputToPaintMs',
    'longTasks',
    'frameDelayMs',
    'scrollDriftPx',
    'renderCounts',
  ],
  resources: [
    'jsLiveHeapBytes',
    'wasmReservedHeapBytes',
    'workerCount',
    'retainedBuffers',
    'highWaterReuse',
  ],
  payload: [
    'transferredHostBytes',
    'transferredGrammarBytes',
    'transferredResolverBytes',
    'transferredJsBytes',
    'lazyAssetRequests',
  ],
}

export async function runMarkdownBenchmarks(options: BenchmarkOptions): Promise<BenchmarkReport> {
  const startedAt = new Date().toISOString()
  const prepared = prepareWorkloads(options)
  const selectedFamilies = options.families ?? BENCHMARK_FAMILIES
  const profile = BENCHMARK_PROFILES[options.mode]
  const extensions = await readyRemarkExtensions()
  const rawSamples: BenchmarkSample[] = []
  const nativeFailures = new Map<BenchmarkFamily, string[]>()
  for (const family of selectedFamilies) {
    for (let trial = -profile.warmups; trial < profile.trials; trial += 1) {
      const result = await runFamily({
        family,
        prepared,
        trial,
        extensions,
        cycles: profile.cycleCounts,
      })
      if (trial < 0) continue
      for (const sample of result.samples) rawSamples.push(sample)
      nativeFailures.set(family, (nativeFailures.get(family) ?? []).concat(result.failures))
    }
  }
  const browserSamples = options.browserLog ? parseBrowserBenchmarkLog(options.browserLog) : []
  for (const sample of browserSamples) {
    if (selectedFamilies.includes(sample.family)) rawSamples.push(sample)
  }
  const families = BENCHMARK_FAMILIES.map((family) =>
    familyResult(family, rawSamples, nativeFailures.get(family) ?? []),
  )
  const [revision, lockfile, diff] = await Promise.all([
    execute('git', ['rev-parse', 'HEAD'], { cwd: checkout }).then((result) => result.stdout.trim()),
    readFile(new URL('../../bun.lock', import.meta.url)),
    execute('git', ['diff', 'HEAD', '--', 'packages/markdown', 'scripts/markdown'], {
      cwd: checkout,
      maxBuffer: 16 * 1024 * 1024,
    }).then((result) => result.stdout),
  ])
  return {
    schemaVersion: 1,
    verdict: 'NOT VERIFIED',
    mode: options.mode,
    candidate: missing(
      ['semanticProducer', 'candidateTiming'],
      'The candidate has no renderer-neutral semantic API. Remark is measured only as the baseline.',
    ),
    pairedQualification: missing(
      ['pairedTrials', 'pairedConfidenceInterval', 'promotionBudgetVerdict'],
      'No candidate was run. Native and development-browser timings are exploratory; promotion needs a pinned production build and identified timing host.',
    ),
    metadata: {
      startedAt,
      finishedAt: new Date().toISOString(),
      revision,
      lockfileSha256: hash('sha256', lockfile, 'hex'),
      trackedDiffSha256: hash('sha256', diff, 'hex'),
      workloadSources: prepared.all.map((entry) => ({
        id: entry.id,
        sourceBytes: entry.sourceBytes,
        sha256: hash('sha256', entry.source, 'hex'),
      })),
      runtime: `${process.release.name} ${process.version}${typeof Bun === 'undefined' ? '' : `; Bun ${Bun.version}`}`,
      platform: process.platform,
      architecture: process.arch,
      hardware: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      trials: profile.trials,
      warmups: profile.warmups,
      timingStatus: 'EXPLORATORY',
      gcAvailable: typeof Bun !== 'undefined',
      measurementBoundary:
        'Native update timers cover the real incremental remark session with healing, then safe HAST conversion with block-identity reuse. They exclude source generation, inspection, independent equality checks, JSX, React, workers and paint. Native CPU sums cover those same timed updates. Resources include session creation, update, output inspection and release. Fresh-process timings include module import, loaded HTML/math plugins, parser and HAST; filesystem caches are uncontrolled. Browser records carry their own real-component field names and build/cache state.',
      wasm: missing(
        ['wasmHash', 'wasmInitialization', 'wasmHeap'],
        'Only remark was executed; its package parsing path has no WASM grammar.',
      ),
      browser: options.browserLog
        ? {
            status: 'EXPLORATORY',
            records: browserSamples.length,
            logSha256: hash('sha256', options.browserLog, 'hex'),
          }
        : missing(
            ['browserMetrics'],
            'Pass --browser-log from the real AssistantMarkdown browser benchmark. Native timings cannot establish paint, input or transferred payload.',
          ),
    },
    families,
    unmeasuredCells: prepared.stream.flatMap((entry) =>
      STREAM_UNITS.filter((units) => !benchmarkStreamUnits(entry.sourceBytes).includes(units)).map(
        (units) => ({
          family: 'streaming-replay',
          fixture: entry.id,
          schedule: `fixed-${units}`,
          status: 'NOT_MEASURED',
          reason:
            'The bounded promotion matrix runs 1/8-unit schedules through 8 KiB; large messages use 24-unit and larger updates. This cell is unqualified.',
        }),
      ),
    ),
    rawSamples,
    summaries: summarizeBenchmarks(rawSamples),
    resources: {
      created: selectedFamilies.includes('cold-mount')
        ? [
            'One bounded fresh child process per cold trial; no sockets, servers or browser profiles',
          ]
        : [],
      cleanup: [
        'Cold children are awaited and terminated on timeout, SIGINT and SIGTERM; abort listeners are removed in finally',
        'Native message sessions leave scope after each trial; resource batches clear source before releasing sessions',
        `Explicit GC ${collectGarbage() ? 'completed' : 'unavailable; heap observations remain uncollected'}`,
      ],
      retained: [
        'The returned report contains raw samples and source hashes; the caller owns report retention',
      ],
    },
  }
}

type Prepared = ReturnType<typeof prepareWorkloads>
type RunInput = {
  family: BenchmarkFamily
  prepared: Prepared
  trial: number
  extensions: Awaited<ReturnType<typeof readyRemarkExtensions>>
  cycles: readonly number[]
}

async function runFamily(input: RunInput): Promise<NativeTrial> {
  const base = { trial: input.trial, extensions: input.extensions }
  switch (input.family) {
    case 'cold-mount':
      return combineTrials(await sequentialCold(input.prepared.cold, base))
    case 'warm-completed':
      return combineTrials(
        input.prepared.warm.map((entry) =>
          completedTrial({ ...base, family: 'warm-completed', workload: entry }),
        ),
      )
    case 'streaming-replay':
      return combineTrials(
        input.prepared.stream.map((entry) =>
          streamingTrials({ ...base, family: 'streaming-replay', workload: entry }),
        ),
      )
    case 'pathological-scaling':
      return combineTrials(
        input.prepared.pathological.flatMap((entry) => [
          completedTrial({ ...base, family: 'pathological-scaling', workload: entry }),
          streamingTrials({ ...base, family: 'pathological-scaling', workload: entry }),
        ]),
      )
    case 'reference-invalidation':
      return referenceTrial(base)
    case 'highlighting-extensions':
      return combineTrials(
        input.prepared.extensions.map((entry) =>
          completedTrial({ ...base, family: 'highlighting-extensions', workload: entry }),
        ),
      )
    case 'resources':
      return combineTrials(
        input.cycles.map((cycles) =>
          resourcesTrial({ ...base, cycles, workload: input.prepared.resource }),
        ),
      )
    case 'timeline-input':
    case 'payload':
      return { samples: [], failures: [] }
    default: {
      const exhaustive: never = input.family
      return exhaustive
    }
  }
}

async function sequentialCold(
  entries: readonly Workload[],
  base: { trial: number; extensions: Awaited<ReturnType<typeof readyRemarkExtensions>> },
): Promise<NativeTrial[]> {
  const results: NativeTrial[] = []
  for (const entry of entries) results.push(await coldTrial({ ...base, workload: entry }))
  return results
}

function combineTrials(results: readonly NativeTrial[]): NativeTrial {
  return {
    samples: results.flatMap((result) => result.samples),
    failures: results.flatMap((result) => result.failures),
  }
}

function prepareWorkloads(options: BenchmarkOptions) {
  const profile = BENCHMARK_PROFILES[options.mode]
  const availableGenerated = profile.completedBytes
    .map(mixedWorkload)
    .concat(profile.pathologicalBytes.flatMap(pathologicalWorkloads))
  const selected = options.fixtureIds
    ? MARKDOWN_CASES.filter((entry) => options.fixtureIds?.includes(entry.id))
    : MARKDOWN_CASES.slice(0, 8)
  const generatedSelection = options.fixtureIds
    ? availableGenerated.filter((entry) => options.fixtureIds?.includes(entry.id))
    : []
  if (selected.length === 0 && generatedSelection.length === 0)
    throw createScriptError('No benchmark fixtures match the requested ids', {
      internal: { requestedCount: options.fixtureIds?.length ?? 0 },
    })
  const unknown =
    options.fixtureIds?.filter(
      (id) =>
        !selected.some((entry) => entry.id === id) &&
        !generatedSelection.some((entry) => entry.id === id),
    ) ?? []
  if (unknown.length > 0)
    throw createScriptError('Some benchmark fixture ids are unknown', {
      internal: { unknownCount: unknown.length },
    })
  const curated = selected.map((entry) => workload(entry.id, entry.source, 'curated-corpus'))
  const requested = Array.from(
    new Map(curated.concat(generatedSelection).map((entry) => [entry.id, entry])).values(),
  )
  const generated = options.fixtureIds ? [] : profile.completedBytes.map(mixedWorkload)
  const warm = options.fixtureIds ? requested : curated.concat(generated)
  const stream = (options.fixtureIds ? requested : curated)
    .slice(0, options.fixtureIds ? curated.length : 4)
    .concat(options.fixtureIds ? [] : profile.streamBytes.map(mixedWorkload))
  const pathological = options.fixtureIds
    ? requested
    : profile.pathologicalBytes.flatMap(pathologicalWorkloads)
  const cold = options.fixtureIds
    ? requested.filter((entry) => entry.sourceBytes <= 8192).slice(0, 4)
    : namedWorkloads([
        'plain-paragraph',
        'fenced-typescript',
        'html-details',
        'math-display-fallback',
      ])
  const extensions = options.fixtureIds
    ? requested
    : namedWorkloads([
        'fenced-typescript',
        'unknown-fence-language',
        'html-details',
        'math-display-fallback',
        'math-inline-fallback',
      ])
  const resource = requested[0] ?? curated[0] ?? mixedWorkload(256)
  const references = referenceRevisions().map((entry) =>
    workload(entry.id, entry.source, 'reference-edits'),
  )
  const all = Array.from(
    new Map(
      warm
        .concat(stream, pathological, extensions, references, cold)
        .map((entry) => [entry.id, entry]),
    ).values(),
  )
  return {
    cold,
    warm,
    stream,
    pathological,
    extensions,
    resource,
    all,
  }
}

function namedWorkloads(ids: readonly string[]): Workload[] {
  return ids.map((id) => {
    const entry = MARKDOWN_CASES.find((candidate) => candidate.id === id)
    if (!entry)
      throw createScriptError('A required benchmark fixture is missing', {
        internal: { fixtureId: id },
      })
    return workload(entry.id, entry.source, 'curated-corpus')
  })
}

function familyResult(
  family: BenchmarkFamily,
  samples: readonly BenchmarkSample[],
  failures: readonly string[],
): FamilyResult {
  const measured = samples.filter((sample) => sample.family === family)
  const fields = Array.from(new Set(measured.map((sample) => `${sample.domain}.${sample.field}`)))
  const browserFields = new Set(
    measured.filter((sample) => sample.domain === 'browser').map((sample) => sample.field),
  )
  const missingBrowserFields = BROWSER_FIELDS[family].filter((field) => !browserFields.has(field))
  const missingFields =
    missingBrowserFields.length > 0
      ? [
          missing(
            missingBrowserFields,
            'This field has no actual browser measurement in the supplied log. Native work is reported separately.',
          ),
        ]
      : []
  const incorrect = measured
    .filter((sample) => sample.outputMatches === false)
    .map((sample) => `${sample.fixture}/${sample.field}: output coverage failed`)
  const allFailures = failures.concat(incorrect)
  const status =
    allFailures.length > 0 ? 'FAILED' : measured.length > 0 ? 'BASELINE_ONLY' : 'NOT_MEASURED'
  return {
    family,
    status,
    measurements: fields,
    missing: missingFields.concat(
      family === 'streaming-replay'
        ? [
            missing(
              ['nativePerPrefixEquality'],
              'Native benchmark receipts observe every output and independently check final equality. Rich prefix correctness is run by markdown:stream; prefix timing rows use outputMatches:null until compared with an oracle.',
            ),
          ]
        : [],
      [
        missing(
          ['candidatePairedComparison'],
          'A baseline receipt cannot qualify the missing candidate.',
        ),
      ],
    ),
    failures: Array.from(new Set(allFailures)),
  }
}

function missing(fields: readonly string[], reason: string): MissingMeasurement {
  return { status: 'NOT_MEASURED', fields, reason }
}
