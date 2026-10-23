import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import * as v from 'valibot'
import { distribution, percentile } from './bench-types'
import { productionPayloadSummary } from './production-network-summary'
import {
  pairedConfidence,
  pairedTrialOrders,
  nativePairWorkloads,
  type NativePairWorkload,
} from './paired-native'
import frozenBudget from './promotion-budget.json'
import type { PromotionComparison, PromotionEvidence } from './promotion'
import { stable } from './serialization'
import {
  nativeCapturePlan,
  nativePlanMetadata,
  nativeShardIndex,
  nativeShardSelections,
  productionShard,
  productionCapturePlan,
  productionShardIndex,
  productionShardSelections,
  timingSidecarFiles,
  timingLaunchManifest,
} from './production-shards'
import { foldJsonl, hashFile, type ArtifactRef } from './timing-artifacts'
import {
  productionOracleSchema,
  productionOracleIdentitySchema,
  reconcileProductionOracles,
  type ProductionInput,
} from './production-oracle'
import { createScriptError } from '../structured-errors'
import { BENCHMARK_FAMILIES, fixedChunks } from './workloads'
import {
  productionUpdates,
  productionBrowserWorkloads,
  type ProductionWorkload,
} from './production-workloads'
import { isSustainedProductStream, reconcileProductionNetworkRequests } from './production-cdp'

export type TimingArtifact = {
  readonly path: string
  readonly sha256: string
  readonly contents: string
}
export type TimingFreeze = {
  readonly identity: PromotionEvidence['identity']
  readonly provenance: {
    readonly revision: string
    readonly trackedDiffSha256: string
    readonly sourceClosureSha256: string
    readonly lockfileSha256: string
  }
  readonly productionWorkloads: readonly ProductionWorkload[]
  readonly nativeWorkloads: readonly NativePairWorkload[]
  readonly fontFingerprint: string
}
type TimingReconciliationInput = {
  readonly kind: 'production' | 'native'
  readonly report: TimingArtifact
  readonly capturedFiles: readonly ArtifactRef[]
  readonly root: string
  readonly trialRoot?: string
  readonly shard?: boolean
  readonly frozen: TimingFreeze
  readonly artifacts: {
    readonly host: TimingArtifact | null
    readonly quietHost: TimingArtifact | null
    readonly build: TimingArtifact | null
    readonly buildManifest: TimingArtifact | null
    readonly browser: TimingArtifact | null
    readonly fonts: TimingArtifact | null
    readonly trials: string
    readonly sourceCapture: TimingArtifact | null
  }
}
type TimingFinding = {
  readonly path: string
  readonly kind: 'missing' | 'mismatch' | 'failure'
  readonly reason: string
}
type TimingReconciliationResult = {
  readonly schemaVersion: 2
  readonly kind: TimingReconciliationInput['kind']
  readonly verdict: 'VERIFIED' | 'NOT VERIFIED' | 'INCONCLUSIVE'
  readonly timingStatus:
    | 'PROMOTION_CAPTURE_RECONCILED'
    | 'PROMOTION_CAPTURE_UNRECONCILED'
    | 'NATIVE_CAPTURE_RECONCILED'
    | 'EXPLORATORY'
  readonly findings: readonly TimingFinding[]
  readonly metrics: Readonly<Record<string, number | string | boolean | null>>
  readonly comparisons: readonly PromotionComparison[]
  readonly samples: readonly TimingSample[]
  readonly exclusions: readonly TimingExclusion[]
  readonly artifacts: readonly { readonly path: string; readonly sha256: string }[]
  readonly rawFailures: unknown
  readonly rawExclusions: readonly unknown[]
  readonly resourceTrials: readonly ResourceTimingObservation[]
  readonly coverage: readonly CoverageTimingObservation[]
  readonly productionSummary?: Readonly<Record<string, unknown>>
}
export type ResourceTimingObservation = {
  readonly launchReport?: string
  readonly workload: string
  readonly pair: number
  readonly engine: string
  readonly resourceWindows: ProductionRow['resourceWindows']
  readonly resourceControlWindows: ProductionRow['resourceControlWindows']
}
export type CoverageTimingObservation = {
  readonly workload: string
  readonly family: string
  readonly pair: number
  readonly engine: string
}
type TimingExclusion = {
  readonly workload: string
  readonly pair: number
  readonly engine: string
  readonly metric: 'streamCpu' | 'transfer'
  readonly reason: string
}
type TimingSample = {
  readonly workload: string
  readonly pair: number
  readonly engine: string
  readonly warmup: boolean
  readonly processedInputs: number
  readonly paintedUpdates: number | null
  readonly unpaintedUpdates: number | null
  readonly updateP95: number | null
  readonly settlementP95: number | null
  readonly mountP95: number | null
  readonly streamCpu: number | null
  readonly transferredBytes: number | null
}
type State = {
  readonly input: TimingReconciliationInput
  readonly findings: TimingFinding[]
  readonly metrics: Record<string, number | string | boolean | null>
  readonly samples: TimingSample[]
  readonly comparisons: PromotionComparison[]
  readonly exclusions: TimingExclusion[]
  readonly resourceTrials: ResourceTimingObservation[]
  readonly coverage: CoverageTimingObservation[]
  readonly observedArtifacts: ArtifactRef[]
}
const finite = v.pipe(v.number(), v.finite())
const nonnegative = v.pipe(finite, v.minValue(0))
const count = v.pipe(nonnegative, v.integer())
const label = v.pipe(v.string(), v.minLength(1))
const digest = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u))
const engine = v.picklist(['remark', 'tree-sitter'])
const font = v.object({
  family: label,
  status: v.picklist(['loaded', 'unloaded', 'loading', 'error']),
  weight: label,
})
const output = v.object({ digest, textBytes: count, elementCount: count })
const processedFields = {
  revision: count,
  inputSha256: digest,
  inputUtf16Units: count,
  live: v.boolean(),
  scheduled: nonnegative,
  received: nonnegative,
  committed: nonnegative,
  output,
  parserWallMs: nonnegative,
}
const frame = v.object({
  ...processedFields,
  observedRevision: count,
  painted: nonnegative,
  paintedOutput: output,
})

const worker = v.object({
  targetId: label,
  url: v.pipe(v.string(), v.url()),
  threadId: v.nullable(count),
  pid: v.nullable(count),
  cpuMs: v.nullable(nonnegative),
  coveredCpuMs: v.nullable(nonnegative),
  measurement: v.picklist(['complete', 'incomplete']),
  reason: v.nullable(v.string()),
  taskCount: count,
  nestedTaskCount: count,
  incompleteTaskCount: count,
  boundaryCrossingTaskCount: count,
})
const network = v.object({
  id: label,
  url: v.pipe(v.string(), v.url()),
  type: label,
  fromCache: v.boolean(),
  transferredBytes: v.nullable(nonnegative),
  completionEncodedBytes: v.nullable(nonnegative),
  dataReceivedBytes: v.nullable(nonnegative),
  transferReceiptError: v.optional(v.string()),
  traceTransferReceipt: v.optional(
    v.object({
      requestId: label,
      responseEncodedBytes: nonnegative,
      receivedEncodedBytes: nonnegative,
    }),
  ),
  transferScope: v.picklist(['full-request', 'worker-bootstrap-completion']),
  phase: v.picklist(['navigation', 'prewarm', 'measurement', 'scenes']),
  kind: v.picklist(['host', 'grammar', 'resolver', 'javascript', 'other']),
  failure: v.nullable(v.string()),
  target: v.picklist(['page', 'worker']),
  workerTargetId: v.nullable(label),
  resolvedByWorkerRequestId: v.nullable(label),
})
const controlResourceWindow = v.object({
  cycles: nonnegative,
  elapsedMs: nonnegative,
  jsHeapUsedBeforeBytes: v.nullable(nonnegative),
  jsHeapUsedAfterBytes: v.nullable(nonnegative),
  backingStorageBeforeBytes: v.nullable(nonnegative),
  backingStorageAfterBytes: v.nullable(nonnegative),
})
const resourceWindow = v.object({
  ...controlResourceWindow.entries,
  parserWasmReservedBeforeBytes: v.nullable(nonnegative),
  parserWasmReservedAfterBytes: v.nullable(nonnegative),
  jsHeapReservedBeforeBytes: v.nullable(nonnegative),
  jsHeapReservedAfterBytes: v.nullable(nonnegative),
  queryObserversBefore: nonnegative,
  queryObserversAfter: nonnegative,
  retainedMessageNodes: nonnegative,
  simultaneousMessages: nonnegative,
  peakWasmReservedBytes: v.nullable(nonnegative),
  peakMessageNodes: nonnegative,
})
export const productionTrial = v.object({
  workload: label,
  family: label,
  resourceWindows: v.nullable(v.array(resourceWindow)),
  resourceControlWindows: v.nullable(v.array(controlResourceWindow)),
  pair: v.pipe(finite, v.integer()),
  order: v.picklist(['AB', 'BA']),
  engine,
  arrival: v.picklist(['paced', 'burst-coalesced']),
  cache: v.picklist(['cold', 'warm']),
  navigationMs: nonnegative,
  environment: v.object({ fontFamily: label, fonts: v.array(font) }),
  receipt: v.object({
    started: nonnegative,
    ended: nonnegative,
    processed: v.array(v.object(processedFields)),
    frames: v.array(frame),
    final: frame,
    fullyReady: nonnegative,
    fullyReadyOutput: output,
    skippedPaintRevisions: v.array(count),
    heldSyntax: v.nullable(v.object({ held: frame, released: frame, holdMs: nonnegative })),
    longTasks: v.nullable(v.array(nonnegative)),
  }),
  correctness: productionOracleSchema,
  freshCompleted: productionOracleIdentitySchema,
  updateCpu: v.array(v.object({ revision: count, mainThreadCpuMs: nonnegative })),
  workers: v.nullable(v.object({ created: count, active: count })),
  streamMainThreadCpuMs: v.nullable(nonnegative),
  workerCpu: v.nullable(v.array(worker)),
  network: v.nullable(v.array(network)),
})
type ProductionRow = v.InferOutput<typeof productionTrial>
const hostObservation = v.object({
  observedAt: label,
  loadAverage: v.pipe(v.array(nonnegative), v.length(3)),
  logicalCpus: v.pipe(count, v.minValue(1)),
})
const rawTimingRef = v.strictObject({
  path: label,
  sha256: digest,
  byteLength: count,
  recordCount: count,
})
const measurementControls = v.object({
  knownGood: v.object({
    expected: digest,
    observed: digest,
    revision: v.pipe(count, v.minValue(1)),
    observedRevision: v.pipe(count, v.minValue(1)),
  }),
  missingExpectation: v.object({
    rejected: v.boolean(),
    reason: v.pipe(v.string(), v.trim(), v.minLength(1)),
  }),
  wrongExpectation: v.object({
    rejected: v.boolean(),
    reason: v.pipe(v.string(), v.trim(), v.minLength(1)),
  }),
  longTask: v.object({ supported: v.boolean(), observed: v.array(nonnegative) }),
})
export const productionReport = v.object({
  schemaVersion: v.literal(2),
  shard: v.optional(productionShard),
  build: v.literal('production'),
  timingStatus: label,
  controls: measurementControls,
  capture: v.object({
    kind: label,
    hostEvidence: v.nullable(v.object({ sha256: digest, observation: v.unknown() })),
  }),
  browser: v.object({
    name: label,
    version: label,
    headless: v.boolean(),
    requestedArgs: v.array(v.string()),
    actualArgs: v.nullable(v.array(v.string())),
    executablePath: v.nullable(label),
  }),
  host: v.object({
    id: label,
    platform: label,
    architecture: label,
    hardware: label,
    osRelease: label,
    memoryBytes: v.pipe(count, v.minValue(1)),
    before: hostObservation,
    after: hostObservation,
  }),
  provenance: v.unknown(),
  servedBuild: v.nullable(v.unknown()),
  frozenBudgetSha256: digest,
  workloadManifest: v.unknown(),
  selectedWorkloads: v.array(v.unknown()),
  trials: count,
  warmups: count,
  trialsArtifact: rawTimingRef,
  sampleSummaries: v.array(v.unknown()),
  familyCoverage: v.array(v.unknown()),
  failures: v.array(v.unknown()),
  comparisons: v.array(v.unknown()),
})
const nativeRevision = v.object({
  revision: count,
  offset: count,
  phase: v.picklist(['update', 'settlement']),
  wallMs: nonnegative,
  cpuMs: nonnegative,
  outputDigest: digest,
  sourceCoordinateFailures: v.array(v.string()),
})
const nativeTrial = v.object({
  engine,
  trial: v.pipe(finite, v.integer()),
  mountMs: nonnegative,
  streamCpuMs: nonnegative,
  revisions: v.array(nativeRevision),
})
const nativePair = v.object({
  trial: v.pipe(finite, v.integer(), v.minValue(-3), v.maxValue(19)),
  order: v.pipe(v.array(engine), v.length(2)),
  remark: nativeTrial,
  candidate: nativeTrial,
  mismatchedRevisions: v.array(count),
})
const nativePairRecord = v.object({ workload: label, pair: nativePair })
export const nativeReport = v.object({
  schemaVersion: v.literal(2),
  shard: v.optional(productionShard),
  pairsArtifact: rawTimingRef,
  scope: v.literal('paired-native-source'),
  mode: v.literal('qualification'),
  metadata: v.object({
    startedAt: label,
    finishedAt: label,
    initialization: v.optional(
      v.object({ startedAt: label, finishedAt: label, durationMs: nonnegative }),
    ),
    launchPreparation: v.optional(
      v.object({
        policy: v.literal('paired-full-workload-three-replays-v1'),
        realm: v.literal(
          'fresh Bun process per launch; shared module/parser/JIT caches within launch',
        ),
        sessions: v.literal('fresh session/HAST processor/projection WeakMap per arm'),
        gc: v.literal('no forced GC'),
        startedAt: label,
        finishedAt: label,
        durationMs: nonnegative,
        pairs: v.literal(3),
        arms: v.literal(6),
        trialIds: v.tuple([v.literal(0), v.literal(1), v.literal(2)]),
        orderSeed: count,
        mismatchedPairs: count,
        artifact: rawTimingRef,
      }),
    ),
    qualification: v.optional(v.unknown()),
    seed: count,
    trials: count,
    warmups: count,
    timingStatus: label,
    host: label,
    hardware: label,
    platform: label,
    architecture: label,
    runtime: label,
    workloadManifestSha256: digest,
    revision: label,
    candidateCommit: label,
    candidateSourceSha256: digest,
    sourceFiles: v.array(v.object({ path: label, sha256: digest })),
    lockfileSha256: digest,
    budgetSha256: digest,
    grammarSha256: digest,
    chatGrammarSha256: digest,
    resolverSha256: digest,
  }),
  workloads: v.array(
    v.object({
      id: label,
      sourceBytes: count,
      sourceSha256: digest,
      scheduleUnits: count,
      family: label,
      observedPairs: count,
      mismatchedPairs: count,
      comparisons: v.array(v.unknown()),
    }),
  ),
})
const quietSample = v.object({
  ...hostObservation.entries,
  ownerBusy: v.boolean(),
  acPower: v.boolean(),
  competingCpuPercent: nonnegative,
  runningJobs: v.array(label),
})
const hostArtifact = v.object({ host: label, observedAt: label })
const nativeInvocation = v.object({
  executablePath: label,
  argv: v.pipe(v.array(label), v.minLength(2)),
  runtime: label,
  reportPath: label,
  environment: v.object({
    NODE_OPTIONS: v.nullable(v.string()),
    BUN_OPTIONS: v.nullable(v.string()),
  }),
})
const quietHostArtifact = v.object({
  nativeInvocation: v.optional(nativeInvocation),
  host: label,
  reportSha256: digest,
  platform: label,
  architecture: label,
  hardware: label,
  osRelease: label,
  memoryBytes: v.pipe(count, v.minValue(1)),
  observations: v.pipe(v.array(quietSample), v.minLength(3)),
})
const browserArtifact = v.object({
  host: label,
  executablePath: label,
  version: label,
  args: v.pipe(v.array(v.string()), v.minLength(1)),
})
export const fontsArtifact = v.object({
  host: label,
  fingerprint: digest,
  files: v.pipe(v.array(v.object({ path: label, sha256: digest })), v.minLength(1)),
  fontFamily: label,
  fonts: v.pipe(v.array(font), v.minLength(1)),
})
const sourceIdentity = v.object({
  revision: label,
  trackedDiffSha256: digest,
  sourceClosureSha256: digest,
  lockfileSha256: digest,
})
export const buildArtifact = v.object({
  schemaVersion: v.literal(1),
  sourceBefore: sourceIdentity,
  sourceAfter: sourceIdentity,
  artifactManifestSha256: digest,
  budgetSha256: digest,
  artifacts: v.pipe(
    v.array(v.object({ file: label, bytes: count, sha256: digest })),
    v.minLength(1),
  ),
})

export async function reconcileTimingEvidence(options: {
  readonly root: string
  readonly kind: 'production' | 'native'
  readonly report: string
  readonly frozen: TimingFreeze
  readonly artifacts: v.InferOutput<typeof timingSidecarFiles>
}): Promise<TimingReconciliationResult> {
  const root = await realpath(options.root)
  const artifacts = await readTimingSidecars(options.artifacts, root, root)
  const input: TimingReconciliationInput = {
    root,
    kind: options.kind,
    report: await readTimingFile(path.resolve(root, options.report), root),
    frozen: options.frozen,
    capturedFiles: await readCapturedSources(artifacts.sourceCapture, root),
    artifacts,
  }
  return reconcileFiles(input)
}
async function reconcileFiles(
  input: TimingReconciliationInput,
): Promise<TimingReconciliationResult> {
  const state = inputState(input)
  const raw = readArtifact(input.report, 'report', state)
  if (input.kind === 'production' && !input.shard && field(raw, 'kind') === 'production-shards')
    return reconcileProductionShards(raw, state)
  if (input.kind === 'native' && !input.shard && field(raw, 'kind') === 'native-shards')
    return reconcileNativeShards(raw, state)
  if (
    field(raw, 'rawTrials') !== undefined ||
    field(raw, 'warmupResults') !== undefined ||
    field(raw, 'rawReport') !== undefined
  )
    finding(
      state,
      'report',
      'mismatch',
      'Timing envelopes cannot contain inline raw trial populations.',
    )
  const workloads = field(raw, 'workloads')
  if (Array.isArray(workloads) && workloads.some((row) => field(row, 'pairs') !== undefined))
    finding(
      state,
      'report.workloads',
      'mismatch',
      'Native envelopes cannot contain inline pair populations.',
    )
  if (input.kind === 'production') await reconcileProduction(raw, state)
  else await reconcileNative(raw, state)
  state.findings.push(...(await verifyCapturedFiles(input, state.observedArtifacts)))
  const verdict = reconciliationVerdict(state)
  const sidecars = Object.entries(input.artifacts)
    .filter(([name, value]) => name !== 'trials' && value !== null)
    .flatMap(([, value]) => (typeof value === 'object' && value ? [value] : []))
  return {
    schemaVersion: 2,
    kind: input.kind,
    verdict,
    timingStatus: timingStatus(input.kind, verdict),
    findings: state.findings,
    metrics: state.metrics,
    comparisons: state.comparisons,
    samples: state.samples,
    exclusions: state.exclusions,
    artifacts: [input.report]
      .concat(sidecars)
      .map(({ path, sha256 }) => ({ path, sha256 }))
      .concat(
        input.capturedFiles
          .concat(state.observedArtifacts)
          .map(({ path: file, sha256 }) => ({ path: path.resolve(input.root, file), sha256 })),
      ),
    rawFailures: field(raw, 'failures') ?? null,
    rawExclusions: rawExclusions(raw),
    resourceTrials: state.resourceTrials,
    coverage: state.coverage,
  }
}

function emptyTimingSidecars(): TimingReconciliationInput['artifacts'] {
  return {
    host: null,
    quietHost: null,
    build: null,
    buildManifest: null,
    browser: null,
    fonts: null,
    sourceCapture: null,
    trials: '',
  }
}

function arrayField(value: unknown, key: string): unknown[] {
  const entries = field(value, key)
  return Array.isArray(entries) ? entries : []
}

function shardCohort(report: v.InferOutput<typeof productionReport>) {
  const { id, platform, architecture, hardware, osRelease, memoryBytes } = report.host
  const host = { id, platform, architecture, hardware, osRelease, memoryBytes }
  return {
    host,
    browser: {
      ...report.browser,
      actualArgs: report.browser.actualArgs?.map((arg) =>
        arg.startsWith('--user-data-dir=') ? '--user-data-dir=<launch>' : arg,
      ),
    },
    runtime: field(report.provenance, 'runtime'),
  }
}

type ShardAssembly = {
  readonly planFile: TimingArtifact
  readonly plan: v.InferOutput<typeof productionCapturePlan> | null
  readonly parts: TimingReconciliationResult[]
  readonly declared: string[]
  readonly launches: Set<string>
  readonly reports: Set<string>
  readonly profiles: Set<string>
  readonly intervals: { start: number; end: number }[]
  readonly reportsSummary: Readonly<Record<string, unknown>>[]
  cohort?: ReturnType<typeof shardCohort>
}

async function reconcileProductionShards(
  raw: unknown,
  state: State,
): Promise<TimingReconciliationResult> {
  const index = parse(productionShardIndex, raw, 'shards', state)
  if (!index) return failedShardIndex(state)
  const planFile = await readTimingFile(
    path.resolve(path.dirname(state.input.report.path), index.plan.path),
    state.input.root,
  )
  same(state, 'plan.sha256', planFile.sha256, index.plan.sha256)
  const plan = parse(productionCapturePlan, observedJson(planFile.contents), 'plan', state)
  if (plan) checkProductionCapturePlan(plan, state)
  const assembly: ShardAssembly = {
    planFile,
    plan,
    parts: [],
    declared: [],
    launches: new Set(),
    reports: new Set(),
    profiles: new Set(),
    intervals: [],
    reportsSummary: [],
  }
  for (const [position, entry] of index.shards.entries())
    await reconcileIndexedShard(entry, position, assembly, state)
  const expected = productionShardSelections(state.input.frozen.productionWorkloads).map(
    (entry) => `${entry.workload}/${entry.pair}`,
  )
  same(state, 'shardCoverage', assembly.declared, expected)
  if (new Set(assembly.declared).size !== assembly.declared.length)
    finding(
      state,
      'shardCoverage',
      'mismatch',
      'Duplicate shards cannot count as independent pairs.',
    )
  for (const [position, interval] of assembly.intervals.entries()) {
    if (position > 0 && interval.start < assembly.intervals[position - 1].end)
      finding(
        state,
        `shards.${position}.host.interval`,
        'mismatch',
        'Planned capture intervals must advance without overlap.',
      )
  }
  const workloads = state.input.frozen.productionWorkloads
  checkProductionKeys(
    state.samples.map((row) => `${row.workload}/${row.pair}/${row.engine}`),
    workloads,
    state,
  )
  for (const workload of workloads) productionWorkloadMetrics(workload.id, state)
  compareSamples(
    workloads.map((entry) => entry.id),
    941,
    state,
  )
  const { parts } = assembly
  state.metrics.quietHostEstablished =
    parts.length > 0 && parts.every((part) => part.metrics.quietHostEstablished === true)
      ? true
      : null
  state.metrics.productionBuild =
    parts.length > 0 && parts.every((part) => part.metrics.productionBuild === true) ? true : null
  state.metrics.shardCount = parts.length
  const verdict = reconciliationVerdict(state)
  return {
    schemaVersion: 2,
    kind: 'production',
    verdict,
    timingStatus: timingStatus('production', verdict),
    findings: state.findings,
    metrics: state.metrics,
    comparisons: state.comparisons,
    samples: state.samples,
    exclusions: state.exclusions,
    resourceTrials: state.resourceTrials,
    coverage: state.coverage,
    artifacts: [state.input.report, planFile]
      .map(({ path, sha256 }) => ({ path, sha256 }))
      .concat(parts.flatMap((part) => part.artifacts)),
    productionSummary: {
      provenance: plan?.provenance,
      frozenBudgetSha256: plan?.budgetSha256,
      familyCoverage: observedFamilyCoverage(workloads, state.coverage),
      resourcePlateaus: assembly.reportsSummary.flatMap((report) =>
        arrayField(report, 'resourcePlateaus'),
      ),
      failures: assembly.reportsSummary.flatMap((report) => arrayField(report, 'failures')),
      missing: assembly.reportsSummary.flatMap((report) => arrayField(report, 'missing')),
    },
    ...originalShardOutcomes(parts),
  }
}

function originalShardOutcomes(parts: readonly TimingReconciliationResult[]) {
  return {
    rawFailures: parts.map((part) => ({ report: part.artifacts[0], failures: part.rawFailures })),
    rawExclusions: parts.map((part) => ({
      report: part.artifacts[0],
      exclusions: part.rawExclusions,
    })),
  }
}

async function reconcileIndexedShard(
  entry: v.InferOutput<typeof productionShardIndex>['shards'][number],
  position: number,
  assembly: ShardAssembly,
  state: State,
) {
  const directory = path.dirname(state.input.report.path)
  const reportFile = await readTimingFile(
    path.resolve(directory, entry.report.path),
    state.input.root,
  )
  same(state, `shards.${position}.report.sha256`, reportFile.sha256, entry.report.sha256)
  if (assembly.reports.has(reportFile.path) || assembly.reports.has(reportFile.sha256))
    finding(
      state,
      `shards.${position}.report`,
      'mismatch',
      'A launch report was selected more than once.',
    )
  assembly.reports.add(reportFile.path)
  assembly.reports.add(reportFile.sha256)
  const report = parse(
    productionReport,
    observedJson(reportFile.contents),
    `shards.${position}.report`,
    state,
  )
  if (report) checkShardLaunch(report, position, assembly, state)
  const rawReport = observedJson(reportFile.contents)
  assembly.reportsSummary.push({
    resourcePlateaus: arrayField(rawReport, 'resourcePlateaus').map((row) => ({
      ...(typeof row === 'object' && row !== null ? row : {}),
      launchReport: reportFile.path,
    })),
    failures: arrayField(rawReport, 'failures'),
    missing: arrayField(rawReport, 'missing'),
  })
  const sidecars = await readTimingSidecars(
    entry.artifacts,
    path.dirname(reportFile.path),
    state.input.root,
  )
  if (assembly.plan) {
    same(
      state,
      `shards.${position}.build.sha256`,
      sidecars.build?.sha256,
      assembly.plan.build.metadataSha256,
    )
    same(
      state,
      `shards.${position}.buildManifest.sha256`,
      sidecars.buildManifest?.sha256,
      assembly.plan.build.manifestSha256,
    )
  }
  const part = await reconcileFiles({
    ...state.input,
    report: reportFile,
    artifacts: sidecars,
    capturedFiles: await readCapturedSources(sidecars.sourceCapture, state.input.root),
    trialRoot: path.dirname(reportFile.path),
    shard: true,
  })
  assembly.parts.push(part)
  mergeProductionShard(part, position, state)
}

function checkShardLaunch(
  report: v.InferOutput<typeof productionReport>,
  position: number,
  assembly: ShardAssembly,
  state: State,
) {
  const { shard } = report
  if (!shard) {
    finding(
      state,
      `shards.${position}.selection`,
      'missing',
      'Every indexed launch requires its original planned shard identity.',
    )
    return
  }
  same(state, `shards.${position}.planSha256`, shard.planSha256, assembly.planFile.sha256)
  same(state, `shards.${position}.provenance`, report.provenance, assembly.plan?.provenance)
  same(
    state,
    `shards.${position}.selection`,
    { workload: shard.workload, pair: shard.pair },
    assembly.plan?.shards[shard.index],
  )
  same(state, `shards.${position}.index`, shard.index, position)
  assembly.declared.push(`${shard.workload}/${shard.pair}`)
  if (assembly.launches.has(shard.launchId))
    finding(state, `shards.${position}.launchId`, 'mismatch', 'Launch identities must be unique.')
  assembly.launches.add(shard.launchId)
  const actualProfiles =
    report.browser.actualArgs?.filter((arg) => arg.startsWith('--user-data-dir=')) ?? []
  if (actualProfiles.length !== 1 || assembly.profiles.has(actualProfiles[0]))
    finding(
      state,
      `shards.${position}.browser.profile`,
      'mismatch',
      'Each actual launch requires its own browser profile.',
    )
  if (actualProfiles[0]) assembly.profiles.add(actualProfiles[0])
  const current = shardCohort(report)
  assembly.cohort ??= current
  same(state, `shards.${position}.cohort`, current, assembly.cohort)
  const interval = {
    start: Date.parse(report.host.before.observedAt),
    end: Date.parse(report.host.after.observedAt),
  }
  if (!(interval.start < interval.end) || interval.end - interval.start > 110 * 60 * 1000)
    finding(
      state,
      `shards.${position}.deadline`,
      'mismatch',
      'A shard must finish inside its bounded capture interval.',
    )
  assembly.intervals.push(interval)
}

function failedShardIndex(state: State): TimingReconciliationResult {
  return {
    schemaVersion: 2,
    kind: 'production',
    verdict: 'NOT VERIFIED',
    timingStatus: 'PROMOTION_CAPTURE_UNRECONCILED',
    findings: state.findings,
    metrics: state.metrics,
    comparisons: [],
    samples: [],
    exclusions: [],
    artifacts: [{ path: state.input.report.path, sha256: state.input.report.sha256 }],
    rawFailures: null,
    rawExclusions: [],
    resourceTrials: [],
    coverage: [],
  }
}

function checkProductionCapturePlan(
  plan: v.InferOutput<typeof productionCapturePlan>,
  state: State,
) {
  same(state, 'plan.purpose', plan.purpose, 'promotion')
  const provenance = parse(sourceIdentity, plan.provenance, 'plan.provenance', state)
  same(state, 'plan.provenance', provenance, state.input.frozen.provenance)
  const sources = parse(
    sourceCaptureArtifact.entries.provenance.entries.sources,
    field(plan.provenance, 'sources'),
    'plan.provenance.sources',
    state,
  )
  same(
    state,
    'plan.sourceClosureSha256',
    sha(JSON.stringify(sources)),
    state.input.frozen.provenance.sourceClosureSha256,
  )
  same(state, 'plan.budgetSha256', plan.budgetSha256, state.input.frozen.identity.budgetSha256)
  same(state, 'plan.workloadManifest', plan.workloadManifest, {
    schemaVersion: 1,
    domain: 'browser',
    build: 'production',
    workloads: state.input.frozen.productionWorkloads.map(manifestEntry),
  })
  same(
    state,
    'plan.shards',
    plan.shards,
    productionShardSelections(state.input.frozen.productionWorkloads),
  )
}

function mergeProductionShard(part: TimingReconciliationResult, index: number, state: State) {
  state.findings.push(
    ...part.findings.map((entry) => ({ ...entry, path: `shards.${index}.${entry.path}` })),
  )
  state.samples.push(...part.samples)
  state.exclusions.push(...part.exclusions)
  state.resourceTrials.push(
    ...part.resourceTrials.map((row) => ({
      ...row,
      launchReport: part.artifacts[0]?.path,
    })),
  )
  state.coverage.push(...part.coverage)
  for (const [key, value] of Object.entries(part.metrics)) {
    const previous = state.metrics[key]
    state.metrics[key] =
      typeof previous === 'number' && typeof value === 'number' ? Math.max(previous, value) : value
  }
}

function reconcileShardComparisons(
  report: v.InferOutput<typeof productionReport>,
  pair: number,
  state: State,
) {
  if (pair < 0) {
    same(
      state,
      'report.comparisons',
      report.comparisons,
      ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'].map((metric) => ({
        workload: report.shard?.workload,
        metric,
        selectedPairs: 0,
        excludedPairs: [],
        status: 'inconclusive',
        reason: 'No complete observed metric pairs.',
        independentTrials: 0,
      })),
    )
    return
  }
  for (const metric of ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const) {
    const workload = report.shard?.workload ?? ''
    const vector = metricPair(state.samples, pair, metric)
    const rows = report.comparisons.filter(
      (row) => field(row, 'workload') === workload && field(row, 'metric') === metric,
    )
    same(state, `${workload}.${metric}.reportedCount`, rows.length, 1)
    const reported = rows[0]
    same(state, `${workload}.${metric}.selectedPairs`, field(reported, 'selectedPairs'), 1)
    if (!vector) continue
    const comparison = {
      ...pairedConfidence({
        workload,
        metric,
        seed: 941,
        resamples: 4096,
        baseline: [vector.baseline],
        candidate: [vector.candidate],
      }),
      domain: 'browser' as const,
      build: 'production' as const,
    }
    state.comparisons.push(comparison)
  }
  reconcileReportedComparisons(report, state)
}

function present<T>(value: T | null): value is T {
  return value !== null
}
function sha(contents: string | Uint8Array) {
  return createHash('sha256').update(contents).digest('hex')
}
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Reflect.get(value, key)
}
function finding(
  state: Pick<State, 'findings'>,
  path: string,
  kind: TimingFinding['kind'],
  reason: string,
) {
  state.findings.push({ path, kind, reason })
}
function same(state: Pick<State, 'findings'>, path: string, actual: unknown, expected: unknown) {
  if (stable(actual) !== stable(expected))
    finding(
      state,
      path,
      'mismatch',
      'Observed value differs from the frozen or independently captured identity.',
    )
}
function readArtifact(artifact: TimingArtifact | null, path: string, state: State): unknown {
  if (!artifact) {
    finding(state, path, 'missing', 'Required actual artifact is missing.')
    return null
  }
  if (sha(artifact.contents) !== artifact.sha256) {
    finding(state, path, 'mismatch', 'Artifact bytes differ from their SHA-256.')
    return null
  }
  try {
    return JSON.parse(artifact.contents)
  } catch {
    finding(state, path, 'mismatch', 'Artifact is invalid JSON.')
    return null
  }
}
function parse<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: T,
  value: unknown,
  path: string,
  state: State,
): v.InferOutput<T> | null {
  const result = v.safeParse(schema, value)
  if (result.success) return result.output
  for (const issue of result.issues)
    finding(
      state,
      `${path}.${v.getDotPath(issue) ?? 'root'}`,
      'missing',
      'Required observed field is missing or invalid.',
    )
  return null
}
function artifact<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: T,
  name: keyof TimingReconciliationInput['artifacts'],
  state: State,
) {
  const candidate = state.input.artifacts[name]
  const value = readArtifact(typeof candidate === 'string' ? null : candidate, name, state)
  return value === null ? null : parse(schema, value, name, state)
}
function reconciliationVerdict(state: State): TimingReconciliationResult['verdict'] {
  if (state.findings.some((entry) => entry.kind !== 'missing')) return 'NOT VERIFIED'
  return state.findings.length > 0 ? 'INCONCLUSIVE' : 'VERIFIED'
}
function timingStatus(
  kind: TimingReconciliationInput['kind'],
  verdict: TimingReconciliationResult['verdict'],
): TimingReconciliationResult['timingStatus'] {
  if (kind === 'production')
    return verdict === 'VERIFIED'
      ? 'PROMOTION_CAPTURE_RECONCILED'
      : 'PROMOTION_CAPTURE_UNRECONCILED'
  return verdict === 'VERIFIED' ? 'NATIVE_CAPTURE_RECONCILED' : 'EXPLORATORY'
}
function rawExclusions(report: unknown): unknown[] {
  const direct = field(report, 'comparisons')
  const workloads = field(report, 'workloads')
  const nested = Array.isArray(workloads) ? workloads.flatMap(rawExclusions) : []
  if (!Array.isArray(direct)) return nested
  return nested.concat(
    direct.map((row) => field(row, 'excludedPairs')).filter((value) => value !== undefined),
  )
}
function preserveFailures(report: unknown, state: State) {
  const failures = field(report, 'failures')
  if (!Array.isArray(failures)) return
  failures.forEach((value, index) =>
    finding(
      state,
      `report.failures.${index}`,
      'failure',
      typeof value === 'string' ? value : JSON.stringify(value),
    ),
  )
}
function checkFreeze(state: State) {
  const frozen = state.input.frozen
  same(state, 'freeze.commit', frozen.provenance.revision, frozen.identity.candidateCommit)
  same(state, 'freeze.lockfile', frozen.provenance.lockfileSha256, frozen.identity.lockfileSha256)
  same(state, 'freeze.clean', frozen.provenance.trackedDiffSha256, sha(''))
  same(
    state,
    'freeze.workloadManifestSha256',
    nativeManifestHash(frozen.nativeWorkloads),
    frozen.identity.workloadManifestSha256,
  )
  if (frozenBudget.independentPairedTrials !== 20)
    finding(state, 'freeze.trials', 'mismatch', 'The frozen independent-pair denominator changed.')
}

function checkMeasurementControls(
  controls: v.InferOutput<typeof measurementControls>,
  state: State,
) {
  same(
    state,
    'report.controls.knownGood.observed',
    controls.knownGood.observed,
    controls.knownGood.expected,
  )
  same(
    state,
    'report.controls.knownGood.observedRevision',
    controls.knownGood.observedRevision,
    controls.knownGood.revision,
  )
  same(
    state,
    'report.controls.missingExpectation.rejected',
    controls.missingExpectation.rejected,
    true,
  )
  same(state, 'report.controls.wrongExpectation.rejected', controls.wrongExpectation.rejected, true)
  same(state, 'report.controls.longTask.supported', controls.longTask.supported, true)
  if (!controls.longTask.observed.some((duration) => duration > 50))
    finding(
      state,
      'report.controls.longTask.observed',
      'failure',
      'The measurement control observed no task longer than 50 milliseconds.',
    )
}

async function reconcileProduction(raw: unknown, state: State) {
  preserveFailures(raw, state)
  const report = parse(productionReport, raw, 'report', state)
  if (!report) return
  same(state, 'report.shardMode', Boolean(report.shard), Boolean(state.input.shard))
  checkMeasurementControls(report.controls, state)
  checkFreeze(state)
  same(state, 'report.capture.kind', report.capture.kind, 'promotion')
  same(state, 'report.timingStatus', report.timingStatus, 'PROMOTION_CAPTURE_UNRECONCILED')
  same(state, 'report.trials', report.trials, 20)
  same(state, 'report.warmups', report.warmups, 3)
  const provenance = parse(sourceIdentity, report.provenance, 'report.provenance', state)
  same(state, 'report.provenance', provenance, state.input.frozen.provenance)
  same(
    state,
    'report.frozenBudgetSha256',
    report.frozenBudgetSha256,
    state.input.frozen.identity.budgetSha256,
  )
  const host = artifact(hostArtifact, 'host', state)
  const quietHost = artifact(quietHostArtifact, 'quietHost', state)
  if (host) {
    same(
      state,
      'report.capture.hostEvidence.sha256',
      report.capture.hostEvidence?.sha256,
      state.input.artifacts.host?.sha256,
    )
    same(
      state,
      'report.capture.hostEvidence.observation',
      report.capture.hostEvidence?.observation,
      readArtifact(state.input.artifacts.host, 'host', state),
    )
    same(state, 'host.id', report.host.id, host.host)
  }
  if (quietHost) {
    same(state, 'quietHost.reportSha256', quietHost.reportSha256, state.input.report.sha256)
    same(state, 'quietHost.host', quietHost.host, report.host.id)
    for (const name of [
      'platform',
      'architecture',
      'hardware',
      'osRelease',
      'memoryBytes',
    ] as const)
      same(state, `quietHost.${name}`, report.host[name], quietHost[name])
    for (const [name, observation] of Object.entries({
      before: report.host.before,
      after: report.host.after,
    })) {
      if (observation.loadAverage.some((load) => load / observation.logicalCpus > 0.25))
        finding(
          state,
          `host.${name}.loadAverage`,
          'mismatch',
          'The producer observed a nonquiet run boundary.',
        )
    }
    checkQuietHost(quietHost, report.host.before.observedAt, report.host.after.observedAt, state)
  }
  if (host) timestamp(host.observedAt, 'host.observedAt', state)
  if (host && Date.parse(host.observedAt) > Date.parse(report.host.before.observedAt))
    finding(
      state,
      'host.observedAt',
      'mismatch',
      'Pre-run host evidence was captured after the run began.',
    )
  if (
    !host ||
    !quietHost ||
    state.findings.some((entry) =>
      /^(?:quietHost|host|report.capture.hostEvidence)/u.test(entry.path),
    )
  )
    state.metrics.quietHostEstablished = null
  const build = reconcileBuild(report, state)
  reconcileBrowser(report, state)
  if (state.input.shard) checkSourceCapture({ sourceFiles: [] }, state, false)
  const fonts = artifact(fontsArtifact, 'fonts', state)
  checkFonts([], fonts, report.host.id, build, state)
  await reconcileProductionRows(report, fonts, state)
  state.metrics.hostId = report.host.id
  state.metrics.browserVersion = report.browser.version
  state.metrics.runtimeVersion = runtimeVersion(field(report.provenance, 'runtime'))
  if (state.metrics.runtimeVersion === null)
    finding(
      state,
      'report.provenance.runtime',
      'missing',
      'Actual Bun and Node runtime versions are required.',
    )
}
function runtimeVersion(value: unknown) {
  const bun = field(value, 'bun')
  const node = field(value, 'node')
  return typeof bun === 'string' && typeof node === 'string' ? `Bun ${bun}; Node ${node}` : null
}
function timestamp(value: string, path: string, state: State) {
  const time = Date.parse(value)
  if (!Number.isFinite(time))
    finding(state, path, 'missing', 'A valid observed timestamp is required.')
  return time
}
function checkQuietHost(
  host: v.InferOutput<typeof quietHostArtifact>,
  startedAt: string,
  finishedAt: string,
  state: State,
) {
  const before = state.findings.length
  const start = timestamp(startedAt, 'host.run.startedAt', state)
  const end = timestamp(finishedAt, 'host.run.finishedAt', state)
  const times = host.observations.map((sample) =>
    timestamp(sample.observedAt, 'host.observations.observedAt', state),
  )
  if (
    !(start < end) ||
    !(times[0] < start) ||
    !((times.at(-1) ?? NaN) > end) ||
    !times.some((time) => time > start && time < end)
  )
    finding(
      state,
      'host.observations',
      'missing',
      'Quiet observations must cover before, during and after the measured run.',
    )
  for (const [index, sample] of host.observations.entries()) {
    if (sample.logicalCpus !== host.observations[0].logicalCpus)
      finding(
        state,
        `host.observations.${index}.logicalCpus`,
        'mismatch',
        'The reported host CPU count changed during the capture.',
      )
    if (index > 0 && (times[index] <= times[index - 1] || times[index] - times[index - 1] > 5000))
      finding(
        state,
        `host.observations.${index}`,
        'missing',
        'Quiet observation timestamps must advance with gaps no longer than 5 seconds.',
      )
    if (
      sample.ownerBusy ||
      !sample.acPower ||
      sample.runningJobs.length > 0 ||
      sample.competingCpuPercent > 5 ||
      sample.loadAverage.some((load) => load / sample.logicalCpus > 0.25)
    )
      finding(
        state,
        `host.observations.${index}`,
        'mismatch',
        'Observed reservation, power, job activity or load does not establish a quiet timing interval.',
      )
  }
  if (state.findings.length === before) state.metrics.quietHostEstablished = true
}
export const wasmBuildRoles = [
  { field: 'grammarSha256', file: /^tree-sitter-markdown(?:-(?!chat(?:-|\.))[\w-]+)?\.wasm$/u },
  { field: 'chatGrammarSha256', file: /^tree-sitter-markdown-chat(?:-[\w-]+)?\.wasm$/u },
  { field: 'resolverSha256', file: /^tree-sitter-md(?:-[\w-]+)?\.wasm$/u },
] as const

function reconcileBuild(report: v.InferOutput<typeof productionReport>, state: State) {
  const before = state.findings.length
  const build = artifact(buildArtifact, 'build', state)
  const manifest = state.input.artifacts.buildManifest
  if (!manifest)
    finding(state, 'buildManifest', 'missing', 'Actual served Vite manifest bytes are required.')
  if (!build || !manifest) return
  same(state, 'buildManifest.sha256', sha(manifest.contents), manifest.sha256)
  same(state, 'build.artifactManifestSha256', build.artifactManifestSha256, manifest.sha256)
  same(state, 'build.sourceBefore', build.sourceBefore, state.input.frozen.provenance)
  same(state, 'build.sourceAfter', build.sourceAfter, state.input.frozen.provenance)
  same(state, 'build.budgetSha256', build.budgetSha256, state.input.frozen.identity.budgetSha256)
  for (const { field: name, file } of wasmBuildRoles) {
    const matching = build.artifacts.filter((entry) => file.test(path.posix.basename(entry.file)))
    if (matching.length !== 1) {
      finding(
        state,
        `build.${name}`,
        matching.length === 0 ? 'missing' : 'mismatch',
        'The build requires exactly one artifact for each frozen WASM role.',
      )
      continue
    }
    same(state, `build.${name}`, matching[0].sha256, state.input.frozen.identity[name])
  }
  same(state, 'report.servedBuild', report.servedBuild, {
    revision: build.sourceAfter.revision,
    sourceClosureSha256: build.sourceAfter.sourceClosureSha256,
    budgetSha256: build.budgetSha256,
    artifactManifestSha256: build.artifactManifestSha256,
    artifactCount: build.artifacts.length,
  })
  state.metrics.productionBuild = state.findings.length === before ? true : null
  return build
}
function reconcileBrowser(report: v.InferOutput<typeof productionReport>, state: State) {
  const browser = artifact(browserArtifact, 'browser', state)
  same(state, 'browser.name', report.browser.name, 'chromium')
  same(state, 'browser.headless', report.browser.headless, false)
  if (!report.browser.actualArgs || !report.browser.executablePath)
    finding(
      state,
      'browser',
      'missing',
      'Actual browser arguments and an explicit executable are required.',
    )
  if (
    report.browser.actualArgs?.some((arg) =>
      /^--(?:headless|enable-precise-memory-info|js-flags|(?:enable-)?profil(?:e|ing)?|(?:cpu|heap)-prof|trace-startup|inspect(?:-brk)?)(?:[-=]|$)/iu.test(
        arg,
      ),
    )
  )
    finding(
      state,
      'browser.actualArgs',
      'mismatch',
      'Instrumented or headless browser arguments cannot qualify production timing.',
    )
  if (!browser) return
  same(state, 'browser.host', browser.host, report.host.id)
  same(state, 'browser.version', browser.version, report.browser.version)
  same(state, 'browser.executablePath', browser.executablePath, report.browser.executablePath)
  same(state, 'browser.args', browser.args, report.browser.actualArgs)
  same(state, 'browser.executableArg', browser.args[0], browser.executablePath)
  if (!report.browser.requestedArgs.every((arg) => browser.args.includes(arg)))
    finding(
      state,
      'browser.requestedArgs',
      'mismatch',
      'An explicitly requested browser argument is absent from the actual command line.',
    )
}
function productionKey(row: Pick<ProductionRow, 'workload' | 'pair' | 'engine'>) {
  return `${row.workload}/${row.pair}/${row.engine}`
}
function checkFonts(
  rows: readonly ProductionRow[],
  fonts: v.InferOutput<typeof fontsArtifact> | null,
  host: string,
  build: v.InferOutput<typeof buildArtifact> | undefined,
  state: State,
) {
  if (!fonts) return
  same(state, 'fonts.host', fonts.host, host)
  same(state, 'fonts.fingerprint', fonts.fingerprint, state.input.frozen.fontFingerprint)
  same(
    state,
    'fonts.fileFingerprint',
    sha(stable({ files: fonts.files, fontFamily: fonts.fontFamily, fonts: fonts.fonts })),
    fonts.fingerprint,
  )
  for (const file of fonts.files) {
    if (
      build &&
      !build.artifacts.some(
        (entry) => entry.file === file.path.split('/').at(-1) && entry.sha256 === file.sha256,
      )
    )
      finding(
        state,
        `fonts.files.${file.path}`,
        'mismatch',
        'Font file bytes are not bound to the actual build artifact list.',
      )
  }
  if (fonts.fonts.some((entry) => entry.status === 'error'))
    finding(state, 'fonts.status', 'mismatch', 'A declared font face failed to load at navigation.')
  for (const row of rows)
    same(state, `fonts.${productionKey(row)}.environment`, row.environment, {
      fontFamily: fonts.fontFamily,
      fonts: fonts.fonts,
    })
  state.metrics.fontFingerprint = fonts.fingerprint
}

async function reconcileProductionRows(
  report: v.InferOutput<typeof productionReport>,
  fonts: v.InferOutput<typeof fontsArtifact> | null,
  state: State,
) {
  const frozenWorkloads = state.input.frozen.productionWorkloads
  const selection = state.input.shard ? report.shard : undefined
  const workloads = selection
    ? frozenWorkloads.filter((entry) => entry.id === selection.workload)
    : frozenWorkloads
  const pairs = selection ? [selection.pair] : Array.from({ length: 23 }, (_, index) => index - 3)
  if (workloads.length === 0)
    finding(
      state,
      'freeze.productionWorkloads',
      'missing',
      'The exact frozen production matrix is required.',
    )
  same(state, 'report.workloadManifest', report.workloadManifest, {
    schemaVersion: 1,
    domain: 'browser',
    build: 'production',
    workloads: frozenWorkloads.map(manifestEntry),
  })
  same(
    state,
    'report.selectedWorkloads',
    report.selectedWorkloads,
    workloads.map(({ source, ...entry }) => ({ ...entry, sourceSha256: sha(source) })),
  )
  const keys: string[] = []
  const oraclePaths = new Set<string>()
  let pending: ProductionRow | null = null
  let currentWorkload: ProductionWorkload | undefined
  let expectedInputs: readonly ProductionInput[] = []
  let measured = 0
  await foldTimingRecords(report.trialsArtifact, productionTrial, state, async (row, index) => {
    const span = pairs.length * 2
    const expectedWorkload = workloads[Math.floor(index / span)]
    const pair = pairs[Math.floor((index % span) / 2)]
    const order = Math.abs(pair) % 2 === 0 ? 'AB' : 'BA'
    const engines = order === 'AB' ? ['remark', 'tree-sitter'] : ['tree-sitter', 'remark']
    same(
      state,
      `trials.record.${index}.order`,
      productionKey(row),
      `${expectedWorkload?.id}/${pair}/${engines[index % 2]}`,
    )
    keys.push(productionKey(row))
    const oraclePath = row.correctness.artifact.path
    if (oraclePaths.has(oraclePath))
      finding(
        state,
        `${productionKey(row)}.oraclePath`,
        'mismatch',
        'Independent arms must own distinct oracle artifacts.',
      )
    oraclePaths.add(oraclePath)
    const workload = workloads.find((entry) => entry.id === row.workload)
    if (!workload) return
    if (currentWorkload !== workload) {
      currentWorkload = workload
      expectedInputs = productionUpdates(workload).concat([workload.source]).map(productionInput)
    }
    reconcileProductionRow(row, workload, expectedInputs, fonts, state)
    if (row.pair >= 0) {
      same(
        state,
        `report.sampleSummaries.${measured}`,
        report.sampleSummaries[measured],
        productionRowSummary(row),
      )
      measured++
    }
    if (pending) {
      same(
        state,
        `${row.workload}/${row.pair}.pairIdentity`,
        [pending.workload, pending.pair, pending.order],
        [row.workload, row.pair, row.order],
      )
      await reconcileOraclePair(pending, row, expectedInputs, state)
      pending = null
      return
    }
    pending = row
  })
  checkProductionKeys(keys, workloads, state, pairs)
  same(state, 'report.sampleSummaries.length', report.sampleSummaries.length, measured)
  same(
    state,
    'report.familyCoverage',
    report.familyCoverage,
    observedFamilyCoverage(frozenWorkloads, state.coverage),
  )
  for (const workload of workloads) productionWorkloadMetrics(workload.id, state)
  if (selection) {
    reconcileShardComparisons(report, selection.pair, state)
    return
  }
  compareSamples(
    workloads.map((entry) => entry.id),
    941,
    state,
  )
  reconcileReportedComparisons(report, state)
}
async function reconcileOraclePair(
  first: ProductionRow,
  second: ProductionRow,
  inputs: readonly ProductionInput[],
  state: State,
) {
  try {
    const artifacts = await reconcileProductionOracles({
      root: state.input.trialRoot ?? state.input.root,
      first,
      second,
      inputs,
    })
    state.observedArtifacts.push(
      ...artifacts.map((entry) => ({
        ...entry,
        path: path.resolve(state.input.trialRoot ?? state.input.root, entry.path),
      })),
    )
  } catch (error) {
    finding(
      state,
      `${productionKey(second)}.oracle`,
      'mismatch',
      error instanceof Error ? error.message : 'Independent oracle artifact failed.',
    )
  }
}
function observedFamilyCoverage(
  workloads: readonly ProductionWorkload[],
  rows: readonly CoverageTimingObservation[],
) {
  return BENCHMARK_FAMILIES.map((family) => {
    const expected = workloads.filter((entry) => entry.family === family)
    const measured = expected.filter((entry) =>
      ['remark', 'tree-sitter'].every((engine) =>
        rows.some((row) => row.workload === entry.id && row.engine === engine),
      ),
    )
    return {
      family,
      selectedCells: expected.length,
      pairedObservedCells: measured.length,
      status: measured.length === 0 ? 'NOT_MEASURED' : 'EXPLORATORY',
    }
  })
}
function productionRowSummary(row: ProductionRow) {
  return {
    workload: row.workload,
    engine: row.engine,
    pair: row.pair,
    processedUpdates: row.receipt.processed.length,
    observedPaints: row.receipt.frames.length,
    skippedPaintRevisions: row.receipt.skippedPaintRevisions,
    elapsedReplayMs: row.receipt.ended - row.receipt.started,
    prefixPaintMs: distribution(row.receipt.frames.map((tick) => tick.painted - tick.received)),
    updateMainThreadCpuMs: distribution(row.updateCpu.map((tick) => tick.mainThreadCpuMs)),
    parserWallMs: distribution(row.receipt.processed.map((tick) => tick.parserWallMs)),
    producerLatenessMs: distribution(
      row.receipt.processed.map((tick) => tick.received - tick.scheduled),
    ),
    settlementMs: row.receipt.fullyReady - row.receipt.final.received,
    heldSyntaxReleaseMs: row.receipt.heldSyntax
      ? row.receipt.heldSyntax.released.painted - row.receipt.heldSyntax.released.received
      : null,
    streamCombinedCpuMs: reportedSummaryCpu(row),
    transferred: productionPayloadSummary(row.network),
  }
}

function reportedSummaryCpu(row: ProductionRow) {
  if (!row.workers || row.workerCpu === null || row.streamMainThreadCpuMs === null) return null
  if (row.workerCpu.length !== row.workers.created || row.workers.active > row.workers.created)
    return null
  if (row.workerCpu.some((worker) => worker.measurement !== 'complete' || worker.cpuMs === null))
    return null
  return (
    row.streamMainThreadCpuMs + row.workerCpu.reduce((sum, worker) => sum + (worker.cpuMs ?? 0), 0)
  )
}
async function foldTimingRecords<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  reference: v.InferOutput<typeof rawTimingRef>,
  schema: T,
  state: State,
  consume: (record: v.InferOutput<T>, index: number) => void | Promise<void>,
) {
  const filename = state.input.artifacts.trials
  if (!filename) {
    finding(state, 'trials', 'missing', 'The canonical raw timing artifact is required.')
    return
  }
  try {
    same(state, 'trials.manifestPath', filename, reference.path)
    if (filename !== reference.path) return
    const root = state.input.trialRoot ?? state.input.root
    const actual = await hashFile({ root, file: filename })
    state.observedArtifacts.push({ ...actual, path: path.resolve(root, actual.path) })
    same(state, 'trials.path', actual.path, reference.path)
    if (actual.path !== reference.path) return
    await foldJsonl({
      root,
      file: filename,
      expected: reference,
      parse: (value, index) => {
        const parsed = parse(schema, value, `trials.record.${index}`, state)
        if (!parsed)
          throw createScriptError('Raw timing record is invalid.', { internal: { index } })
        return parsed
      },
      consume,
    })
  } catch (error) {
    finding(
      state,
      'trials',
      'mismatch',
      error instanceof Error ? error.message : 'Raw timing artifact could not be read completely.',
    )
  }
}
function productionInput(source: string): ProductionInput {
  return { inputSha256: sha(source), inputUtf16Units: source.length }
}
function reconcileProductionRow(
  row: ProductionRow,
  workload: ProductionWorkload,
  inputs: readonly ProductionInput[],
  fonts: v.InferOutput<typeof fontsArtifact> | null,
  state: State,
) {
  const key = productionKey(row)
  same(state, `${key}.family`, row.family, workload.family)
  same(state, `${key}.arrival`, row.arrival, workload.arrival)
  same(state, `${key}.cache`, row.cache, workload.cache)
  same(state, `${key}.order`, row.order, Math.abs(row.pair) % 2 === 0 ? 'AB' : 'BA')
  if (fonts)
    same(state, `fonts.${key}.environment`, row.environment, {
      fontFamily: fonts.fontFamily,
      fonts: fonts.fonts,
    })
  validateProductionReceipt(row, inputs, state)
  const summary = summarizeProduction(row, state)
  state.samples.push(summary)
  checkOrdinary(row, summary, workload, state)
  if (row.pair < 0) return
  state.coverage.push({
    workload: row.workload,
    pair: row.pair,
    engine: row.engine,
    family: workload.family,
  })
  if (row.resourceWindows !== null || row.resourceControlWindows !== null)
    state.resourceTrials.push({
      workload: row.workload,
      pair: row.pair,
      engine: row.engine,
      resourceWindows: row.resourceWindows,
      resourceControlWindows: row.resourceControlWindows,
    })
}
function manifestEntry(entry: ProductionWorkload) {
  return {
    id: entry.id,
    sourceBytes: entry.sourceBytes,
    sourceSha256: sha(entry.source),
    scheduleUnits: entry.scheduleUnits,
    scheduleId: entry.scheduleId,
    arrival: entry.arrival,
    metrics: ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'],
    expectedInputUpdates: productionUpdates(entry).length + 1,
    paintPolicy: entry.arrival === 'paced' ? 'every-revision' : 'sampled',
  }
}
function checkProductionKeys(
  keys: readonly string[],
  workloads: readonly ProductionWorkload[],
  state: State,
  pairs: readonly number[] = Array.from({ length: 23 }, (_, index) => index - 3),
) {
  const expected = workloads.flatMap((workload) =>
    pairs.flatMap((pair) =>
      ['remark', 'tree-sitter'].map((engine) => `${workload.id}/${pair}/${engine}`),
    ),
  )
  same(state, 'report.trialKeys', keys.toSorted(), expected.sort())
  if (new Set(keys).size !== keys.length)
    finding(
      state,
      'report.trialKeys',
      'mismatch',
      'Duplicate engine trials cannot count as independent pairs.',
    )
}
function productionWorkloadMetrics(workload: string, state: State) {
  const first = state.samples.find((sample) => sample.workload === workload && !sample.warmup)
  state.metrics[`${workload}.processedInputs`] = first?.processedInputs ?? null
  state.metrics[`${workload}.completionReceipts`] = first?.processedInputs ?? null
  state.metrics[`${workload}.paintedUpdates`] = first?.paintedUpdates ?? null
  state.metrics[`${workload}.unpaintedUpdates`] = first?.unpaintedUpdates ?? null
}
export function validateProductionReceipt(
  row: ProductionRow,
  inputs: readonly ProductionInput[],
  state: Pick<State, 'findings'>,
) {
  const key = productionKey(row)
  const receipt = row.receipt
  same(state, `${key}.inputCount`, receipt.processed.length, inputs.length)
  same(state, `${key}.correctnessCount`, row.correctness.frames.length, inputs.length)
  if (new Set(receipt.processed.map((tick) => tick.revision)).size !== inputs.length)
    finding(state, `${key}.revisions`, 'mismatch', 'Missing or duplicate processing completions.')
  receipt.processed.forEach((tick, index) => checkProcessed(row, tick, inputs[index], index, state))
  const required = receipt.processed
    .filter(
      (_, index) => row.arrival === 'paced' || (index + 1) % 32 === 0 || index >= inputs.length - 2,
    )
    .map((tick) => tick.revision)
  same(
    state,
    `${key}.paintRevisions`,
    receipt.frames.map((tick) => tick.revision),
    required,
  )
  const requiredRevisions = new Set(required)
  same(
    state,
    `${key}.skippedPaintRevisions`,
    receipt.skippedPaintRevisions,
    receipt.processed
      .filter((tick) => !requiredRevisions.has(tick.revision))
      .map((tick) => tick.revision),
  )
  const processedIndexes = new Map<number, number>()
  receipt.processed.forEach((tick, index) => {
    if (!processedIndexes.has(tick.revision)) processedIndexes.set(tick.revision, index)
  })
  for (const tick of receipt.frames) checkPaint(row, tick, processedIndexes, state)
  same(state, `${key}.final`, receipt.final, receipt.frames.at(-1))
  same(state, `${key}.finalRevision`, receipt.final.revision, receipt.processed.at(-1)?.revision)
  same(
    state,
    `${key}.fullyReadyOutput`,
    receipt.fullyReadyOutput,
    row.correctness.final.paintedOutput,
  )
  same(
    state,
    `${key}.freshCompleted`,
    [row.freshCompleted.inputSha256, row.freshCompleted.paintedOutput],
    [row.correctness.final.inputSha256, row.correctness.final.paintedOutput],
  )
  same(state, `${key}.finalOracle`, row.correctness.final, row.correctness.frames.at(-1))
  if (
    row.correctness.final.paintedOutput.textBytes === 0 ||
    receipt.ended < receipt.started ||
    receipt.fullyReady < receipt.final.painted ||
    receipt.ended < receipt.fullyReady
  )
    finding(
      state,
      `${key}.readiness`,
      'mismatch',
      'Completed output is empty or its processing/readiness clock is reversed.',
    )
}
function checkProcessed(
  row: ProductionRow,
  tick: ProductionRow['receipt']['processed'][number],
  input: ProductionInput | undefined,
  index: number,
  state: Pick<State, 'findings'>,
) {
  const key = `${productionKey(row)}.processed.${index}`
  same(
    state,
    `${key}.input`,
    [tick.inputSha256, tick.inputUtf16Units, tick.live],
    input === undefined
      ? null
      : [input.inputSha256, input.inputUtf16Units, index + 1 < row.receipt.processed.length],
  )
  const oracle = row.correctness.frames[index]
  same(state, `${key}.oracleInput`, oracle?.inputSha256, tick.inputSha256)

  if (
    tick.received < tick.scheduled ||
    tick.committed < tick.received ||
    (index > 0 && tick.revision <= row.receipt.processed[index - 1].revision)
  )
    finding(state, key, 'mismatch', 'Processing timestamps or revision order are invalid.')
}
function checkPaint(
  row: ProductionRow,
  tick: ProductionRow['receipt']['frames'][number],
  processedIndexes: ReadonlyMap<number, number>,
  state: Pick<State, 'findings'>,
) {
  const index = processedIndexes.get(tick.revision) ?? -1
  const processed = row.receipt.processed[index]
  const oracle = row.correctness.frames[index]
  const { observedRevision, painted, paintedOutput, ...completion } = tick
  same(state, `${productionKey(row)}.paint.${tick.revision}.completion`, completion, processed)
  same(
    state,
    `${productionKey(row)}.paint.${tick.revision}.projection`,
    paintedOutput,
    oracle?.paintedOutput,
  )
  if (observedRevision !== tick.revision || painted < tick.committed)
    finding(
      state,
      `${productionKey(row)}.paint.${tick.revision}`,
      'mismatch',
      'Paint observes a stale revision or precedes its completion.',
    )
}
function exclusion(
  state: State,
  row: ProductionRow,
  metric: TimingExclusion['metric'],
  reason: string,
) {
  state.exclusions.push({
    workload: row.workload,
    pair: row.pair,
    engine: row.engine,
    metric,
    reason,
  })
  if (row.pair >= 0) finding(state, `${productionKey(row)}.${metric}`, 'missing', reason)
}
function productionCpu(row: ProductionRow, state: State): number | null {
  if (row.streamMainThreadCpuMs === null || row.workers === null || row.workerCpu === null) {
    exclusion(
      state,
      row,
      'streamCpu',
      'Main-thread CPU, worker census or dedicated-worker CPU receipts are unavailable.',
    )
    return null
  }
  if (
    row.workers.created !== row.workerCpu.length ||
    row.workers.active > row.workers.created ||
    new Set(row.workerCpu.map((entry) => entry.targetId)).size !== row.workerCpu.length
  ) {
    exclusion(
      state,
      row,
      'streamCpu',
      'Worker receipts do not cover the actual worker census exactly.',
    )
    return null
  }
  const incomplete = row.workerCpu.find(
    (entry) =>
      entry.measurement !== 'complete' ||
      entry.cpuMs === null ||
      entry.threadId === null ||
      entry.pid === null ||
      entry.incompleteTaskCount > 0 ||
      entry.boundaryCrossingTaskCount > 0 ||
      entry.coveredCpuMs !== entry.cpuMs,
  )
  if (incomplete) {
    exclusion(
      state,
      row,
      'streamCpu',
      incomplete.reason ??
        'Worker CPU has missing thread identity or incomplete/boundary-crossing tasks.',
    )
    return null
  }
  return (
    row.streamMainThreadCpuMs + row.workerCpu.reduce((sum, entry) => sum + (entry.cpuMs ?? 0), 0)
  )
}
function productionTransfer(row: ProductionRow, state: State): number | null {
  if (row.network === null) {
    exclusion(state, row, 'transfer', 'Transfer receipts are unavailable.')
    return null
  }
  if (ambiguousRequests(row.network)) {
    finding(
      state,
      `${productionKey(row)}.network`,
      'mismatch',
      'Duplicate or ambiguous request identity in page/worker transfer receipts.',
    )
    exclusion(
      state,
      row,
      'transfer',
      'Duplicate or ambiguous request identity cannot establish transfer bytes.',
    )
    return null
  }
  const requests = reconcileProductionNetworkRequests(row.network)
  const counted = requests.filter(
    (request) => request.resolvedByWorkerRequestId === null && !isSustainedProductStream(request),
  )
  const unresolvedAlias = requests.find(
    (request) =>
      request.resolvedByWorkerRequestId !== null &&
      !requests.some(
        (other) =>
          other.target === 'worker' &&
          other.id === request.resolvedByWorkerRequestId &&
          other.url === request.url &&
          other.kind === request.kind &&
          other.transferredBytes !== null &&
          other.failure === null,
      ),
  )
  const incomplete = counted.find(
    (request) =>
      request.transferredBytes === null ||
      request.failure !== null ||
      request.transferReceiptError ||
      request.transferScope !== 'full-request' ||
      !transferBytesAgree(request),
  )
  if (unresolvedAlias || incomplete) {
    exclusion(
      state,
      row,
      'transfer',
      incomplete?.failure ??
        incomplete?.transferReceiptError ??
        'An included transfer or page/worker exclusion has incomplete evidence.',
    )
    return null
  }
  state.metrics[`${productionKey(row)}.excludedTransferCopies`] = requests.length - counted.length
  return counted.reduce((sum, request) => sum + (request.transferredBytes ?? 0), 0)
}
function ambiguousRequests(requests: readonly v.InferOutput<typeof network>[]) {
  const identities = new Set<string>()
  for (const request of requests) {
    const identity = JSON.stringify([request.target, request.workerTargetId, request.id])
    if (identities.has(identity)) return true
    identities.add(identity)
    const aliases = requests.filter(
      (other) => other.target !== request.target && other.id === request.id,
    )
    if (aliases.length > 1) return true
    if (aliases.some((other) => other.url !== request.url || other.kind !== request.kind))
      return true
    if (request.resolvedByWorkerRequestId === null) continue
    const matches = requests.filter(
      (other) =>
        other.target === 'worker' &&
        other.id === request.resolvedByWorkerRequestId &&
        other.url === request.url &&
        other.kind === request.kind,
    )
    if (request.target !== 'page' || matches.length !== 1) return true
    if (
      requests.filter(
        (other) =>
          other.target === 'page' &&
          other.resolvedByWorkerRequestId === request.resolvedByWorkerRequestId &&
          other.url === request.url &&
          other.kind === request.kind,
      ).length !== 1
    )
      return true
  }
  return false
}
function transferBytesAgree(request: v.InferOutput<typeof network>) {
  const trace = request.traceTransferReceipt
  if (trace)
    return request.transferredBytes === trace.responseEncodedBytes + trace.receivedEncodedBytes
  return request.transferredBytes === request.completionEncodedBytes
}
function p95(values: readonly number[]): number | null {
  return values.length > 0 ? percentile(values, 0.95) : null
}
function summarizeProduction(row: ProductionRow, state: State): TimingSample {
  return {
    workload: row.workload,
    pair: row.pair,
    engine: row.engine,
    warmup: row.pair < 0,
    processedInputs: row.receipt.processed.length,
    paintedUpdates: row.receipt.frames.length,
    unpaintedUpdates: row.receipt.skippedPaintRevisions.length,
    updateP95: p95(row.receipt.frames.map((tick) => tick.painted - tick.received)),
    settlementP95: row.receipt.fullyReady - row.receipt.final.received,
    mountP95:
      row.receipt.frames.length > 0
        ? row.navigationMs + row.receipt.frames[0].painted - row.receipt.started
        : null,
    streamCpu: productionCpu(row, state),
    transferredBytes: productionTransfer(row, state),
  }
}
function checkOrdinary(
  row: ProductionRow,
  sample: TimingSample,
  workload: ProductionWorkload,
  state: State,
) {
  if (row.pair < 0) return
  const limits = frozenBudget.ordinaryStreaming
  if (
    workload.arrival !== 'paced' ||
    workload.scheduleUnits !== limits.scheduleUtf16Units ||
    workload.sourceBytes > limits.maximumSourceBytes
  )
    return
  const held = row.receipt.heldSyntax
  const cpuRevisions = row.receipt.processed
    .map((tick) => tick.revision)
    .concat(held ? [held.held.revision, held.released.revision] : [])
  if (
    cpuRevisions.some(
      (revision) => row.updateCpu.filter((tick) => tick.revision === revision).length !== 1,
    )
  )
    finding(
      state,
      `${productionKey(row)}.updateCpu`,
      'missing',
      'Every processed and held/released revision needs one thread CPU receipt.',
    )
  const values = {
    prefixProjectionP95Ms: sample.updateP95,
    heldSyntaxReleaseP95Ms: held ? held.released.painted - held.released.received : null,
    mainThreadP95Ms: p95(row.updateCpu.map((tick) => tick.mainThreadCpuMs)),
    maximumAttributableTaskMs:
      row.receipt.longTasks === null ? null : Math.max(0, ...row.receipt.longTasks),
  }
  const maximums = {
    prefixProjectionP95Ms: limits.p95PrefixProjectionMs,
    heldSyntaxReleaseP95Ms: limits.p95HeldSyntaxReleaseMs,
    mainThreadP95Ms: limits.p95MainThreadMs,
    maximumAttributableTaskMs: limits.maximumAttributableTaskMs,
  }
  for (const name of Object.keys(values))
    checkOrdinaryValue(name, field(values, name), field(maximums, name), row, state)
  if (
    held &&
    (held.held.painted < held.held.committed ||
      held.released.painted < held.released.committed ||
      held.released.received < held.held.received ||
      held.holdMs < 0)
  )
    finding(
      state,
      `${productionKey(row)}.heldSyntax`,
      'mismatch',
      'Held/released revision timestamps are invalid.',
    )
}
function checkOrdinaryValue(
  name: string,
  value: unknown,
  maximum: unknown,
  row: ProductionRow,
  state: State,
) {
  const key = `${row.workload}.${name}`
  if (typeof value !== 'number' || value < 0) {
    finding(
      state,
      `${productionKey(row)}.${name}`,
      'missing',
      'Ordinary latency or CPU observation is missing or invalid.',
    )
    state.metrics[key] = null
    return
  }
  if (typeof maximum === 'number' && value > maximum)
    finding(
      state,
      `${productionKey(row)}.${name}`,
      'failure',
      'Observed ordinary metric exceeds its frozen budget.',
    )
  const previous = state.metrics[key]
  if (previous !== null)
    state.metrics[key] = Math.max(typeof previous === 'number' ? previous : 0, value)
}
function compareSamples(workloads: readonly string[], seed: number, state: State) {
  workloads.forEach((workload, index) =>
    compareWorkload(workload, state.input.kind === 'production' ? seed + index : seed, state),
  )
}
function compareWorkload(workload: string, seed: number, state: State) {
  for (const metric of ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const) {
    const rows = state.samples.filter((sample) => sample.workload === workload && !sample.warmup)
    const vectors = Array.from({ length: 20 }, (_, pair) => metricPair(rows, pair, metric)).filter(
      present,
    )
    if (vectors.length < 20)
      finding(
        state,
        `${workload}.${metric}`,
        'missing',
        'Fewer than 20 complete independent paired observations remain; excluded CPU stays null.',
      )
    if (vectors.length === 0) continue
    const result = pairedConfidence({
      workload,
      metric,
      seed,
      resamples: 4096,
      baseline: vectors.map((pair) => pair.baseline),
      candidate: vectors.map((pair) => pair.candidate),
    })
    const domain = state.input.kind === 'production' ? 'browser' : 'native'
    const build = state.input.kind === 'production' ? 'production' : 'source'
    state.comparisons.push({ ...result, domain, build })
    if (result.status !== 'passed')
      finding(
        state,
        `${workload}.${metric}.confidence`,
        result.status === 'failed' ? 'failure' : 'missing',
        `Recomputed paired confidence bound is ${result.status}.`,
      )
  }
}
function metricPair(
  rows: readonly TimingSample[],
  pair: number,
  metric: PromotionComparison['metric'],
) {
  const baseline = rows.filter((sample) => sample.pair === pair && sample.engine === 'remark')
  const candidate = rows.filter((sample) => sample.pair === pair && sample.engine === 'tree-sitter')
  if (baseline.length !== 1 || candidate.length !== 1) return null
  const left = baseline[0][metric]
  const right = candidate[0][metric]
  return left === null || right === null ? null : { baseline: left, candidate: right }
}

async function reconcileNativeShards(
  raw: unknown,
  state: State,
): Promise<TimingReconciliationResult> {
  const index = parse(nativeShardIndex, raw, 'shards', state)
  if (!index) return { ...failedShardIndex(state), kind: 'native', timingStatus: 'EXPLORATORY' }
  const directory = path.dirname(state.input.report.path)
  const planFile = await readTimingFile(path.resolve(directory, index.plan.path), state.input.root)
  same(state, 'plan.sha256', planFile.sha256, index.plan.sha256)
  const plan = parse(nativeCapturePlan, observedJson(planFile.contents), 'plan', state)
  if (plan) checkNativeCapturePlan(plan, state)
  const assembly: NativeShardAssembly = {
    plan,
    planSha256: planFile.sha256,
    parts: [],
    declared: [],
    launches: new Set(),
    reports: new Set(),
    previousEnd: 0,
  }
  for (const [position, entry] of index.shards.entries())
    await reconcileNativeLaunch(entry, position, directory, assembly, state)
  const { parts, declared } = assembly
  const workloads = state.input.frozen.nativeWorkloads
  same(
    state,
    'native.shardCoverage',
    declared,
    nativeShardSelections(workloads).map((row) => `${row.workload}/${row.pair}`),
  )
  same(
    state,
    'native.rawCoverage',
    state.samples.map((row) => `${row.workload}/${row.pair}/${row.engine}`).toSorted(),
    nativeShardSelections(workloads)
      .flatMap((row) =>
        ['remark', 'tree-sitter'].map((engine) => `${row.workload}/${row.pair}/${engine}`),
      )
      .sort(),
  )
  const seed = plan?.metadata.seed ?? 176
  compareSamples(
    workloads.map((row) => row.id),
    seed,
    state,
  )
  state.metrics.quietHostEstablished =
    parts.length > 0 && parts.every((part) => part.metrics.quietHostEstablished === true)
      ? true
      : null
  state.metrics.shardCount = parts.length
  state.metrics.configuredWarmups = 3
  state.metrics.observedWarmupTrials = state.samples.filter(
    (row) => row.warmup && row.engine === 'remark',
  ).length
  const verdict = reconciliationVerdict(state)
  return {
    schemaVersion: 2,
    kind: 'native',
    verdict,
    timingStatus: timingStatus('native', verdict),
    findings: state.findings,
    metrics: state.metrics,
    comparisons: state.comparisons,
    samples: state.samples,
    exclusions: state.exclusions,
    resourceTrials: [],
    coverage: [],
    artifacts: [state.input.report, planFile]
      .map(({ path, sha256 }) => ({ path, sha256 }))
      .concat(parts.flatMap((part) => part.artifacts)),
    ...originalShardOutcomes(parts),
  }
}

type NativeShardAssembly = {
  readonly plan: v.InferOutput<typeof nativeCapturePlan> | null
  readonly planSha256: string
  readonly parts: TimingReconciliationResult[]
  readonly declared: string[]
  readonly launches: Set<string>
  readonly reports: Set<string>
  cohort?: unknown
  previousEnd: number
}
async function reconcileNativeLaunch(
  entry: v.InferOutput<typeof nativeShardIndex>['shards'][number],
  position: number,
  directory: string,
  assembly: NativeShardAssembly,
  state: State,
) {
  const file = await readTimingFile(path.resolve(directory, entry.report.path), state.input.root)
  same(state, `shards.${position}.sha256`, file.sha256, entry.report.sha256)
  if (assembly.reports.has(file.path) || assembly.reports.has(file.sha256))
    finding(
      state,
      `shards.${position}.report`,
      'mismatch',
      'Each original native report may appear once.',
    )
  assembly.reports.add(file.path)
  assembly.reports.add(file.sha256)
  const report = parse(
    nativeReport,
    observedJson(file.contents),
    `shards.${position}.report`,
    state,
  )
  const sidecars = await readTimingSidecars(
    entry.artifacts,
    path.dirname(file.path),
    state.input.root,
  )
  if (report) checkNativeLaunch(report, sidecars.quietHost, position, assembly, state)
  const part = await reconcileFiles({
    ...state.input,
    report: file,
    artifacts: sidecars,
    capturedFiles: await readCapturedSources(sidecars.sourceCapture, state.input.root),
    trialRoot: path.dirname(file.path),
    shard: true,
  })
  assembly.parts.push(part)
  mergeProductionShard(part, position, state)
}
function checkNativeLaunch(
  report: v.InferOutput<typeof nativeReport>,
  quiet: TimingArtifact | null,
  position: number,
  assembly: NativeShardAssembly,
  state: State,
) {
  checkNativeShardIdentity(
    report,
    position,
    assembly.plan,
    assembly.planSha256,
    assembly.launches,
    state,
  )
  if (report.shard) assembly.declared.push(`${report.shard.workload}/${report.shard.pair}`)
  const host = quiet
    ? parse(quietHostArtifact, observedJson(quiet.contents), `shards.${position}.quietHost`, state)
    : null
  const current = {
    ...nativeCohort(report),
    osRelease: host?.osRelease,
    memoryBytes: host?.memoryBytes,
    executablePath: host?.nativeInvocation?.executablePath,
  }
  assembly.cohort ??= current
  same(state, `shards.${position}.cohort`, current, assembly.cohort)
  const runtime = assembly.plan?.metadata.qualification.runtime
  same(
    state,
    `shards.${position}.runtime`,
    [report.metadata.platform, report.metadata.architecture, report.metadata.runtime],
    [runtime?.platform, runtime?.architecture, runtime ? `node v${runtime.node}` : undefined],
  )
  const span = launchInterval(report.metadata, `shards.${position}`, state)
  if (span.start < assembly.previousEnd)
    finding(
      state,
      `shards.${position}.interval`,
      'mismatch',
      'Native launch intervals must advance without overlap.',
    )
  assembly.previousEnd = span.end
}
function nativeCohort(report: v.InferOutput<typeof nativeReport>) {
  const { host, hardware, platform, architecture, runtime, launchPreparation } = report.metadata
  return {
    host,
    hardware,
    platform,
    architecture,
    runtime,
    policy: launchPreparation?.policy,
    realm: launchPreparation?.realm,
    sessions: launchPreparation?.sessions,
    gc: launchPreparation?.gc,
  }
}
function launchInterval(
  span: { startedAt: string; finishedAt: string },
  prefix: string,
  state: State,
) {
  const start = Date.parse(span.startedAt)
  const end = Date.parse(span.finishedAt)
  if (!(start < end) || end - start > 110 * 60 * 1000)
    finding(
      state,
      `${prefix}.deadline`,
      'mismatch',
      'Each original launch must finish inside the110-minute capture bound.',
    )
  return { start, end }
}
function checkNativeCapturePlan(plan: v.InferOutput<typeof nativeCapturePlan>, state: State) {
  checkFreeze(state)
  same(state, 'plan.purpose', plan.purpose, 'qualification')
  same(state, 'plan.shards', plan.shards, nativeShardSelections(state.input.frozen.nativeWorkloads))
  const identity = state.input.frozen.identity
  for (const key of [
    'candidateCommit',
    'lockfileSha256',
    'budgetSha256',
    'grammarSha256',
    'chatGrammarSha256',
    'resolverSha256',
    'workloadManifestSha256',
  ] as const)
    same(state, `plan.metadata.${key}`, plan.metadata[key], identity[key])
  same(
    state,
    'plan.metadata.candidateSourceSha256',
    plan.metadata.candidateSourceSha256,
    sha(JSON.stringify(plan.metadata.sourceFiles)),
  )
  const qualification = parse(
    sourceCaptureArtifact.entries.provenance,
    plan.metadata.qualification,
    'plan.metadata.qualification',
    state,
  )
  if (!qualification) return
  for (const [key, value] of Object.entries(state.input.frozen.provenance))
    same(state, `plan.metadata.qualification.${key}`, field(qualification, key), value)
  same(
    state,
    'plan.metadata.qualification.sources',
    sha(JSON.stringify(qualification.sources)),
    qualification.sourceClosureSha256,
  )
  for (const file of plan.metadata.sourceFiles)
    same(
      state,
      `plan.metadata.sourceFiles.${file.path}`,
      qualification.sources.find((row) => row.file === file.path)?.sha256,
      file.sha256,
    )
}
function checkNativeShardIdentity(
  report: v.InferOutput<typeof nativeReport>,
  position: number,
  plan: v.InferOutput<typeof nativeCapturePlan> | null,
  planSha256: string,
  launches: Set<string>,
  state: State,
) {
  const shard = report.shard
  if (!shard) {
    finding(
      state,
      `shards.${position}.shard`,
      'missing',
      'Each original launch requires its planned native selection.',
    )
    return
  }
  same(state, `shards.${position}.index`, shard.index, position)
  same(
    state,
    `shards.${position}.selection`,
    { workload: shard.workload, pair: shard.pair },
    plan?.shards[position],
  )
  same(state, `shards.${position}.planSha256`, shard.planSha256, planSha256)
  const metadata = parse(
    nativePlanMetadata,
    Object.fromEntries(
      Object.keys(nativePlanMetadata.entries).map((key) => [key, field(report.metadata, key)]),
    ),
    `shards.${position}.metadata`,
    state,
  )
  same(state, `shards.${position}.metadata`, metadata, plan?.metadata)
  if (launches.has(shard.launchId))
    finding(
      state,
      `shards.${position}.launchId`,
      'mismatch',
      'Native launches require unique actual launch identities.',
    )
  launches.add(shard.launchId)
}
function nativeShardComparisons(
  selection: v.InferOutput<typeof productionShard>,
  seed: number,
  state: State,
) {
  if (selection.pair < 0) return
  for (const metric of ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const) {
    const vector = metricPair(state.samples, selection.pair, metric)
    state.comparisons.push({
      ...pairedConfidence({
        workload: selection.workload,
        metric,
        seed,
        resamples: 4096,
        baseline: vector ? [vector.baseline] : [],
        candidate: vector ? [vector.candidate] : [],
      }),
      domain: 'native',
      build: 'source',
    })
  }
}
async function reconcileNativePreparation(
  report: v.InferOutput<typeof nativeReport>,
  state: State,
) {
  const { initialization, launchPreparation, seed } = report.metadata
  if (!initialization || !launchPreparation) {
    finding(
      state,
      'native.preparation',
      'missing',
      'Each native shard requires actual initialization and full-workload preparation records.',
    )
    return
  }
  const start = Date.parse(report.metadata.startedAt)
  const end = Date.parse(report.metadata.finishedAt)
  const initStart = Date.parse(initialization.startedAt)
  const initEnd = Date.parse(initialization.finishedAt)
  const prepStart = Date.parse(launchPreparation.startedAt)
  const prepEnd = Date.parse(launchPreparation.finishedAt)
  if (
    !(
      start <= initStart &&
      initStart <= initEnd &&
      initEnd <= prepStart &&
      prepStart < prepEnd &&
      prepEnd <= end
    )
  )
    finding(
      state,
      'native.preparation.interval',
      'mismatch',
      'Initialization and preparation must occur inside this original launch before its counted pair.',
    )
  same(state, 'native.preparation.orderSeed', launchPreparation.orderSeed, seed)
  const workload = state.input.frozen.nativeWorkloads.find(
    (row) => row.id === report.shard?.workload,
  )
  if (!workload) return
  const reference = launchPreparation.artifact
  const directory = path.dirname(state.input.report.path)
  const actual = await hashFile({
    root: state.input.root,
    file: path.resolve(directory, reference.path),
  })
  state.observedArtifacts.push({ ...actual, path: path.resolve(state.input.root, actual.path) })
  let mismatchedPairs = 0
  await foldJsonl({
    root: state.input.root,
    file: actual.path,
    expected: { ...reference, path: actual.path },
    parse: (value) =>
      v.parse(
        v.object({
          role: v.literal('launch-preparation'),
          preparation: count,
          workload: label,
          pair: nativePair,
        }),
        value,
      ),
    consume: (row, index) => {
      same(
        state,
        `native.preparation.${index}.identity`,
        [row.workload, row.preparation, row.pair.trial],
        [workload.id, index, index],
      )
      mismatchedPairs += Number(nativePairHasMismatches(row.pair))
      reconcileNativePair(row.pair, workload, seed, state, true)
    },
  })
  same(state, 'native.preparation.recordCount', reference.recordCount, 3)
  same(
    state,
    'native.preparation.mismatchedPairs',
    launchPreparation.mismatchedPairs,
    mismatchedPairs,
  )
  same(state, 'native.preparation.correctness', mismatchedPairs, 0)
}

async function reconcileNative(raw: unknown, state: State) {
  preserveFailures(raw, state)
  const report = parse(nativeReport, raw, 'report', state)
  if (!report) return
  checkFreeze(state)
  const metadata = report.metadata
  checkSourceCapture(metadata, state)
  const expected = state.input.frozen.identity
  for (const name of [
    'candidateCommit',
    'lockfileSha256',
    'budgetSha256',
    'grammarSha256',
    'chatGrammarSha256',
    'resolverSha256',
  ] as const)
    same(state, `native.metadata.${name}`, metadata[name], expected[name])
  same(
    state,
    'native.metadata.sourceFiles',
    sha(JSON.stringify(metadata.sourceFiles)),
    metadata.candidateSourceSha256,
  )
  same(state, 'native.metadata.trials', metadata.trials, 20)
  same(state, 'native.metadata.warmups', metadata.warmups, 3)
  same(state, 'native.metadata.revision', metadata.revision, expected.candidateCommit)
  const host = artifact(quietHostArtifact, 'quietHost', state)
  if (host) {
    checkNativeInvocation(host.nativeInvocation, metadata.runtime, state)
    same(state, 'native.host', host.host, metadata.host)
    same(state, 'native.host.reportSha256', host.reportSha256, state.input.report.sha256)
    const before = state.findings.length
    for (const name of ['hardware', 'platform', 'architecture'] as const)
      same(state, `native.host.${name}`, host[name], metadata[name])
    checkQuietHost(host, metadata.startedAt, metadata.finishedAt, state)
    if (
      state.findings.length !== before ||
      state.findings.some((entry) => entry.path.startsWith('native.host'))
    )
      state.metrics.quietHostEstablished = null
  }
  const frozenWorkloads = state.input.frozen.nativeWorkloads
  const selection = state.input.shard ? report.shard : undefined
  if (state.input.shard && !selection)
    finding(
      state,
      'native.shard',
      'missing',
      'An indexed native launch requires its original shard identity.',
    )
  const workloads = selection
    ? frozenWorkloads.filter((row) => row.id === selection.workload)
    : frozenWorkloads
  if (selection) {
    try {
      await reconcileNativePreparation(report, state)
    } catch (error) {
      finding(
        state,
        'native.preparation',
        'mismatch',
        error instanceof Error
          ? error.message
          : 'Preparation artifact could not be read completely.',
      )
    }
  }
  same(
    state,
    'native.workloadIds',
    report.workloads.map((row) => row.id),
    workloads.map((row) => row.id),
  )
  same(
    state,
    'native.workloadManifestSha256',
    metadata.workloadManifestSha256,
    sha(
      JSON.stringify(
        frozenWorkloads.map(({ source, revisions, ...entry }) => ({
          ...entry,
          sourceSha256: sha(source),
          revisionSourceSha256: revisions?.map(sha) ?? [],
        })),
      ),
    ),
  )
  const counts = new Map<string, { observed: number; mismatched: number }>()
  for (const row of report.workloads) {
    const workload = workloads.find((entry) => entry.id === row.id)
    if (!workload) continue
    same(
      state,
      `${row.id}.source`,
      [row.sourceSha256, row.sourceBytes, row.scheduleUnits, row.family],
      [sha(workload.source), workload.sourceBytes, workload.scheduleUnits, workload.family],
    )
  }
  const trialIds = selection
    ? [selection.pair]
    : [-1, -2, -3].concat(Array.from({ length: 20 }, (_, trial) => trial))
  const keys: string[] = []
  let observedWarmups = 0
  await foldTimingRecords(report.pairsArtifact, nativePairRecord, state, (record, index) => {
    const workload = workloads[Math.floor(index / trialIds.length)]
    same(
      state,
      `trials.record.${index}.identity`,
      [record.workload, record.pair.trial],
      [workload?.id, trialIds[index % trialIds.length]],
    )
    keys.push(`${record.workload}/${record.pair.trial}`)
    if (record.pair.trial < 0) observedWarmups++
    const selected = workloads.find((entry) => entry.id === record.workload)
    if (!selected) return
    const previous = counts.get(record.workload) ?? { observed: 0, mismatched: 0 }
    counts.set(record.workload, {
      observed: previous.observed + Number(record.pair.trial >= 0),
      mismatched: previous.mismatched + Number(nativePairHasMismatches(record.pair)),
    })
    reconcileNativePair(record.pair, selected, metadata.seed, state)
  })
  same(
    state,
    'native.pairKeys',
    keys.toSorted(),
    workloads.flatMap((workload) => trialIds.map((trial) => `${workload.id}/${trial}`)).sort(),
  )
  for (const row of report.workloads) {
    const observed = counts.get(row.id)
    same(state, `${row.id}.observedPairs`, row.observedPairs, observed?.observed ?? 0)
    same(state, `${row.id}.mismatchedPairs`, row.mismatchedPairs, observed?.mismatched ?? 0)
  }
  if (selection) nativeShardComparisons(selection, metadata.seed, state)
  else
    compareSamples(
      workloads.map((row) => row.id),
      metadata.seed,
      state,
    )
  reconcileReportedComparisons(
    { comparisons: report.workloads.flatMap((row) => row.comparisons) },
    state,
  )
  state.metrics.nativeCandidateSourceSha256 = metadata.candidateSourceSha256
  state.metrics.sourceClosureSha256 = state.input.frozen.provenance.sourceClosureSha256
  state.metrics.hostId = metadata.host
  state.metrics.runtimeVersion = metadata.runtime
  state.metrics.configuredWarmups = metadata.warmups
  state.metrics.observedWarmupTrials = observedWarmups
}
function nativePairHasMismatches(pair: v.InferOutput<typeof nativePair>) {
  if (pair.mismatchedRevisions.length > 0) return true
  if (pair.remark.revisions.length !== pair.candidate.revisions.length) return true
  return pair.remark.revisions.some((left, index) => {
    const right = pair.candidate.revisions[index]
    if (!right) return true
    return (
      left.revision !== right.revision ||
      left.offset !== right.offset ||
      left.phase !== right.phase ||
      left.outputDigest !== right.outputDigest ||
      left.sourceCoordinateFailures.length > 0 ||
      right.sourceCoordinateFailures.length > 0
    )
  })
}
function reconcileNativePair(
  pair: v.InferOutput<typeof nativePair>,
  workload: NativePairWorkload,
  seed: number,
  state: State,
  preparation = false,
) {
  same(
    state,
    `${workload.id}/${pair.trial}.order`,
    pair.order,
    pair.trial < 0
      ? pairedTrialOrders(3, seed)[-pair.trial - 1]
      : pairedTrialOrders(preparation ? 3 : 20, seed)[pair.trial],
  )
  const expectedRevisions = nativeExpectedRevisions(workload)
  same(
    state,
    `${workload.id}/${pair.trial}.remark.revisions`,
    pair.remark.revisions.map(nativeRevisionIdentity),
    expectedRevisions,
  )
  same(
    state,
    `${workload.id}/${pair.trial}.candidate.revisions`,
    pair.candidate.revisions.map(nativeRevisionIdentity),
    expectedRevisions,
  )
  same(state, `${workload.id}/${pair.trial}.mismatchedRevisions`, pair.mismatchedRevisions, [])
  same(
    state,
    `${workload.id}/${pair.trial}.outputs`,
    pair.remark.revisions.map((tick) => tick.outputDigest),
    pair.candidate.revisions.map((tick) => tick.outputDigest),
  )
  if (preparation) {
    checkNativeTrial(workload.id, pair.trial, pair.remark, 'remark', state)
    checkNativeTrial(workload.id, pair.trial, pair.candidate, 'tree-sitter', state)
    return
  }
  nativeSample(workload.id, pair.trial, pair.remark, 'remark', state)
  nativeSample(workload.id, pair.trial, pair.candidate, 'tree-sitter', state)
}
function checkNativeTrial(
  workload: string,
  pair: number,
  trial: v.InferOutput<typeof nativeTrial>,
  expectedEngine: 'remark' | 'tree-sitter',
  state: State,
) {
  same(
    state,
    `${workload}/${pair}.${expectedEngine}.identity`,
    [trial.engine, trial.trial],
    [expectedEngine, pair],
  )
  if (trial.revisions.some((tick) => tick.sourceCoordinateFailures.length > 0))
    finding(
      state,
      `${workload}/${pair}/${expectedEngine}.sourceCoordinates`,
      'failure',
      'Native revision contains raw source-coordinate failures.',
    )
}
function nativeSample(
  workload: string,
  pair: number,
  trial: v.InferOutput<typeof nativeTrial>,
  expectedEngine: 'remark' | 'tree-sitter',
  state: State,
) {
  checkNativeTrial(workload, pair, trial, expectedEngine, state)
  state.samples.push({
    workload,
    pair,
    engine: trial.engine,
    warmup: pair < 0,
    processedInputs: trial.revisions.length,
    paintedUpdates: null,
    unpaintedUpdates: null,
    transferredBytes: null,
    updateP95: p95(
      trial.revisions.filter((tick) => tick.phase === 'update').map((tick) => tick.wallMs),
    ),
    settlementP95: p95(
      trial.revisions.filter((tick) => tick.phase === 'settlement').map((tick) => tick.wallMs),
    ),
    mountP95: trial.mountMs,
    streamCpu: trial.streamCpuMs,
  })
}

function nativeManifestHash(workloads: readonly NativePairWorkload[]) {
  return sha(
    JSON.stringify(
      workloads.map(({ source, revisions, ...entry }) => ({
        ...entry,
        sourceSha256: sha(source),
        revisionSourceSha256: revisions?.map(sha) ?? [],
      })),
    ),
  )
}
function nativeRevisionIdentity(
  tick: Pick<v.InferOutput<typeof nativeRevision>, 'revision' | 'offset' | 'phase'>,
) {
  return { revision: tick.revision, offset: tick.offset, phase: tick.phase }
}
function nativeExpectedRevisions(workload: NativePairWorkload) {
  const updates =
    workload.revisions ??
    (workload.scheduleUnits > 0
      ? Array.from(fixedChunks(workload.source, workload.scheduleUnits), (frame) => frame.text)
      : [workload.source])
  return updates
    .map((source, revision) => ({ revision, offset: source.length, phase: 'update' }))
    .concat([{ revision: updates.length, offset: workload.source.length, phase: 'settlement' }])
}

function reconcileReportedComparisons(
  report: { readonly comparisons: readonly unknown[] },
  state: State,
) {
  same(state, 'report.comparisons.count', report.comparisons.length, state.comparisons.length)
  for (const observed of state.comparisons) {
    const rows = report.comparisons.filter(
      (entry) =>
        field(entry, 'workload') === observed.workload &&
        field(entry, 'metric') === observed.metric,
    )
    same(state, `${observed.workload}.${observed.metric}.reportedCount`, rows.length, 1)
    const reported = rows[0]
    for (const name of [
      'independentTrials',
      'baselineMs',
      'candidateMs',
      'ratio',
      'allowanceMs',
      'lowerMarginMs',
      'upperMarginMs',
      'resamples',
      'confidence',
    ] as const)
      same(
        state,
        `${observed.workload}.${observed.metric}.reported.${name}`,
        field(reported, name),
        observed[name],
      )
    if (state.input.kind === 'production') reconcileReportedExclusions(reported, observed, state)
  }
}
function reconcileReportedExclusions(
  reported: unknown,
  observed: PromotionComparison,
  state: State,
) {
  const exclusions = field(reported, 'excludedPairs')
  if (!Array.isArray(exclusions)) {
    finding(
      state,
      `${observed.workload}.${observed.metric}.excludedPairs`,
      'missing',
      'Actual producer inclusion/exclusion records are required.',
    )
    return
  }
  const incomplete = state.samples.filter(
    (sample) =>
      sample.workload === observed.workload && !sample.warmup && sample[observed.metric] === null,
  )
  const expected = incomplete.map((sample) => ({ pair: sample.pair, engine: sample.engine }))
  const actual = exclusions.map((entry) => ({
    pair: field(entry, 'pair'),
    engine: field(entry, 'engine'),
  }))
  same(state, `${observed.workload}.${observed.metric}.excludedPairs`, actual, expected)
}

function invocationOption(argv: readonly string[], name: string) {
  return argv.flatMap((value, index) => {
    if (value === name) return [argv[index + 1]]
    if (value.startsWith(`${name}=`)) return [value.slice(name.length + 1)]
    return []
  })
}

function checkNativeInvocation(
  invocation: v.InferOutput<typeof nativeInvocation> | undefined,
  runtime: string,
  state: State,
) {
  if (!invocation) {
    finding(
      state,
      'quietHost.nativeInvocation',
      'missing',
      'Capture the actual native process executable, argv, runtime, output report path and instrumentation environment.',
    )
    return
  }
  same(state, 'native.invocation.runtime', invocation.runtime, runtime)
  same(
    state,
    'native.invocation.reportPath',
    invocation.reportPath,
    path.relative(state.input.root, state.input.report.path).split(path.sep).join('/'),
  )
  same(state, 'native.invocation.executable', invocation.argv[0], invocation.executablePath)
  if (state.input.shard) {
    const plans = invocationOption(invocation.argv, '--capture-plan')
    if (plans.length !== 1 || !plans[0] || plans[0].startsWith('--'))
      finding(
        state,
        'native.invocation.capturePlan',
        'mismatch',
        'An original native shard invocation must name exactly one capture plan.',
      )
    const raw = observedJson(state.input.report.contents)
    const selected = parse(productionShard, field(raw, 'shard'), 'native.invocation.shard', state)
    if (selected) {
      same(
        state,
        'native.invocation.selectionIndex',
        invocationOption(invocation.argv, '--selection-index'),
        [String(selected.index)],
      )
      same(state, 'native.invocation.launchId', invocationOption(invocation.argv, '--launch-id'), [
        selected.launchId,
      ])
    }
  }
  const profiling = /--(?:cpu-prof|heap-prof|prof|inspect|debug|coverage|preload|require|import)/u
  if (
    invocation.argv.some((arg) => profiling.test(arg)) ||
    invocation.environment.NODE_OPTIONS ||
    invocation.environment.BUN_OPTIONS
  )
    finding(
      state,
      'native.invocation.instrumentation',
      'mismatch',
      'Native process arguments or runtime environment permit instrumentation.',
    )
  if (!invocation.argv.some((arg) => /(?:^|\/)paired-native\.ts$/u.test(arg)))
    finding(
      state,
      'native.invocation.producer',
      'mismatch',
      'The captured process is not the frozen native timing producer.',
    )
}

export const sourceCaptureArtifact = v.object({
  reportSha256: digest,
  sourceRoot: label,
  provenance: v.object({
    ...sourceIdentity.entries,
    sources: v.pipe(v.array(v.object({ file: label, sha256: digest })), v.minLength(1)),
  }),
  files: v.object({
    lockfile: label,
    grammar: label,
    chatGrammar: label,
    resolver: label,
    budget: label,
  }),
})
function sourceCapturePaths(
  capture: v.InferOutput<typeof sourceCaptureArtifact>,
  filename: string,
  identity: TimingFreeze['identity'],
) {
  const directory = path.dirname(path.resolve(filename))
  return capture.provenance.sources
    .map((entry) => ({
      path: path.resolve(directory, capture.sourceRoot, entry.file),
      sha256: entry.sha256,
    }))
    .concat(
      [
        { file: capture.files.lockfile, sha256: identity.lockfileSha256 },
        { file: capture.files.grammar, sha256: identity.grammarSha256 },
        { file: capture.files.chatGrammar, sha256: identity.chatGrammarSha256 },
        { file: capture.files.resolver, sha256: identity.resolverSha256 },
        { file: capture.files.budget, sha256: identity.budgetSha256 },
      ].map((entry) => ({ path: path.resolve(directory, entry.file), sha256: entry.sha256 })),
    )
}
function checkSourceCapture(
  metadata: Pick<v.InferOutput<typeof nativeReport>['metadata'], 'sourceFiles'>,
  state: State,
  native = true,
) {
  const capture = artifact(sourceCaptureArtifact, 'sourceCapture', state)
  if (!capture) return
  same(state, 'sourceCapture.reportSha256', capture.reportSha256, state.input.report.sha256)
  for (const name of [
    'revision',
    'trackedDiffSha256',
    'sourceClosureSha256',
    'lockfileSha256',
  ] as const)
    same(
      state,
      `sourceCapture.provenance.${name}`,
      capture.provenance[name],
      state.input.frozen.provenance[name],
    )
  same(
    state,
    'sourceCapture.candidateSourceSha256',
    capture.provenance.sourceClosureSha256,
    state.input.frozen.identity.candidateSourceSha256,
  )
  const sources = capture.provenance.sources
  same(
    state,
    'sourceCapture.sourceClosureSha256',
    sha(JSON.stringify(sources)),
    state.input.frozen.provenance.sourceClosureSha256,
  )
  const names = sources.map((entry) => entry.file)
  if (
    new Set(names).size !== names.length ||
    names.some(
      (file) =>
        path.isAbsolute(file) || file.split(/[\\/]/u).some((part) => part === '..' || part === '.'),
    )
  )
    finding(
      state,
      'sourceCapture.sources',
      'mismatch',
      'Full source manifest must have unique relative source identities.',
    )
  same(state, 'sourceCapture.sources.order', names, names.toSorted())
  if (native && metadata.sourceFiles.length === 0)
    finding(
      state,
      'sourceCapture.native.sourceFiles',
      'missing',
      'Native producer source file observations are missing.',
    )
  if (new Set(metadata.sourceFiles.map((entry) => entry.path)).size !== metadata.sourceFiles.length)
    finding(
      state,
      'sourceCapture.native.sourceFiles',
      'mismatch',
      'Native source identities are duplicated.',
    )
  for (const entry of metadata.sourceFiles)
    same(
      state,
      `sourceCapture.native.${entry.path}`,
      sources.find((source) => source.file === entry.path)?.sha256,
      entry.sha256,
    )
  const observed = state.input.capturedFiles ?? []
  const paths = observed.map((file) => path.resolve(state.input.root, file.path))
  if (new Set(paths).size !== paths.length)
    finding(
      state,
      'sourceCapture.files',
      'mismatch',
      'Actual captured byte identities are duplicated.',
    )
  const sidecar = state.input.artifacts.sourceCapture
  if (!sidecar) return
  for (const entry of sourceCapturePaths(capture, sidecar.path, state.input.frozen.identity)) {
    const actual = observed.find((file) => path.resolve(state.input.root, file.path) === entry.path)
    if (!actual)
      finding(
        state,
        `sourceCapture.bytes.${entry.path}`,
        'missing',
        'Actual captured source, lockfile, WASM or budget bytes are missing.',
      )
    else same(state, `sourceCapture.bytes.${entry.path}`, actual.sha256, entry.sha256)
  }
}
async function readCapturedSources(
  sidecar: TimingArtifact | null,
  root: string,
): Promise<ArtifactRef[]> {
  if (!sidecar) return []
  const parsed = v.safeParse(sourceCaptureArtifact, observedJson(sidecar.contents))
  if (!parsed.success) return []
  const capture = parsed.output
  const directory = path.dirname(sidecar.path)
  const paths = capture.provenance.sources
    .map((entry) => path.resolve(directory, capture.sourceRoot, entry.file))
    .concat(Object.values(capture.files).map((file) => path.resolve(directory, file)))
  const captured: ArtifactRef[] = []
  for (const file of new Set(paths)) {
    try {
      captured.push(await hashFile({ root, file }))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return captured
}

const reconciliationManifest = v.variant('schemaVersion', [
  timingLaunchManifest,
  v.strictObject({
    schemaVersion: v.literal(2),
    kind: v.picklist(['production', 'native']),
    report: label,
    frozen: label,
  }),
])
const frozenTimingIdentity = v.object({
  identity: v.object({
    candidateCommit: v.pipe(label, v.regex(/^[a-f0-9]{40}$/u)),
    candidateSourceSha256: digest,
    grammarSha256: digest,
    chatGrammarSha256: digest,
    resolverSha256: digest,
    lockfileSha256: digest,
    budgetSha256: digest,
    evaluationManifestSha256: digest,
    workloadManifestSha256: digest,
  }),
  provenance: sourceIdentity,
  fontFingerprint: digest,
})

export async function reconcileTimingManifest(options: {
  readonly manifestPath: string
  readonly outputPath: string
  readonly evidenceRoot?: string
}): Promise<TimingReconciliationResult> {
  const root = await realpath(
    options.evidenceRoot ?? path.dirname(path.resolve(options.manifestPath)),
  )
  const manifestArtifact = await readTimingFile(path.resolve(options.manifestPath), root)
  const manifest = v.parse(reconciliationManifest, JSON.parse(manifestArtifact.contents))
  const directory = path.dirname(manifestArtifact.path)
  const frozenArtifact = await readTimingFile(path.resolve(directory, manifest.frozen), root)
  const frozen = v.parse(frozenTimingIdentity, JSON.parse(frozenArtifact.contents))
  const artifacts =
    manifest.schemaVersion === 1
      ? await readTimingSidecars(manifest.artifacts, directory, root)
      : emptyTimingSidecars()
  const input: TimingReconciliationInput = {
    root,
    capturedFiles: await readCapturedSources(artifacts.sourceCapture, root),
    kind: manifest.kind,
    report: await readTimingFile(path.resolve(directory, manifest.report), root),
    frozen: {
      ...frozen,
      productionWorkloads: productionBrowserWorkloads(),
      nativeWorkloads: nativePairWorkloads('qualification'),
    },
    artifacts,
  }
  if (
    manifest.schemaVersion === 2 &&
    field(observedJson(input.report.contents), 'kind') !== `${manifest.kind}-shards`
  )
    throw createScriptError('A shard reconciliation manifest requires its original shard index.')
  const computed = await reconcileFiles(input)
  const result = {
    ...computed,
    artifacts: computed.artifacts.concat(
      [manifestArtifact, frozenArtifact].map(({ path, sha256 }) => ({ path, sha256 })),
    ),
  }
  await mkdir(path.dirname(path.resolve(options.outputPath)), { recursive: true })
  await writeFile(options.outputPath, JSON.stringify(result, null, 2) + '\n')
  return result
}
async function readTimingFile(filename: string, root: string): Promise<TimingArtifact> {
  const observed = await hashFile({ root, file: filename })
  const contents = await readFile(path.resolve(root, observed.path), 'utf8')
  if (sha(contents) !== observed.sha256)
    throw createScriptError('Timing metadata changed while reading.')
  return { path: path.resolve(root, observed.path), contents, sha256: observed.sha256 }
}
async function readOptionalTimingFile(filename: string | null, directory: string, root: string) {
  if (filename === null) return null
  try {
    return await readTimingFile(path.resolve(directory, filename), root)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
async function readTimingSidecars(
  files: v.InferOutput<typeof timingSidecarFiles>,
  directory: string,
  root: string,
): Promise<TimingReconciliationInput['artifacts']> {
  const [host, quietHost, build, buildManifest, browser, fonts, sourceCapture] = await Promise.all(
    [
      files.host,
      files.quietHost,
      files.build,
      files.buildManifest,
      files.browser,
      files.fonts,
      files.sourceCapture,
    ].map((file) => readOptionalTimingFile(file, directory, root)),
  )
  return {
    host,
    quietHost,
    build,
    buildManifest,
    browser,
    fonts,
    sourceCapture,
    trials: files.trials,
  }
}
async function verifyCapturedFiles(
  input: TimingReconciliationInput,
  observed: ArtifactRef[],
): Promise<TimingFinding[]> {
  if (input.kind === 'native') return []
  const build = input.artifacts.build
  const fonts = input.artifacts.fonts
  const findings = build ? await verifyBuildFiles(build, input.root, observed) : []
  return findings.concat(fonts ? await verifyFontFiles(fonts, input.root, observed) : [])
}
async function verifyBuildFiles(
  artifact: TimingArtifact,
  root: string,
  observed: ArtifactRef[],
): Promise<TimingFinding[]> {
  const parsed = v.safeParse(buildArtifact, observedJson(artifact.contents))
  if (!parsed.success) return []
  let findings: TimingFinding[] = []
  for (const file of parsed.output.artifacts) {
    if (path.basename(file.file) !== file.file) {
      findings.push({
        path: `build.artifacts.${file.file}`,
        kind: 'mismatch',
        reason: 'Build artifact file names must match the producer flat assets directory.',
      })
      continue
    }
    const filename = path.resolve(path.dirname(artifact.path), 'assets', file.file)
    findings = findings.concat(
      await verifyCapturedFile(filename, file.sha256, file.bytes, root, observed),
    )
  }
  return findings
}
async function verifyFontFiles(
  artifact: TimingArtifact,
  root: string,
  observed: ArtifactRef[],
): Promise<TimingFinding[]> {
  const parsed = v.safeParse(fontsArtifact, observedJson(artifact.contents))
  if (!parsed.success) return []
  let findings: TimingFinding[] = []
  for (const file of parsed.output.files)
    findings = findings.concat(
      await verifyCapturedFile(
        path.resolve(path.dirname(artifact.path), file.path),
        file.sha256,
        null,
        root,
        observed,
      ),
    )
  return findings
}
async function verifyCapturedFile(
  filename: string,
  expectedSha256: string,
  expectedBytes: number | null,
  root: string,
  observed: ArtifactRef[],
): Promise<TimingFinding[]> {
  try {
    const actual = await hashFile({ root, file: filename })
    observed.push(actual)
    if (
      actual.sha256 === expectedSha256 &&
      (expectedBytes === null || actual.byteLength === expectedBytes)
    )
      return []
    return [
      {
        path: filename,
        kind: 'mismatch',
        reason: 'Actual captured file bytes differ from the reported SHA-256 or size.',
      },
    ]
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return [
        { path: filename, kind: 'missing', reason: 'Referenced actual capture file is missing.' },
      ]
    throw error
  }
}
if (import.meta.main) {
  const { values } = parseArgs({
    options: { manifest: { type: 'string' }, out: { type: 'string' }, root: { type: 'string' } },
  })
  if (!values.manifest || !values.out)
    throw new Error('Use --manifest FILE --out timing-reconciliation.json')
  const result = await reconcileTimingManifest({
    manifestPath: values.manifest,
    outputPath: values.out,
    evidenceRoot: values.root,
  })
  process.stdout.write(
    JSON.stringify({
      output: path.resolve(values.out),
      verdict: result.verdict,
      timingStatus: result.timingStatus,
    }) + '\n',
  )
  process.exitCode = result.verdict === 'VERIFIED' ? 0 : 1
}

function inputState(input: TimingReconciliationInput): State {
  return {
    input,
    findings: [],
    samples: [],
    comparisons: [],
    exclusions: [],
    resourceTrials: [],
    coverage: [],
    observedArtifacts: [],
    metrics: { quietHostEstablished: null },
  }
}

function observedJson(contents: string): unknown {
  try {
    return JSON.parse(contents)
  } catch {
    return null
  }
}
