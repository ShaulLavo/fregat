import { execFile } from 'node:child_process'
import { hash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { cpus, hostname } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import * as v from 'valibot'
import type { MarkdownBlock } from '../../packages/markdown/src/utils/blocks'
import { blockToHast, createHastProcessor } from '../../packages/markdown/src/utils/hast'
import type { MarkdownSession } from '../../packages/markdown/src/utils/session'
import { readyRemarkExtensions } from '../../packages/markdown/test/qualification'
import { createScriptError } from '../structured-errors'
import { percentile } from './bench-types'
import { qualificationProvenance } from './provenance'
import {
  nativeCapturePlan as nativeCapturePlanSchema,
  nativeShardSelections,
  productionShard,
  type ProductionShard,
} from './production-shards'
import { writeJsonl, type RawTimingRef } from './timing-artifacts'
import frozenBudget from './promotion-budget.json'
import { metricBudget } from './promotion'
import {
  BENCHMARK_PROFILES,
  fixedChunks,
  mixedWorkload,
  pathologicalWorkloads,
  referenceRevisions,
  type BenchmarkFamily,
  type Workload,
} from './workloads'

export type PairedMetric = 'updateP95' | 'settlementP95' | 'mountP95' | 'streamCpu'
export type PairOrder = readonly ['remark', 'tree-sitter'] | readonly ['tree-sitter', 'remark']
export type NativePairWorkload = Workload & {
  readonly family: BenchmarkFamily
  readonly scheduleUnits: number
  readonly revisions?: readonly string[]
}
export type NativeRevision = {
  readonly revision: number
  readonly offset: number
  readonly phase: 'update' | 'settlement'
  readonly parseMs: number
  readonly projectionMs: number
  readonly wallMs: number
  readonly cpuMs: number
  readonly convertedBlocks: number
  readonly reusedBlocks: number
  readonly outputDigest: string
  readonly sourceCoordinatesDigest: string
  readonly sourceCoordinateFailures: readonly string[]
  readonly positionedNodes: number
  readonly unchangedProjection: boolean
}
export type NativeTrial = {
  readonly engine: PairOrder[number]
  readonly trial: number
  readonly mountMs: number
  readonly streamCpuMs: number
  readonly revisions: readonly NativeRevision[]
}
export type PairedComparison = {
  readonly domain: 'native'
  readonly build: 'source'
  readonly workload: string
  readonly metric: PairedMetric
  readonly independentTrials: number
  readonly baselineMs: number
  readonly candidateMs: number
  readonly ratio: number
  readonly allowanceMs: number
  readonly confidence: 0.95
  readonly resamples: number
  readonly lowerMarginMs: number
  readonly upperMarginMs: number
  readonly status: 'passed' | 'failed' | 'inconclusive'
}
type NativePair = {
  readonly trial: number
  readonly order: PairOrder
  readonly remark: NativeTrial
  readonly candidate: NativeTrial
  readonly mismatchedRevisions: readonly number[]
}
export type PairedNativeOptions = {
  readonly output: string
  readonly mode: 'quick' | 'qualification'
  readonly seed?: number
  readonly fixtureIds?: readonly string[]
  readonly capture?: {
    readonly plan: string
    readonly index: number
    readonly launchId: string
  }
}
export type NativeShard = ProductionShard

type NativePairRecord = {
  readonly workload: NativePairWorkload['id']
  readonly pair: NativePair
}
export type NativeWorkloadSummary = Pick<
  NativePairWorkload,
  'id' | 'family' | 'sourceBytes' | 'scheduleUnits'
> & {
  readonly sourceSha256: string
  readonly comparisons: readonly PairedComparison[]
  readonly observedPairs: number
  readonly mismatchedPairs: number
}

type BenchmarkSession = MarkdownSession & { dispose?(): void }
type SessionFactory = () => BenchmarkSession
type Extensions = Parameters<typeof createHastProcessor>[0]
type Root = ReturnType<typeof blockToHast>

export function pairedTrialOrders(count: number, seed: number): PairOrder[] {
  requireInteger(count, 'trial count', 1)
  requireInteger(seed, 'seed', 0)
  const firstCandidate = seeded(seed)() >= 0.5
  return Array.from({ length: count }, (_, index) => {
    const candidateFirst = (index % 2 === 0) === firstCandidate
    return candidateFirst ? ['tree-sitter', 'remark'] : ['remark', 'tree-sitter']
  })
}

type ProjectionNode = Root['children'][number]
type RenderedNode =
  | {
      readonly type: 'element'
      readonly tagName: string
      readonly properties: unknown
      readonly children: readonly RenderedNode[]
    }
  | { readonly type: 'text' | 'comment' | 'raw'; readonly value: string }
  | { readonly type: 'doctype' }

export function digestProjection(root: Root): string {
  return hash('sha256', JSON.stringify(canonicalProjection(root)), 'hex')
}

export function canonicalProjection(root: Root) {
  return { type: 'root', children: renderedChildren(root.children) }
}

function renderedChildren(children: readonly ProjectionNode[]): RenderedNode[] {
  const observed: RenderedNode[] = []
  for (const child of children) {
    const node = renderedNode(child)
    const prior = observed.at(-1)
    if (node.type === 'text' && prior?.type === 'text') {
      observed[observed.length - 1] = { type: 'text', value: prior.value + node.value }
      continue
    }
    observed.push(node)
  }
  return observed
}

function renderedNode(node: ProjectionNode): RenderedNode {
  if (node.type === 'element')
    return {
      type: 'element',
      tagName: node.tagName,
      properties: orderedValue(node.properties),
      children: renderedChildren(node.children),
    }
  if (node.type === 'doctype') return { type: 'doctype' }
  return { type: node.type, value: node.value }
}

export function inspectSourceCorrespondence(root: Root, source: string) {
  const lines = sourceLineStarts(source)
  const coordinates: unknown[] = []
  const failures: string[] = []
  inspectNodeSource(root, 'root', source.length, lines, coordinates, failures)
  return {
    sourceCoordinatesDigest: hash('sha256', JSON.stringify(coordinates), 'hex'),
    sourceCoordinateFailures: failures,
    positionedNodes: coordinates.length,
  }
}

function inspectNodeSource(
  node: Root | ProjectionNode,
  path: string,
  units: number,
  lines: readonly number[],
  coordinates: unknown[],
  failures: string[],
) {
  const position = node.position
  if (position) {
    coordinates.push({ path, type: node.type, position })
    checkPoint(position.start, `${path}.start`, units, lines, failures)
    checkPoint(position.end, `${path}.end`, units, lines, failures)
    if (
      position.start.offset !== undefined &&
      position.end.offset !== undefined &&
      position.end.offset < position.start.offset
    )
      failures.push(`${path}: reversed source bounds.`)
  }
  if (node.type === 'element') checkSourceLines(node, path, failures)
  if (!('children' in node)) return
  for (const [index, child] of node.children.entries())
    inspectNodeSource(child, `${path}.${index}`, units, lines, coordinates, failures)
}

function checkPoint(
  point: NonNullable<ProjectionNode['position']>['start'],
  path: string,
  units: number,
  lines: readonly number[],
  failures: string[],
) {
  const offset = point.offset
  if (offset === undefined || !Number.isSafeInteger(offset) || offset < 0 || offset > units) {
    failures.push(`${path}: source offset is absent or outside projection text.`)
    return
  }
  const lineIndex = Number.isSafeInteger(point.line) ? point.line - 1 : -1
  const start = lines[lineIndex]
  const next = lines[lineIndex + 1]
  if (
    start === undefined ||
    offset < start ||
    (next !== undefined && offset >= next) ||
    point.column !== offset - start + 1
  )
    failures.push(`${path}: UTF-16 offset disagrees with its source line or column.`)
}

function checkSourceLines(
  node: Extract<ProjectionNode, { type: 'element' }>,
  path: string,
  failures: string[],
) {
  const start = node.properties.dataSourceLine
  const end = node.properties.dataSourceEndLine
  if (start === undefined && end === undefined) return
  if (!node.position || start !== node.position.start.line || end !== node.position.end.line)
    failures.push(`${path}: published source-line mapping disagrees with node coordinates.`)
}

function sourceLineStarts(source: string) {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character !== '\r' && character !== '\n') continue
    if (character === '\r' && source[index + 1] === '\n') index += 1
    starts.push(index + 1)
  }
  return starts
}

export function pairedConfidence(input: {
  readonly workload: string
  readonly metric: PairedMetric
  readonly baseline: readonly number[]
  readonly candidate: readonly number[]
  readonly seed: number
  readonly resamples: number
}): PairedComparison {
  const { baseline, candidate } = input
  if (baseline.length === 0 || baseline.length !== candidate.length)
    throw createScriptError('Paired measurements require equal nonempty trial vectors', {
      internal: { baselineTrials: baseline.length, candidateTrials: candidate.length },
    })
  if (baseline.concat(candidate).some((value) => !Number.isFinite(value) || value < 0))
    throw createScriptError('Paired timings must be finite nonnegative values', {
      internal: { metric: input.metric },
    })
  requireInteger(input.resamples, 'bootstrap resamples', 100)
  requireInteger(input.seed, 'seed', 0)
  const { ratio, allowanceMs } = metricBudget(input.metric)
  const baselineMs = percentile(baseline, 0.95)
  const candidateMs = percentile(candidate, 0.95)
  const random = seeded(input.seed)
  const margins = Array.from({ length: input.resamples }, () =>
    bootstrapMargin(baseline, candidate, ratio, allowanceMs, random),
  )
  const lowerMarginMs = percentile(margins, 0.025)
  const upperMarginMs = percentile(margins, 0.975)
  let status: PairedComparison['status'] = 'inconclusive'
  if (lowerMarginMs > 0) status = 'failed'
  if (baseline.length >= frozenBudget.independentPairedTrials && upperMarginMs <= 0)
    status = 'passed'
  return {
    domain: 'native',
    build: 'source',
    workload: input.workload,
    metric: input.metric,
    independentTrials: baseline.length,
    baselineMs,
    candidateMs,
    ratio,
    allowanceMs,
    confidence: 0.95,
    resamples: input.resamples,
    lowerMarginMs,
    upperMarginMs,
    status,
  }
}

function bootstrapMargin(
  baseline: readonly number[],
  candidate: readonly number[],
  ratio: number,
  allowance: number,
  random: () => number,
) {
  const indexes = Array.from({ length: baseline.length }, () =>
    Math.floor(random() * baseline.length),
  )
  return (
    percentile(
      indexes.map((index) => candidate[index]),
      0.95,
    ) -
    percentile(
      indexes.map((index) => baseline[index]),
      0.95,
    ) *
      ratio -
    allowance
  )
}

export function nativePairWorkloads(mode: PairedNativeOptions['mode']): NativePairWorkload[] {
  const profile = BENCHMARK_PROFILES[mode === 'quick' ? 'quick' : 'promotion']
  const completed: NativePairWorkload[] = profile.completedBytes.map((bytes) => ({
    ...mixedWorkload(bytes),
    id: `completed-mixed-${bytes}`,
    family: 'warm-completed' as const,
    scheduleUnits: 0,
  }))
  const streaming: NativePairWorkload[] = profile.streamBytes.flatMap((bytes) => {
    const units = bytes <= 8192 ? [1, 8, 24, 64, 256] : [24, 64, 256]
    return units.map((scheduleUnits) => ({
      ...mixedWorkload(bytes),
      id: `stream-mixed-${bytes}/${scheduleUnits}`,
      family: 'streaming-replay' as const,
      scheduleUnits,
    }))
  })
  const pathological: NativePairWorkload[] = profile.pathologicalBytes.flatMap((bytes) =>
    pathologicalWorkloads(bytes).flatMap((entry) => [
      {
        ...entry,
        id: `completed-${entry.id}`,
        family: 'pathological-scaling' as const,
        scheduleUnits: 0,
      },
      {
        ...entry,
        id: `stream-${entry.id}/4096`,
        family: 'pathological-scaling' as const,
        scheduleUnits: 4096,
      },
    ]),
  )
  const references = referenceRevisions()
  const referenceSource = references.at(-1)?.source ?? ''
  return completed.concat(streaming, pathological, [
    {
      id: 'reference-revisions',
      source: referenceSource,
      sourceBytes: Buffer.byteLength(referenceSource),
      shape: 'reference-edits',
      family: 'reference-invalidation',
      scheduleUnits: 0,
      revisions: references.map((entry) => entry.source),
    },
  ])
}

export function runNativeTrial(input: {
  readonly factory: SessionFactory
  readonly engine: PairOrder[number]
  readonly trial: number
  readonly workload: NativePairWorkload
  readonly extensions: Extensions
}): NativeTrial {
  const cpuStart = process.cpuUsage()
  const createdAt = performance.now()
  const session = input.factory()
  const processor = createHastProcessor(input.extensions)
  const creationMs = performance.now() - createdAt
  const creationCpuMs = usedCpu(cpuStart)
  const projections = new WeakMap<MarkdownBlock, Root>()
  const revisions: NativeRevision[] = []
  let priorDigest: string | null = null
  try {
    for (const frame of workloadFrames(input.workload)) {
      const result = measureRevision(session, processor, projections, frame)
      const outputDigest = digestProjection(result.root)
      const sourceCorrespondence = inspectSourceCorrespondence(result.root, result.projectionSource)
      const { root: _root, projectionSource: _projectionSource, ...measured } = result
      revisions.push({
        ...measured,
        revision: revisions.length,
        outputDigest,
        ...sourceCorrespondence,
        unchangedProjection: priorDigest === outputDigest,
      })
      priorDigest = outputDigest
    }
    return {
      engine: input.engine,
      trial: input.trial,
      mountMs: creationMs + (revisions[0]?.wallMs ?? 0),
      streamCpuMs: creationCpuMs + revisions.reduce((sum, revision) => sum + revision.cpuMs, 0),
      revisions,
    }
  } finally {
    try {
      session.update('', { heal: false })
    } finally {
      session.dispose?.()
    }
  }
}

function* workloadFrames(entry: NativePairWorkload) {
  if (entry.revisions) {
    for (const text of entry.revisions)
      yield { text, offset: text.length, phase: 'update' as const, live: false }
  } else if (entry.scheduleUnits > 0) {
    for (const frame of fixedChunks(entry.source, entry.scheduleUnits))
      yield { ...frame, phase: 'update' as const, live: true }
  } else {
    yield { text: entry.source, offset: entry.source.length, phase: 'update' as const, live: false }
  }
  yield {
    text: entry.source,
    offset: entry.source.length,
    phase: 'settlement' as const,
    live: false,
  }
}

function measureRevision(
  session: MarkdownSession,
  processor: ReturnType<typeof createHastProcessor>,
  projections: WeakMap<MarkdownBlock, Root>,
  frame: {
    readonly text: string
    readonly offset: number
    readonly phase: NativeRevision['phase']
    readonly live: boolean
  },
) {
  const cpu = process.cpuUsage()
  const start = performance.now()
  const blocks = session.update(frame.text, { heal: frame.live })
  const parsed = performance.now()
  let convertedBlocks = 0
  const children = blocks.flatMap((block) => {
    const existing = projections.get(block)
    if (existing) return existing.children
    const projection = blockToHast(block, processor)
    projections.set(block, projection)
    convertedBlocks += 1
    return projection.children
  })
  const root: Root = { type: 'root', children }
  const finished = performance.now()
  const cpuMs = usedCpu(cpu)
  return {
    root,
    projectionSource: blocks.map((block) => block.source).join(''),
    offset: frame.offset,
    phase: frame.phase,
    parseMs: parsed - start,
    projectionMs: finished - parsed,
    wallMs: finished - start,
    cpuMs,
    convertedBlocks,
    reusedBlocks: blocks.length - convertedBlocks,
  }
}

type NativeSourceMetadata = Awaited<ReturnType<typeof provenance>>
type NativeCapturePlan = v.InferOutput<typeof nativeCapturePlanSchema>

function nativeWorkloadManifestSha256(workloads: readonly NativePairWorkload[]) {
  return hash(
    'sha256',
    JSON.stringify(
      workloads.map(({ source, revisions, ...entry }) => ({
        ...entry,
        sourceSha256: hash('sha256', source, 'hex'),
        revisionSourceSha256: revisions?.map((source) => hash('sha256', source, 'hex')) ?? [],
      })),
    ),
    'hex',
  )
}

export async function createNativeCapturePlan(
  seed: number,
  purpose: NativeCapturePlan['purpose'],
  sourceMetadata?: NativeSourceMetadata,
): Promise<NativeCapturePlan> {
  requireInteger(seed, 'seed', 0)
  const checkout = fileURLToPath(new URL('../../', import.meta.url))
  const qualification = await qualificationProvenance(checkout)
  const { revision: _revision, ...identity } = sourceMetadata ?? (await provenance())
  const plan = {
    schemaVersion: 1,
    kind: 'native-capture-plan',
    purpose,
    metadata: {
      ...identity,
      seed,
      workloadManifestSha256: nativeWorkloadManifestSha256(nativePairWorkloads('qualification')),
      qualification,
    },
    shards: nativeShardSelections(nativePairWorkloads('qualification')),
  } satisfies NativeCapturePlan
  v.parse(nativeCapturePlanSchema, plan)
  return plan
}

export function validateNativeCapturePlan(value: unknown, expected: NativeCapturePlan) {
  const observed = v.parse(nativeCapturePlanSchema, value)
  if (JSON.stringify(orderedValue(observed)) !== JSON.stringify(orderedValue(expected)))
    throw createScriptError(
      'Native capture plan differs from current source identity or ordered population.',
      {
        internal: { expectedSelections: expected.shards.length },
      },
    )
  return expected
}

export function nativeShardSelection(
  plan: NativeCapturePlan,
  index: number,
  planSha256: string,
  launchId: string,
): NativeShard {
  requireInteger(index, 'selection index', 0)
  const selection = plan.shards[index]
  if (!selection)
    throw createScriptError('Native shard requires an existing selection.', { internal: { index } })
  return v.parse(productionShard, { ...selection, index, planSha256, launchId })
}

async function selectedNativeShard(options: PairedNativeOptions, metadata: NativeSourceMetadata) {
  if (!options.capture || options.mode !== 'qualification' || options.fixtureIds !== undefined)
    throw createScriptError('Native shards require qualification mode and plan selection.', {
      internal: { mode: options.mode },
    })
  const bytes = await readFile(options.capture.plan)
  const value: unknown = JSON.parse(bytes.toString('utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    !('purpose' in value) ||
    (value.purpose !== 'qualification' && value.purpose !== 'development')
  )
    throw createScriptError('Native capture plan requires an explicit purpose.', {
      internal: { argument: 'capture-plan' },
    })
  const expected = await createNativeCapturePlan(options.seed ?? 176, value.purpose, metadata)
  const plan = validateNativeCapturePlan(value, expected)
  return {
    shard: nativeShardSelection(
      plan,
      options.capture.index,
      hash('sha256', bytes, 'hex'),
      options.capture.launchId,
    ),
    qualification: plan.metadata.qualification,
  }
}

function claimNativeShardProcess() {
  if (nativeCaptureLaunched)
    throw createScriptError('Native shard capture requires a fresh process per launch.', {
      internal: { launched: nativeCaptureLaunched },
    })
}

let nativeCaptureLaunched = false

export async function runPairedNative(options: PairedNativeOptions) {
  const startedAt = new Date().toISOString()
  const seed = options.seed ?? 176
  const profile = BENCHMARK_PROFILES[options.mode === 'quick' ? 'quick' : 'promotion']
  const orders = pairedTrialOrders(profile.trials, seed)
  const allWorkloads = nativePairWorkloads(options.mode)
  const sourceMetadata = await provenance()
  const selected = options.capture ? await selectedNativeShard(options, sourceMetadata) : undefined
  const shard = selected?.shard
  const workloads = selectWorkloads(allWorkloads, shard ? [shard.workload] : options.fixtureIds)
  await mkdir(options.output, { recursive: true })
  await requireMissingNativeOutput(path.join(options.output, 'paired-native.json'))
  await requireMissingNativeOutput(path.join(options.output, 'raw-native-pairs.jsonl'))
  if (shard) claimNativeShardProcess()
  nativeCaptureLaunched = true
  const initializationStartedAt = new Date().toISOString()
  const initializationStart = performance.now()
  const { createMarkdownSession } = await import('../../packages/markdown/src/utils/session')
  const { createTreeSitterMarkdownSession, initializeTreeSitterMarkdown } =
    await import('../../packages/markdown/src/utils/tree-sitter-session')
  const extensions = await readyRemarkExtensions()
  await initializeTreeSitterMarkdown()
  const initialization = {
    startedAt: initializationStartedAt,
    finishedAt: new Date().toISOString(),
    durationMs: performance.now() - initializationStart,
  }
  const factories = {
    remark: () => createMarkdownSession(),
    'tree-sitter': () => createTreeSitterMarkdownSession(),
  }
  const writeOptions: NativeWriteOptions = {
    output: options.output,
    workloads,
    orders,
    warmups: profile.warmups,
    seed,
    mode: options.mode,
    capture: (trial) => runNativeTrial({ ...trial, factory: factories[trial.engine], extensions }),
    pair: shard?.pair,
  }
  const launchPreparation = shard ? await writeNativeLaunchPreparation(writeOptions) : undefined
  const observed = await writeNativePairs(writeOptions)
  const results = observed.workloads
  const missing = [
    'Production browser build, quiet-host timing qualification and paint completion receipts',
    'Cold process import/WASM initialization/asset fetch and true cold mount',
    'Held-syntax release paint, main-thread tasks, worker/transfer CPU and input latency',
    'Highlighted extensions, timeline/input, live resources and transferred payload families',
    'Independent evaluation, real-chat interactions, safety, raster states and frame probes',
    'Required math, footnote and CJK semantics are not established by this native workload matrix',
    '1/8-unit schedules above 8 KiB and fine-grained pathological streaming schedules',
  ]
  if (workloads.length !== allWorkloads.length) missing.push('Unselected native workload cells')
  if (shard)
    missing.push(
      'Unselected original native pairs; aggregate comparisons require explicit shard assembly',
    )
  const report = {
    schemaVersion: 2 as const,
    verdict: 'NOT VERIFIED',
    scope: 'paired-native-source',
    status:
      launchPreparation && launchPreparation.mismatchedPairs > 0 ? 'FAILED' : nativeStatus(results),
    ...(shard ? { shard } : {}),
    mode: options.mode,
    metadata: {
      startedAt,
      ...(selected
        ? { initialization, launchPreparation, qualification: selected.qualification }
        : {}),
      finishedAt: new Date().toISOString(),
      seed,
      trials: profile.trials,
      warmups: profile.warmups,
      bootstrapUnit: 'independent paired trial',
      statistic: 'p95 of trial p95 updates/settlements; p95 of trial mount/total CPU',
      cacheState: shard
        ? 'fresh process; three separate full-workload paired preparation replays; fresh session, HAST processor and block projection cache per counted arm'
        : 'warm runtime; fresh session, HAST processor and block projection cache per engine per trial',
      boundary:
        'Session creation plus parse/heal and safe HAST; excludes source generation, rendered digest, source-coordinate validation, JSX, React, workers and paint',
      outputContract:
        'Ordered nested rendered nodes and all properties; adjacent text runs coalesce with exact whitespace. Private AST positions/data are observed separately.',
      sourceContract:
        'Validate UTF-16 coordinates against actual projection text, including declared healing, and retain all published source-line properties in rendered equality. Private container spans may include or exclude delimiters.',
      gcPolicy:
        'No asymmetric forced GC; shared runtime module caches remain warm for both engines',
      timingStatus: 'EXPLORATORY',
      host: hostname(),
      hardware: cpus()[0]?.model ?? 'unknown',
      platform: process.platform,
      architecture: process.arch,
      runtime: `${process.release.name} ${process.version}`,
      workloadManifestSha256: nativeWorkloadManifestSha256(allWorkloads),
      ...sourceMetadata,
    },
    workloads: results,
    pairsArtifact: observed.pairsArtifact,
    missing,
    resources: {
      created: ['In-process message sessions and projection caches'],
      cleanup: ['Every trial clears source and disposes available native handles in finally'],
      retained: [
        'Sealed canonical raw pairs on disk; compact scalar comparisons and workload summaries',
      ],
    },
  }
  await publishNativeReport(options.output, report)
  return report
}

export async function publishNativeReport(output: string, report: unknown) {
  await writeJsonl({
    root: output,
    file: 'paired-native.json',
    records: (async function* () {
      yield report
    })(),
  })
}

type NativeTrialCapture = (
  input: Pick<Parameters<typeof runNativeTrial>[0], 'engine' | 'trial' | 'workload'>,
) => NativeTrial
type NativeCaptureFailure = {
  readonly workload: string
  readonly trial: number
  readonly order: PairOrder
  readonly completed: readonly NativeTrial[]
  readonly error: unknown
}
type NativeMetricPair = {
  readonly baseline: Readonly<Record<PairedMetric, number>>
  readonly candidate: Readonly<Record<PairedMetric, number>>
}
type NativeWriteOptions = {
  readonly output: string
  readonly workloads: readonly NativePairWorkload[]
  readonly orders: readonly PairOrder[]
  readonly warmups: number
  readonly seed: number
  readonly mode: PairedNativeOptions['mode']
  readonly capture: NativeTrialCapture
  readonly pair?: number
}
type NativeWriteState = {
  readonly workloads: NativeWorkloadSummary[]
  failure: NativeCaptureFailure | null
}

export async function writeNativePairs(options: NativeWriteOptions) {
  return writeNativeRecords(options, 'counted')
}

async function writeNativeRecords(
  options: NativeWriteOptions,
  role: 'counted' | 'launch-preparation',
) {
  validateNativePairSelection(options)
  const file = role === 'counted' ? 'raw-native-pairs.jsonl' : 'raw-native-preparation.jsonl'
  await requireMissingNativeOutput(path.join(options.output, file))
  await requireMissingNativeOutput(path.join(options.output, 'paired-native.json'))
  const state: NativeWriteState = { workloads: [], failure: null }
  let pairsArtifact: RawTimingRef
  try {
    pairsArtifact = await writeJsonl({
      root: options.output,
      file,
      records: taggedNativeRecords(options, state, role),
    })
  } catch (error) {
    if (state.failure) await preserveNativeFailure(options.output, state.failure, role)
    throw error
  }
  if (state.failure) await preserveNativeFailure(options.output, state.failure, role, pairsArtifact)
  return { pairsArtifact, workloads: state.workloads }
}

function validateNativePairSelection(options: NativeWriteOptions) {
  if (options.pair === undefined) return
  if (
    options.workloads.length === 1 &&
    Number.isSafeInteger(options.pair) &&
    options.pair >= -options.warmups &&
    options.pair < options.orders.length
  )
    return
  throw createScriptError('Native pair selection requires one workload and an original trial id.', {
    internal: { pair: options.pair, workloads: options.workloads.length },
  })
}

async function* taggedNativeRecords(
  options: NativeWriteOptions,
  state: NativeWriteState,
  role: 'counted' | 'launch-preparation',
) {
  for await (const record of nativePairRecords(options, state)) {
    if (role === 'counted') yield record
    else yield { role, preparation: record.pair.trial, ...record }
  }
}

export async function writeNativeLaunchPreparation(options: NativeWriteOptions) {
  if (options.workloads.length !== 1)
    throw createScriptError('Native launch preparation requires one workload.', {
      internal: { workloads: options.workloads.length },
    })
  await requireMissingNativeOutput(path.join(options.output, 'raw-native-pairs.jsonl'))
  await requireMissingNativeOutput(path.join(options.output, 'native-preparation-failure.json'))
  const startedAt = new Date().toISOString()
  const start = performance.now()
  const observed = await writeNativeRecords(
    {
      ...options,
      orders: pairedTrialOrders(3, options.seed),
      warmups: 0,
      pair: undefined,
    },
    'launch-preparation',
  )
  return {
    policy: 'paired-full-workload-three-replays-v1' as const,
    realm: 'fresh Bun process per launch; shared module/parser/JIT caches within launch',
    sessions: 'fresh session/HAST processor/projection WeakMap per arm',
    gc: 'no forced GC',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: performance.now() - start,
    pairs: 3,
    arms: 6,
    trialIds: [0, 1, 2],
    orderSeed: options.seed,
    artifact: observed.pairsArtifact,
    mismatchedPairs: observed.workloads.reduce((count, entry) => count + entry.mismatchedPairs, 0),
  }
}

async function requireMissingNativeOutput(file: string) {
  try {
    await lstat(file)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  throw createScriptError('Native output destination already exists.', { internal: { file } })
}

async function preserveNativeFailure(
  output: string,
  failure: NativeCaptureFailure,
  role: 'counted' | 'launch-preparation',
  pairsArtifact?: RawTimingRef,
): Promise<never> {
  const { error, ...context } = failure
  try {
    await writeFile(
      path.join(
        output,
        role === 'counted' ? 'native-pair-failure.json' : 'native-preparation-failure.json',
      ),
      `${JSON.stringify(
        {
          ...context,
          role,
          pairsArtifact,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: String(error) },
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    )
  } catch {
    // Diagnostic write failure must not replace the original capture exception.
    throw error
  }
  throw error
}

async function* nativePairRecords(
  options: NativeWriteOptions,
  state: NativeWriteState,
): AsyncGenerator<NativePairRecord> {
  for (const entry of options.workloads) {
    yield* nativeWorkloadRecords(entry, options, state)
    if (state.failure) return
  }
}

async function* nativeWorkloadRecords(
  entry: NativePairWorkload,
  options: NativeWriteOptions,
  state: NativeWriteState,
): AsyncGenerator<NativePairRecord> {
  const warmupOrders = options.warmups === 0 ? [] : pairedTrialOrders(options.warmups, options.seed)
  let mismatchedPairs = 0
  for (let warmup = 0; warmup < options.warmups; warmup++) {
    const trial = -warmup - 1
    if (options.pair !== undefined && options.pair !== trial) continue
    const order = warmupOrders[warmup]
    const arms = captureNativeArms(entry, order, trial, options.capture, state)
    if (!arms) return
    const pair = nativePair(arms, order, trial)
    if (pair.mismatchedRevisions.length > 0) mismatchedPairs++
    yield { workload: entry.id, pair }
  }
  const metrics: NativeMetricPair[] = []
  for (const [trial, order] of options.orders.entries()) {
    if (options.pair !== undefined && options.pair !== trial) continue
    const arms = captureNativeArms(entry, order, trial, options.capture, state)
    if (!arms) return
    const pair = nativePair(arms, order, trial)
    metrics.push({
      baseline: nativeTrialMetrics(pair.remark),
      candidate: nativeTrialMetrics(pair.candidate),
    })
    if (pair.mismatchedRevisions.length > 0) mismatchedPairs++
    yield { workload: entry.id, pair }
  }
  state.workloads.push(nativeWorkloadSummary(entry, metrics, mismatchedPairs, options))
}

function nativeTrialMetrics(trial: NativeTrial): Readonly<Record<PairedMetric, number>> {
  return {
    updateP95: trialMetric(trial, 'updateP95'),
    settlementP95: trialMetric(trial, 'settlementP95'),
    mountP95: trialMetric(trial, 'mountP95'),
    streamCpu: trialMetric(trial, 'streamCpu'),
  }
}

function nativeWorkloadSummary(
  entry: NativePairWorkload,
  metrics: readonly NativeMetricPair[],
  mismatchedPairs: number,
  options: NativeWriteOptions,
): NativeWorkloadSummary {
  return {
    id: entry.id,
    family: entry.family,
    sourceBytes: entry.sourceBytes,
    sourceSha256: hash('sha256', entry.source, 'hex'),
    scheduleUnits: entry.scheduleUnits,
    observedPairs: metrics.length,
    mismatchedPairs,
    comparisons:
      metrics.length === 0
        ? []
        : (['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const).map((metric) =>
            pairedConfidence({
              workload: entry.id,
              metric,
              baseline: metrics.map((pair) => pair.baseline[metric]),
              candidate: metrics.map((pair) => pair.candidate[metric]),
              seed: options.seed,
              resamples: options.mode === 'qualification' ? 4096 : 256,
            }),
          ),
  }
}

function captureNativeArms(
  entry: NativePairWorkload,
  order: PairOrder,
  trial: number,
  capture: NativeTrialCapture,
  state: NativeWriteState,
): readonly [NativeTrial, NativeTrial] | null {
  const completed: NativeTrial[] = []
  try {
    const first = capture({ engine: order[0], trial, workload: entry })
    completed.push(first)
    const second = capture({ engine: order[1], trial, workload: entry })
    completed.push(second)
    return [first, second]
  } catch (error) {
    state.failure = { workload: entry.id, trial, order, completed, error }
    return null
  }
}

function nativePair(
  [first, second]: readonly [NativeTrial, NativeTrial],
  order: PairOrder,
  trial: number,
): NativePair {
  const remark = first.engine === 'remark' ? first : second
  const candidate = first.engine === 'tree-sitter' ? first : second
  return {
    trial,
    order,
    remark,
    candidate,
    mismatchedRevisions: mismatchedRevisions(remark.revisions, candidate.revisions),
  }
}

export function mismatchedRevisions(
  baseline: readonly NativeRevision[],
  candidate: readonly NativeRevision[],
): number[] {
  const count = Math.max(baseline.length, candidate.length)
  return Array.from({ length: count }, (_, index) => index).filter((index) => {
    const left = baseline[index]
    const right = candidate[index]
    return (
      !left ||
      !right ||
      left.revision !== right.revision ||
      left.offset !== right.offset ||
      left.phase !== right.phase ||
      left.outputDigest !== right.outputDigest ||
      left.sourceCoordinateFailures.length > 0 ||
      right.sourceCoordinateFailures.length > 0
    )
  })
}

function trialMetric(trial: NativeTrial, metric: PairedMetric) {
  if (metric === 'mountP95') return trial.mountMs
  if (metric === 'streamCpu') return trial.streamCpuMs
  const phase = metric === 'settlementP95' ? 'settlement' : 'update'
  return percentile(
    trial.revisions
      .filter((revision) => revision.phase === phase)
      .map((revision) => revision.wallMs),
    0.95,
  )
}

function nativeStatus(results: readonly NativeWorkloadSummary[]) {
  if (results.some((result) => result.mismatchedPairs > 0)) return 'FAILED'
  if (results.length === 0 || results.some((result) => result.observedPairs === 0))
    return 'INCONCLUSIVE'
  if (
    results.some((result) =>
      result.comparisons.some((comparison) => comparison.status === 'failed'),
    )
  )
    return 'FAILED'
  if (
    results.some((result) =>
      result.comparisons.some((comparison) => comparison.status === 'inconclusive'),
    )
  )
    return 'INCONCLUSIVE'
  return 'PAIRED NATIVE PASS'
}

function selectWorkloads(available: readonly NativePairWorkload[], ids?: readonly string[]) {
  if (!ids) return available
  const selected = available.filter((entry) => ids.includes(entry.id))
  if (selected.length === 0 || ids.some((id) => !available.some((entry) => entry.id === id)))
    throw createScriptError('Native workload selection requires existing workload ids', {
      internal: { requested: ids.length, matched: selected.length },
    })
  return selected
}

async function provenance() {
  const checkout = fileURLToPath(new URL('../../', import.meta.url))
  const require = createRequire(new URL('../../packages/markdown/package.json', import.meta.url))
  const execute = promisify(execFile)
  const sourcePaths = [
    'packages/markdown/src/utils/session.ts',
    'packages/markdown/src/utils/tree-sitter-session.ts',
    'packages/markdown/src/utils/hast.ts',
    'packages/markdown/src/utils/processor.ts',
    'packages/markdown/src/utils/hold.ts',
    'packages/markdown/src/utils/heal.ts',
    'packages/markdown/src/utils/blocks.ts',
    'packages/markdown/src/utils/code-meta.ts',
    'packages/markdown/src/utils/cjk-autolinks.ts',
    'scripts/markdown/paired-native.ts',
    'scripts/markdown/promotion.ts',
    'scripts/markdown/workloads.ts',
  ]
  const [revision, lockfile, budget, grammar, chatGrammar, resolver, sources] = await Promise.all([
    execute('git', ['rev-parse', 'HEAD'], { cwd: checkout }),
    readFile(path.join(checkout, 'bun.lock')),
    readFile(new URL('./promotion-budget.json', import.meta.url)),
    readFile(require.resolve('tree-sitter-md/tree-sitter-markdown.wasm')),
    readFile(require.resolve('tree-sitter-md/tree-sitter-markdown-chat.wasm')),
    readFile(require.resolve('tree-sitter-md/tree-sitter-md.wasm')),
    Promise.all(
      sourcePaths.map(async (file) => ({
        path: file,
        sha256: hash('sha256', await readFile(path.join(checkout, file)), 'hex'),
      })),
    ),
  ])
  return {
    revision: revision.stdout.trim(),
    candidateCommit: revision.stdout.trim(),
    sourceFiles: sources,
    candidateSourceSha256: hash('sha256', JSON.stringify(sources), 'hex'),
    lockfileSha256: hash('sha256', lockfile, 'hex'),
    budgetSha256: hash('sha256', budget, 'hex'),
    grammarSha256: hash('sha256', grammar, 'hex'),
    chatGrammarSha256: hash('sha256', chatGrammar, 'hex'),
    resolverSha256: hash('sha256', resolver, 'hex'),
  }
}

function orderedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, orderedValue(entry)]),
  )
}
function usedCpu(start: NodeJS.CpuUsage) {
  const cpu = process.cpuUsage(start)
  return (cpu.user + cpu.system) / 1000
}
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}
function requireInteger(value: number, field: string, minimum: number) {
  if (Number.isSafeInteger(value) && value >= minimum) return
  throw createScriptError('A native benchmark numeric argument is invalid', {
    internal: { field, minimum },
  })
}

function nativeCaptureArguments(values: {
  readonly 'capture-plan'?: string
  readonly 'selection-index'?: string
  readonly 'launch-id'?: string
  readonly purpose?: string
}) {
  const plan = values['capture-plan']
  const index = values['selection-index']
  const launchId = values['launch-id']
  if (!plan && index === undefined && !launchId && values.purpose === undefined) return undefined
  if (!plan || index === undefined || !launchId || values.purpose !== undefined)
    throw createScriptError('Use capture-plan, selection-index and launch-id together.', {
      internal: { argument: 'capture-plan' },
    })
  return { plan, index: Number(index), launchId }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'quick' },
      seed: { type: 'string', default: '176' },
      fixture: { type: 'string', multiple: true },
      out: { type: 'string' },
      'write-capture-plan': { type: 'string' },
      purpose: { type: 'string' },
      'capture-plan': { type: 'string' },
      'selection-index': { type: 'string' },
      'launch-id': { type: 'string' },
    },
  })
  if (values['write-capture-plan']) {
    if (
      values.mode !== 'qualification' ||
      (values.purpose !== 'development' && values.purpose !== 'qualification') ||
      values.out ||
      values.fixture ||
      values['capture-plan'] ||
      values['selection-index'] ||
      values['launch-id']
    )
      throw createScriptError(
        'Use qualification mode and explicit purpose to write a native capture plan.',
        {
          internal: { argument: 'write-capture-plan' },
        },
      )
    const file = path.resolve(values['write-capture-plan'])
    const purpose = values.purpose
    await writeJsonl({
      root: path.dirname(file),
      file: path.basename(file),
      records: (async function* () {
        yield await createNativeCapturePlan(Number(values.seed), purpose)
      })(),
    })
    process.exit(0)
  }
  const capture = nativeCaptureArguments(values)
  if (!values.out || (values.mode !== 'quick' && values.mode !== 'qualification'))
    throw createScriptError('Use --out DIRECTORY and --mode quick|qualification', {
      internal: { argument: 'out or mode' },
    })
  const report = await runPairedNative({
    output: values.out,
    mode: values.mode,
    seed: Number(values.seed),
    fixtureIds: values.fixture,
    capture,
  })
  process.stdout.write(
    `${JSON.stringify({ verdict: report.verdict, status: report.status, evidence: values.out, workloads: report.workloads.length })}\n`,
  )
  process.exitCode =
    report.status === 'FAILED' ||
    (!capture && values.mode === 'qualification' && report.status === 'INCONCLUSIVE')
      ? 1
      : 0
}
