import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { cpus, hostname } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import type { MarkdownBlock } from '../../packages/markdown/src/utils/blocks'
import { blockToHast, createHastProcessor } from '../../packages/markdown/src/utils/hast'
import type { MarkdownSession } from '../../packages/markdown/src/utils/session'
import { readyRemarkExtensions } from '../../packages/markdown/test/qualification'
import { createScriptError } from '../structured-errors'
import { percentile } from './bench-types'
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
export type NativePair = {
  readonly trial: number
  readonly order: PairOrder
  readonly remark: NativeTrial
  readonly candidate: NativeTrial
  readonly mismatchedRevisions: readonly number[]
}
export type PairedNativeOptions = {
  readonly mode: 'quick' | 'qualification'
  readonly seed?: number
  readonly fixtureIds?: readonly string[]
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
  return digest(JSON.stringify(canonicalProjection(root)))
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
    sourceCoordinatesDigest: digest(JSON.stringify(coordinates)),
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
  let low = 0
  let high = lines.length
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (lines[middle] <= offset) low = middle
    else high = middle
  }
  if (point.line !== low + 1 || point.column !== offset - lines[low] + 1)
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

export async function runPairedNative(options: PairedNativeOptions) {
  const { createMarkdownSession } = await import('../../packages/markdown/src/utils/session')
  const { createTreeSitterMarkdownSession, initializeTreeSitterMarkdown } =
    await import('../../packages/markdown/src/utils/tree-sitter-session')
  const startedAt = new Date().toISOString()
  const extensions = await readyRemarkExtensions()
  await initializeTreeSitterMarkdown()
  const seed = options.seed ?? 176
  const profile = BENCHMARK_PROFILES[options.mode === 'quick' ? 'quick' : 'promotion']
  const orders = pairedTrialOrders(profile.trials, seed)
  const allWorkloads = nativePairWorkloads(options.mode)
  const workloads = selectWorkloads(allWorkloads, options.fixtureIds)
  const factories = {
    remark: () => createMarkdownSession(),
    'tree-sitter': () => createTreeSitterMarkdownSession(),
  }
  const results = workloads.map((entry) =>
    runWorkloadPairs(entry, orders, profile.warmups, extensions, factories, seed, options.mode),
  )
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
  return {
    schemaVersion: 1,
    verdict: 'NOT VERIFIED',
    scope: 'paired-native-source',
    status: nativeStatus(results),
    mode: options.mode,
    metadata: {
      startedAt,
      finishedAt: new Date().toISOString(),
      seed,
      trials: profile.trials,
      warmups: profile.warmups,
      bootstrapUnit: 'independent paired trial',
      statistic: 'p95 of trial p95 updates/settlements; p95 of trial mount/total CPU',
      cacheState:
        'warm runtime; fresh session, HAST processor and block projection cache per engine per trial',
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
      workloadManifestSha256: digest(
        JSON.stringify(
          allWorkloads.map(({ source, revisions, ...entry }) => ({
            ...entry,
            sourceSha256: digest(source),
            revisionSourceSha256: revisions?.map(digest) ?? [],
          })),
        ),
      ),
      ...(await provenance()),
    },
    workloads: results,
    missing,
    resources: {
      created: ['In-process message sessions and projection caches'],
      cleanup: ['Every trial clears source and disposes available native handles in finally'],
      retained: ['Returned raw samples and report; caller owns retention'],
    },
  }
}

function runWorkloadPairs(
  entry: NativePairWorkload,
  orders: readonly PairOrder[],
  warmups: number,
  extensions: Extensions,
  factories: Record<PairOrder[number], SessionFactory>,
  seed: number,
  mode: PairedNativeOptions['mode'],
) {
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    for (const engine of pairedTrialOrders(warmups, seed)[warmup])
      runNativeTrial({
        factory: factories[engine],
        engine,
        trial: -warmup - 1,
        workload: entry,
        extensions,
      })
  }
  const pairs = orders.map((order, trial) => runPair(entry, order, trial, extensions, factories))
  const metrics: readonly PairedMetric[] = ['updateP95', 'settlementP95', 'mountP95', 'streamCpu']
  return {
    id: entry.id,
    family: entry.family,
    sourceBytes: entry.sourceBytes,
    sourceSha256: digest(entry.source),
    scheduleUnits: entry.scheduleUnits,
    pairs,
    comparisons: metrics.map((metric) =>
      pairedConfidence({
        workload: entry.id,
        metric,
        baseline: pairs.map((pair) => trialMetric(pair.remark, metric)),
        candidate: pairs.map((pair) => trialMetric(pair.candidate, metric)),
        seed,
        resamples: mode === 'qualification' ? 4096 : 256,
      }),
    ),
  }
}

function runPair(
  entry: NativePairWorkload,
  order: PairOrder,
  trial: number,
  extensions: Extensions,
  factories: Record<PairOrder[number], SessionFactory>,
): NativePair {
  const first = runNativeTrial({
    factory: factories[order[0]],
    engine: order[0],
    trial,
    workload: entry,
    extensions,
  })
  const second = runNativeTrial({
    factory: factories[order[1]],
    engine: order[1],
    trial,
    workload: entry,
    extensions,
  })
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

function nativeStatus(
  results: readonly {
    readonly pairs: readonly NativePair[]
    readonly comparisons: readonly PairedComparison[]
  }[],
) {
  if (results.some((result) => result.pairs.some((pair) => pair.mismatchedRevisions.length > 0)))
    return 'FAILED'
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
  const [revision, lockfile, budget, grammar, resolver, sources] = await Promise.all([
    execute('git', ['rev-parse', 'HEAD'], { cwd: checkout }),
    readFile(path.join(checkout, 'bun.lock')),
    readFile(new URL('./promotion-budget.json', import.meta.url)),
    readFile(require.resolve('tree-sitter-md/tree-sitter-markdown.wasm')),
    readFile(require.resolve('tree-sitter-md/tree-sitter-md.wasm')),
    Promise.all(
      sourcePaths.map(async (file) => ({
        path: file,
        sha256: digest(await readFile(path.join(checkout, file))),
      })),
    ),
  ])
  return {
    revision: revision.stdout.trim(),
    candidateCommit: revision.stdout.trim(),
    sourceFiles: sources,
    candidateSourceSha256: digest(JSON.stringify(sources)),
    lockfileSha256: digest(lockfile),
    budgetSha256: digest(budget),
    grammarSha256: digest(grammar),
    resolverSha256: digest(resolver),
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
function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
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

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'quick' },
      seed: { type: 'string', default: '176' },
      fixture: { type: 'string', multiple: true },
      out: { type: 'string' },
    },
  })
  if (!values.out || (values.mode !== 'quick' && values.mode !== 'qualification'))
    throw createScriptError('Use --out DIRECTORY and --mode quick|qualification', {
      internal: { argument: 'out or mode' },
    })
  const report = await runPairedNative({
    mode: values.mode,
    seed: Number(values.seed),
    fixtureIds: values.fixture,
  })
  await mkdir(values.out, { recursive: true })
  await writeFile(
    path.join(values.out, 'paired-native.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ verdict: report.verdict, status: report.status, evidence: values.out, workloads: report.workloads.length })}\n`,
  )
  process.exitCode =
    report.status === 'FAILED' ||
    (values.mode === 'qualification' && report.status === 'INCONCLUSIVE')
      ? 1
      : 0
}
