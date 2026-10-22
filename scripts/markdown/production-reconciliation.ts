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
import { foldJsonl, hashFile, type ArtifactRef } from './timing-artifacts'
import {
  productionOracleSchema,
  productionOracleIdentitySchema,
  reconcileProductionOracles,
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
}
export type ResourceTimingObservation = {
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
const productionTrial = v.object({
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
const productionReport = v.object({
  schemaVersion: v.literal(2),
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
const nativeReport = v.object({
  schemaVersion: v.literal(2),
  pairsArtifact: rawTimingRef,
  scope: v.literal('paired-native-source'),
  mode: v.literal('qualification'),
  metadata: v.object({
    startedAt: label,
    finishedAt: label,
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
const fontsArtifact = v.object({
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
const buildArtifact = v.object({
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
  readonly artifacts: v.InferOutput<typeof reconciliationManifest>['artifacts']
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
function finding(state: State, path: string, kind: TimingFinding['kind'], reason: string) {
  state.findings.push({ path, kind, reason })
}
function same(state: State, path: string, actual: unknown, expected: unknown) {
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
const wasmBuildRoles = [
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
  const workloads = state.input.frozen.productionWorkloads
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
    workloads: workloads.map(manifestEntry),
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
  let inputs: readonly string[] = []
  let measured = 0
  await foldTimingRecords(report.trialsArtifact, productionTrial, state, async (row, index) => {
    const expectedWorkload = workloads[Math.floor(index / 46)]
    const pairIndex = Math.floor((index % 46) / 2)
    const pair = pairIndex - 3
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
      inputs = productionUpdates(workload).concat([workload.source])
    }
    reconcileProductionRow(row, workload, inputs, fonts, state)
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
      await reconcileOraclePair(pending, row, inputs, state)
      pending = null
      return
    }
    pending = row
  })
  checkProductionKeys(keys, workloads, state)
  same(state, 'report.sampleSummaries.length', report.sampleSummaries.length, measured)
  same(
    state,
    'report.familyCoverage',
    report.familyCoverage,
    observedFamilyCoverage(workloads, state.coverage),
  )
  for (const workload of workloads) productionWorkloadMetrics(workload.id, state)
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
  inputs: readonly string[],
  state: State,
) {
  try {
    const artifacts = await reconcileProductionOracles({
      root: state.input.root,
      first,
      second,
      inputs,
    })
    state.observedArtifacts.push(...artifacts)
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
    const actual = await hashFile({ root: state.input.root, file: filename })
    state.observedArtifacts.push(actual)
    same(state, 'trials.path', actual.path, reference.path)
    if (actual.path !== reference.path) return
    await foldJsonl({
      root: state.input.root,
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
function reconcileProductionRow(
  row: ProductionRow,
  workload: ProductionWorkload,
  inputs: readonly string[],
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
) {
  const expected = workloads.flatMap((workload) =>
    Array.from({ length: 23 }, (_, index) => index - 3).flatMap((pair) =>
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
function validateProductionReceipt(row: ProductionRow, inputs: readonly string[], state: State) {
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
  same(
    state,
    `${key}.skippedPaintRevisions`,
    receipt.skippedPaintRevisions,
    receipt.processed
      .filter((tick) => !required.includes(tick.revision))
      .map((tick) => tick.revision),
  )
  for (const tick of receipt.frames) checkPaint(row, tick, state)
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
  input: string | undefined,
  index: number,
  state: State,
) {
  const key = `${productionKey(row)}.processed.${index}`
  same(
    state,
    `${key}.input`,
    [tick.inputSha256, tick.inputUtf16Units, tick.live],
    input === undefined
      ? null
      : [sha(input), input.length, index + 1 < row.receipt.processed.length],
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
  state: State,
) {
  const index = row.receipt.processed.findIndex((entry) => entry.revision === tick.revision)
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

async function reconcileNative(raw: unknown, state: State) {
  preserveFailures(raw, state)
  const report = parse(nativeReport, raw, 'report', state)
  if (!report) return
  checkFreeze(state)
  const metadata = report.metadata
  checkNativeSourceCapture(metadata, state)
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
  const workloads = state.input.frozen.nativeWorkloads
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
        workloads.map(({ source, revisions, ...entry }) => ({
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
  const trialIds = [-1, -2, -3].concat(Array.from({ length: 20 }, (_, trial) => trial))
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
) {
  same(
    state,
    `${workload.id}/${pair.trial}.order`,
    pair.order,
    pair.trial < 0
      ? pairedTrialOrders(3, seed)[-pair.trial - 1]
      : pairedTrialOrders(20, seed)[pair.trial],
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
  nativeSample(workload.id, pair.trial, pair.remark, 'remark', state)
  nativeSample(workload.id, pair.trial, pair.candidate, 'tree-sitter', state)
}
function nativeSample(
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
  same(state, 'native.invocation.reportPath', invocation.reportPath, state.input.report.path)
  same(state, 'native.invocation.executable', invocation.argv[0], invocation.executablePath)
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

const sourceCaptureArtifact = v.object({
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
function checkNativeSourceCapture(
  metadata: v.InferOutput<typeof nativeReport>['metadata'],
  state: State,
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
  if (metadata.sourceFiles.length === 0)
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

const reconciliationManifest = v.object({
  schemaVersion: v.literal(1),
  kind: v.picklist(['production', 'native']),
  report: label,
  frozen: label,
  artifacts: v.object({
    host: v.nullable(label),
    quietHost: v.nullable(label),
    build: v.nullable(label),
    buildManifest: v.nullable(label),
    browser: v.nullable(label),
    fonts: v.nullable(label),
    trials: label,
    sourceCapture: v.nullable(label),
  }),
})
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
  const artifacts = await readTimingSidecars(manifest.artifacts, directory, root)
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
  files: v.InferOutput<typeof reconciliationManifest>['artifacts'],
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
    options: { manifest: { type: 'string' }, out: { type: 'string' } },
  })
  if (!values.manifest || !values.out)
    throw new Error('Use --manifest FILE --out timing-reconciliation.json')
  const result = await reconcileTimingManifest({
    manifestPath: values.manifest,
    outputPath: values.out,
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
