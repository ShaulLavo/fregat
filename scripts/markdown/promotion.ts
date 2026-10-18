import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import * as v from 'valibot'
import { createScriptError } from '../structured-errors'
import { BENCHMARK_FAMILIES, BENCHMARK_PROFILES } from './workloads'
import frozenBudget from './promotion-budget.json'

export const PROMOTION_GATES = [
  'candidate-capabilities',
  'native-development-semantics',
  'browser-development-semantics',
  'native-heldout-semantics',
  'browser-heldout-semantics',
  'streaming-correctness',
  'interactions',
  'safety',
  'visual-states',
  'frame-probes',
  'resources',
  'benchmark-coverage',
  'native-paired',
  'production-timing',
] as const
const hashSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u))
const finite = v.pipe(v.number(), v.finite())
const nonnegative = v.pipe(finite, v.minValue(0))
const count = v.pipe(nonnegative, v.integer())
const label = v.pipe(v.string(), v.minLength(1))
const metric = v.picklist(['updateP95', 'settlementP95', 'mountP95', 'streamCpu'])
const identitySchema = v.strictObject({
  candidateCommit: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u)),
  grammarSha256: hashSchema,
  resolverSha256: hashSchema,
  candidateSourceSha256: hashSchema,
  lockfileSha256: hashSchema,
  budgetSha256: hashSchema,
  evaluationManifestSha256: hashSchema,
  workloadManifestSha256: hashSchema,
})
const comparisonSchema = v.strictObject({
  workload: label,
  domain: v.picklist(['native', 'browser']),
  build: v.picklist(['source', 'production']),
  metric,
  independentTrials: count,
  baselineMs: nonnegative,
  candidateMs: nonnegative,
  ratio: nonnegative,
  allowanceMs: nonnegative,
  confidence: v.literal(0.95),
  resamples: count,
  lowerMarginMs: finite,
  upperMarginMs: finite,
  status: v.picklist(['passed', 'failed', 'inconclusive']),
})
const receiptSchema = v.strictObject({
  gate: v.picklist(PROMOTION_GATES),
  status: v.picklist(['complete', 'failed', 'inconclusive']),
  identity: identitySchema,
  artifacts: v.pipe(v.array(v.strictObject({ path: label, sha256: hashSchema })), v.minLength(1)),
  counts: v.strictObject({ executed: count, failed: count, skipped: count }),
  metrics: v.record(label, v.union([finite, v.boolean(), label])),
  comparisons: v.optional(v.array(comparisonSchema)),
})
const productionWorkloadsSchema = v.pipe(
  v.array(
    v.strictObject({
      id: label,
      sourceBytes: count,
      scheduleUnits: count,
      metrics: v.pipe(v.array(metric), v.minLength(1)),
      arrival: v.picklist(['paced', 'burst-coalesced']),
      scheduleId: label,
      sourceSha256: hashSchema,
      expectedInputUpdates: count,
      paintPolicy: v.picklist(['every-revision', 'sampled']),
    }),
  ),
  v.minLength(1),
)
const evidenceSchema = v.strictObject({
  schemaVersion: v.literal(1),
  identity: identitySchema,
  nativeWorkloads: v.pipe(
    v.array(
      v.strictObject({
        id: label,
        sourceBytes: count,
        scheduleUnits: count,
        metrics: v.pipe(v.array(metric), v.minLength(1)),
      }),
    ),
    v.minLength(1),
  ),
  expectedWorkloads: productionWorkloadsSchema,
  receipts: v.array(receiptSchema),
})
export type PromotionEvidence = v.InferOutput<typeof evidenceSchema>
export type PromotionReceipt = PromotionEvidence['receipts'][number]
export type PromotionComparison = v.InferOutput<typeof comparisonSchema>
export type TrustedPromotionContext = {
  readonly identity: PromotionEvidence['identity']
  readonly expectedWorkloads: PromotionEvidence['expectedWorkloads']
  readonly nativeWorkloads: PromotionEvidence['nativeWorkloads']
  readonly minimumCoverage: Readonly<Record<PromotionReceipt['gate'], number>>
  readonly benchmarkCells: Readonly<Record<(typeof BENCHMARK_FAMILIES)[number], number>>
  readonly scenarioIds: Readonly<Partial<Record<PromotionReceipt['gate'], readonly string[]>>>
  readonly selectedBatch: {
    readonly id: string
    readonly assetSha256: string
    readonly messages: number
  }
  readonly heldoutCounts: {
    readonly nativeCases: {
      readonly total: number
      readonly passed: number
      readonly failed: number
    }
    readonly browserCases: {
      readonly total: number
      readonly passed: number
      readonly failed: number
    }
    readonly streamCases: {
      readonly total: number
      readonly passed: number
      readonly failed: number
    }
  }
  readonly evaluationArtifact: { readonly path: string; readonly sha256: string }
}
export type TrustedPromotionOptions = {
  readonly root: string
  readonly evaluationReceipt: string
  readonly evaluationLedger: string
  readonly evidenceDirectory: string
}

export type PromotionResult = {
  readonly verdict: 'VERIFIED' | 'NOT VERIFIED'
  readonly gates: readonly {
    readonly gate: (typeof PROMOTION_GATES)[number]
    readonly status: 'passed' | 'blocked'
    readonly findings: readonly string[]
  }[]
  readonly findings: readonly string[]
}

export async function frozenBudgetSha256(): Promise<string> {
  const bytes = await readFile(new URL('./promotion-budget.json', import.meta.url))
  return createHash('sha256').update(bytes).digest('hex')
}

export function evaluatePromotion(
  input: unknown,
  expectedBudgetSha256: string,
  verifiedArtifacts: ReadonlyMap<string, string> = new Map(),
  context?: TrustedPromotionContext,
): PromotionResult {
  const parsed = v.safeParse(evidenceSchema, input)
  if (!parsed.success)
    return {
      verdict: 'NOT VERIFIED',
      gates: [],
      findings: parsed.issues.map(
        (issue) => `Evidence field ${v.getDotPath(issue) ?? 'root'} is missing or invalid.`,
      ),
    }
  const evidence = parsed.output
  const findings = manifestFindings(evidence, expectedBudgetSha256)
  if (!context)
    findings.push('Authoritative current-candidate and unretired evaluation context is missing.')
  if (context) findings.push(...trustedContextFindings(evidence, context))
  const gates = PROMOTION_GATES.map((gate) =>
    evaluateGate(gate, evidence, verifiedArtifacts, context),
  )
  return {
    verdict:
      findings.length === 0 && gates.every((gate) => gate.status === 'passed')
        ? 'VERIFIED'
        : 'NOT VERIFIED',
    gates,
    findings,
  }
}

function manifestFindings(evidence: PromotionEvidence, expectedBudgetSha256: string) {
  const findings: string[] = []
  if (evidence.identity.budgetSha256 !== expectedBudgetSha256)
    findings.push('Evidence uses a different frozen promotion budget.')
  const ids = evidence.expectedWorkloads.map((workload) => workload.id)
  if (new Set(ids).size !== ids.length)
    findings.push('Expected timing workload ids contain duplicates.')
  if (!evidence.expectedWorkloads.some(ordinaryWorkload))
    findings.push('The workload manifest contains no ordinary 24-unit streaming workload.')
  const requiredMetrics = new Set(
    evidence.expectedWorkloads.flatMap((workload) => workload.metrics),
  )
  for (const field of ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const) {
    if (!requiredMetrics.has(field)) findings.push(`The workload manifest omits ${field}.`)
  }
  for (const workload of evidence.expectedWorkloads) {
    if (new Set(workload.metrics).size !== workload.metrics.length)
      findings.push(`${workload.id}: repeated required timing field.`)
  }
  return findings
}

function evaluateGate(
  gate: (typeof PROMOTION_GATES)[number],
  evidence: PromotionEvidence,
  verifiedArtifacts: ReadonlyMap<string, string>,
  context?: TrustedPromotionContext,
): PromotionResult['gates'][number] {
  const receipts = evidence.receipts.filter((receipt) => receipt.gate === gate)
  if (receipts.length !== 1)
    return {
      gate,
      status: 'blocked',
      findings: [`${gate}: expected one actual complete receipt, received ${receipts.length}.`],
    }
  const receipt = receipts[0]
  const findings = receiptFindings(receipt, evidence.identity)
  const requiredCoverage = context?.minimumCoverage[gate] ?? minimumCoverage(gate)
  if (receipt.counts.executed < requiredCoverage)
    findings.push(`${gate}: fewer than ${requiredCoverage} required cases were executed.`)
  for (const artifact of receipt.artifacts) {
    if (verifiedArtifacts.get(artifact.path) !== artifact.sha256)
      findings.push(`${gate}: missing or changed evidence artifact ${artifact.path}.`)
  }
  findings.push(...measurementFindings(receipt, evidence, context))
  if (context) findings.push(...requiredScenarioFindings(receipt, context))
  return { gate, status: findings.length === 0 ? 'passed' : 'blocked', findings }
}

function receiptFindings(receipt: PromotionReceipt, identity: PromotionEvidence['identity']) {
  const findings: string[] = []
  if (receipt.status !== 'complete')
    findings.push(`${receipt.gate}: execution is ${receipt.status}.`)
  if (receipt.counts.executed === 0) findings.push(`${receipt.gate}: no executed cases.`)
  if (receipt.counts.failed > 0 || receipt.counts.skipped > 0)
    findings.push(`${receipt.gate}: failed or unexecuted required cases remain.`)
  if (receipt.counts.failed > receipt.counts.executed)
    findings.push(`${receipt.gate}: inconsistent executed-case counters.`)
  const identityFields = [
    'candidateCommit',
    'grammarSha256',
    'resolverSha256',
    'candidateSourceSha256',
    'lockfileSha256',
    'budgetSha256',
    'evaluationManifestSha256',
    'workloadManifestSha256',
  ] as const
  for (const field of identityFields) {
    if (receipt.identity[field] !== identity[field])
      findings.push(`${receipt.gate}: ${field} differs from the sealed report identity.`)
  }
  return findings
}

const FROZEN_COVERAGE: Readonly<Record<PromotionReceipt['gate'], number>> = {
  'candidate-capabilities': 8,
  'native-development-semantics': 652 + 672 + 102,
  'browser-development-semantics': 102,
  'native-heldout-semantics': 100,
  'browser-heldout-semantics': 100,
  'streaming-correctness': 56 + 32,
  interactions: 4,
  safety: 4,
  'visual-states': 128,
  'frame-probes': 32,
  resources: 3,
  'benchmark-coverage': 9,
  'native-paired': 75 * 20,
  'production-timing': 20,
}
const FROZEN_SCENARIOS: TrustedPromotionContext['scenarioIds'] = {
  interactions: [
    'native keyboard copy preserves a selected settled paragraph during unrelated appends',
    'fragment activation scrolls to the heading in its own message',
    'a workspace file link activates the real file server and opens its line',
    'dangerous HTML and link activation preserve safe display after the real HTML stage loads',
  ],
  safety: [
    'dangerous HTML and link activation preserve safe display after the real HTML stage loads',
    'late HTML cannot restore a replaced source or contaminate a sibling document',
    'late math loads the actual renderer after a commit and preserves the prose around it',
    'disposed messages stay disposed when their deferred HTML stage resolves',
  ],
  resources: ['twenty cycles detach message DOM and query observers before harness cache cleanup'],
  'frame-probes': [
    'plain-paragraph',
    'two-paragraphs',
    'soft-line-break',
    'hard-space-break',
    'hard-backslash-break',
    'atx-heading',
    'setext-heading',
    'setext-second-level',
    'strong-emphasis',
    'italic-emphasis',
    'nested-emphasis',
    'escaped-markers',
    'decoded-entities',
    'inline-code',
    'inline-code-backticks',
    'direct-link',
    'link-title',
    'link-emphasis',
    'link-parentheses',
    'reference-late',
    'unordered-list',
    'ordered-start',
    'nested-list',
    'task-list',
    'quoted-paragraph',
    'nested-quote',
    'fenced-typescript',
    'fence-metadata',
    'fenced-whitespace',
    'fence-literal-markdown',
    'simple-table',
    'hebrew-rtl',
  ],
}
function minimumCoverage(gate: PromotionReceipt['gate']) {
  return FROZEN_COVERAGE[gate]
}

function capabilityFindings(receipt: PromotionReceipt, identity: PromotionEvidence['identity']) {
  const findings = ['commonmark', 'gfm', 'math', 'footnotes', 'cjkFlanking'].flatMap((field) =>
    requireBoolean(receipt, field),
  )
  for (const hash of [identity.grammarSha256, identity.resolverSha256]) {
    if (!receipt.artifacts.some((artifact) => artifact.sha256 === hash))
      findings.push('candidate-capabilities: missing actual pinned WASM artifact.')
  }
  return findings
}

function measurementFindings(
  receipt: PromotionReceipt,
  evidence: PromotionEvidence,
  context?: TrustedPromotionContext,
): string[] {
  switch (receipt.gate) {
    case 'candidate-capabilities':
      return capabilityFindings(receipt, evidence.identity)
    case 'native-development-semantics':
    case 'browser-development-semantics':
    case 'native-heldout-semantics':
    case 'browser-heldout-semantics':
      return requireMetric(
        receipt,
        'unexplainedDifferences',
        frozenBudget.semantics.unexplainedDifferences,
      )
    case 'streaming-correctness':
      return ['lostRevisions', 'staleCompletionReceipts', 'unexplainedDifferences'].flatMap(
        (field) => requireMetric(receipt, field, 0),
      )
    case 'interactions':
      return ['lostSelections', 'incorrectClipboardPayloads', 'unsafeActivations'].flatMap(
        (field) => requireMetric(receipt, field, 0),
      )
    case 'safety':
      return ['unsafeActivations', 'isolationFailures'].flatMap((field) =>
        requireMetric(receipt, field, 0),
      )
    case 'visual-states':
      return requireMetric(
        receipt,
        'unexplainedChangedStates',
        frozenBudget.visuals.unexplainedChangedStates,
      ).concat(
        requireBoolean(receipt, 'rasterControlsCalibrated'),
        requireMinimum(receipt, 'pairedEngineCount', 2),
        requireMinimum(receipt, 'themeCount', 2),
        requireMinimum(receipt, 'viewportWidthCount', 2),
      )
    case 'frame-probes':
      return requireMetric(receipt, 'contentFlashes', frozenBudget.visuals.contentFlashes).concat(
        requireMetric(
          receipt,
          'settledFenceColorDrops',
          frozenBudget.visuals.settledFenceColorDrops,
        ),
      )
    case 'resources':
      return resourceFindings(receipt)
    case 'benchmark-coverage':
      return BENCHMARK_FAMILIES.flatMap((family) =>
        requireMinimum(
          receipt,
          `${family}.measuredCells`,
          context?.benchmarkCells[family] ?? 1,
        ).concat(
          requireMetric(receipt, `${family}.missingFields`, 0),
          requireString(receipt, `${family}.domain`, 'browser'),
          requireString(receipt, `${family}.build`, 'production'),
        ),
      )
    case 'native-paired':
      return nativeTimingFindings(receipt, context?.nativeWorkloads ?? evidence.nativeWorkloads)
    case 'production-timing':
      return productionTimingFindings(
        receipt,
        context?.expectedWorkloads ?? evidence.expectedWorkloads,
      )
  }
}

function resourceFindings(receipt: PromotionReceipt) {
  return requireMetric(
    receipt,
    'persistentGrowthAfterCachePlateau',
    frozenBudget.resources.persistentGrowthAfterCachePlateau,
  ).concat(
    requireBoolean(receipt, 'cachePlateauReached'),
    requireBoolean(receipt, 'wasmHighWaterReused'),
    [20, 100, 500].flatMap((cycles) => requireMinimum(receipt, `disposedCycles-${cycles}`, cycles)),
  )
}

function nativeTimingFindings(
  receipt: PromotionReceipt,
  workloads: PromotionEvidence['nativeWorkloads'],
) {
  const findings = requireBoolean(receipt, 'quietHostEstablished').concat(
    requireMetric(receipt, 'unmeasuredMandatoryCells', 0),
  )
  if (typeof receipt.metrics.hostId !== 'string')
    findings.push('native-paired: missing identified timing host.')
  const comparisons = receipt.comparisons ?? []
  for (const workload of workloads)
    findings.push(...workloadTimingFindings(receipt, workload, comparisons, 'native'))
  if (comparisons.length !== workloads.reduce((sum, workload) => sum + workload.metrics.length, 0))
    findings.push('native-paired: comparison coverage differs from the frozen native matrix.')
  return findings
}

function productionTimingFindings(
  receipt: PromotionReceipt,
  workloads: PromotionEvidence['expectedWorkloads'],
) {
  const findings = requireBoolean(receipt, 'productionBuild').concat(
    requireBoolean(receipt, 'quietHostEstablished'),
  )
  for (const field of ['hostId', 'runtimeVersion', 'browserVersion', 'fontFingerprint']) {
    if (typeof receipt.metrics[field] !== 'string' || receipt.metrics[field].length === 0)
      findings.push(`${receipt.gate}: missing measured ${field}.`)
  }
  const comparisons = receipt.comparisons ?? []
  if (comparisons.length === 0)
    findings.push('production-timing: no independent paired timing comparisons.')
  for (const workload of workloads)
    findings.push(...workloadTimingFindings(receipt, workload, comparisons, 'browser'))
  const expectedCount = workloads.reduce((sum, workload) => sum + workload.metrics.length, 0)
  if (comparisons.length !== expectedCount)
    findings.push(
      'production-timing: paired comparison coverage differs from the workload manifest.',
    )
  return findings
}

function workloadTimingFindings(
  receipt: PromotionReceipt,
  workload: TimingWorkload,
  comparisons: readonly PromotionComparison[],
  domain: 'native' | 'browser',
) {
  const findings = workload.metrics.flatMap((field) => {
    const selected = comparisons.filter(
      (comparison) => comparison.workload === workload.id && comparison.metric === field,
    )
    if (selected.length !== 1)
      return [`${workload.id}: missing or duplicate paired ${field} receipt.`]
    return comparisonFindings(selected[0], domain)
  })
  if (domain === 'native') return findings
  findings.push(...arrivalFindings(receipt, workload))
  if (!ordinaryWorkload(workload)) return findings
  const limits = frozenBudget.ordinaryStreaming
  return findings.concat(
    [
      ['prefixProjectionP95Ms', limits.p95PrefixProjectionMs],
      ['heldSyntaxReleaseP95Ms', limits.p95HeldSyntaxReleaseMs],
      ['mainThreadP95Ms', limits.p95MainThreadMs],
      ['maximumAttributableTaskMs', limits.maximumAttributableTaskMs],
    ].flatMap(([field, maximum]) =>
      requireMetric(receipt, `${workload.id}.${field}`, Number(maximum)),
    ),
  )
}

function arrivalFindings(receipt: PromotionReceipt, workload: TimingWorkload) {
  const expected: unknown = Reflect.get(workload, 'expectedInputUpdates')
  const processed = receipt.metrics[`${workload.id}.processedInputs`]
  const completed = receipt.metrics[`${workload.id}.completionReceipts`]
  const painted = receipt.metrics[`${workload.id}.paintedUpdates`]
  const unpainted = receipt.metrics[`${workload.id}.unpaintedUpdates`]
  const findings: string[] = []
  if (
    typeof expected !== 'number' ||
    expected <= 0 ||
    processed !== expected ||
    completed !== expected
  )
    findings.push(
      `${workload.id}: every frozen input needs an actual processing/completion receipt.`,
    )
  if (
    typeof painted !== 'number' ||
    typeof unpainted !== 'number' ||
    !Number.isInteger(painted) ||
    !Number.isInteger(unpainted) ||
    painted <= 0 ||
    unpainted < 0 ||
    painted + unpainted !== expected
  )
    findings.push(
      `${workload.id}: actual painted and unpainted updates do not cover the arrival schedule.`,
    )
  if (Reflect.get(workload, 'paintPolicy') === 'every-revision' && unpainted !== 0)
    findings.push(`${workload.id}: required paced paints are missing.`)
  return findings
}

function comparisonFindings(comparison: PromotionComparison, domain: 'native' | 'browser') {
  const findings: string[] = []
  if (
    comparison.domain !== domain ||
    comparison.build !== (domain === 'native' ? 'source' : 'production')
  )
    findings.push(
      `${comparison.workload}: ${comparison.metric} has the wrong measured execution domain or build.`,
    )
  const policy = metricBudget(comparison.metric)
  if (comparison.independentTrials < frozenBudget.independentPairedTrials)
    findings.push(
      `${comparison.workload}: ${comparison.metric} has fewer than 20 independent paired trials.`,
    )
  if (comparison.ratio !== policy.ratio || comparison.allowanceMs !== policy.allowanceMs)
    findings.push(`${comparison.workload}: ${comparison.metric} uses a different budget.`)
  if (comparison.resamples < 2000)
    findings.push(
      `${comparison.workload}: ${comparison.metric} has insufficient bootstrap resamples.`,
    )
  if (comparison.lowerMarginMs > comparison.upperMarginMs)
    findings.push(`${comparison.workload}: ${comparison.metric} confidence interval is reversed.`)
  const margin = comparison.candidateMs - comparison.baselineMs * policy.ratio - policy.allowanceMs
  if (comparison.status !== 'passed' || comparison.upperMarginMs > 0 || margin > 0)
    findings.push(
      `${comparison.workload}: ${comparison.metric} fails or crosses its paired budget.`,
    )
  return findings
}

export function metricBudget(field: PromotionComparison['metric']) {
  if (field === 'streamCpu')
    return {
      ratio: frozenBudget.totalStreamCpu.ratio,
      allowanceMs: frozenBudget.totalStreamCpu.allowanceMs,
    }
  if (field === 'mountP95')
    return {
      ratio: frozenBudget.pairedLatency.p95MountRatio,
      allowanceMs: frozenBudget.pairedLatency.p95MountAllowanceMs,
    }
  if (field === 'settlementP95')
    return {
      ratio: frozenBudget.pairedLatency.p95SettlementRatio,
      allowanceMs: frozenBudget.pairedLatency.p95SettlementAllowanceMs,
    }
  return {
    ratio: frozenBudget.pairedLatency.p95UpdateRatio,
    allowanceMs: frozenBudget.pairedLatency.p95UpdateAllowanceMs,
  }
}

function ordinaryWorkload(workload: TimingWorkload) {
  return (
    Reflect.get(workload, 'arrival') === 'paced' &&
    workload.sourceBytes <= frozenBudget.ordinaryStreaming.maximumSourceBytes &&
    workload.scheduleUnits === frozenBudget.ordinaryStreaming.scheduleUtf16Units
  )
}
function requireMetric(receipt: PromotionReceipt, field: string, maximum: number) {
  const actual = receipt.metrics[field]
  if (typeof actual === 'number' && actual >= 0 && actual <= maximum) return []
  return [`${receipt.gate}: missing or over-budget measured ${field}.`]
}
function requireMinimum(receipt: PromotionReceipt, field: string, minimum: number) {
  const actual = receipt.metrics[field]
  return typeof actual === 'number' && Number.isInteger(actual) && actual >= minimum
    ? []
    : [`${receipt.gate}: missing or incomplete measured ${field}.`]
}

function requireString(receipt: PromotionReceipt, field: string, expected: string) {
  return receipt.metrics[field] === expected
    ? []
    : [`${receipt.gate}: missing or wrong measured ${field}.`]
}

function requireBoolean(receipt: PromotionReceipt, field: string) {
  return receipt.metrics[field] === true
    ? []
    : [`${receipt.gate}: missing measured ${field} proof.`]
}

export async function verifyPromotionArtifacts(
  input: unknown,
  directory: string,
): Promise<ReadonlyMap<string, string>> {
  const parsed = v.safeParse(evidenceSchema, input)
  const verified = new Map<string, string>()
  if (!parsed.success) return verified
  const root = await realpath(directory)
  const paths = new Set(
    parsed.output.receipts.flatMap((receipt) => receipt.artifacts.map((artifact) => artifact.path)),
  )
  for (const file of paths) {
    try {
      verified.set(
        file,
        createHash('sha256')
          .update(await readFile(await evidencePath(root, file)))
          .digest('hex'),
      )
    } catch {
      // Missing or unreadable artifacts remain absent and block their owning gates.
    }
  }
  return verified
}

function insideDirectory(root: string, file: string) {
  const relative = path.relative(root, file)
  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  )
}
async function evidencePath(root: string, file: string) {
  if (path.isAbsolute(file) || file.split(/[\\/]/u).includes('..'))
    throw createScriptError('Evidence artifacts must stay inside their report directory.', {
      internal: { boundary: 'evidence-path' },
    })
  const resolved = await realpath(path.resolve(root, file))
  if (!insideDirectory(root, resolved))
    throw createScriptError('Evidence artifact escapes the report directory.', {
      internal: { boundary: 'evidence-symlink' },
    })
  return resolved
}

function trustedContextFindings(evidence: PromotionEvidence, context: TrustedPromotionContext) {
  const findings: string[] = []
  if (
    Object.entries(context.identity).some(
      ([field, value]) => Reflect.get(evidence.identity, field) !== value,
    )
  )
    findings.push(
      'Evidence identity differs from the actual clean candidate and selected evaluation batch.',
    )
  if (workloadKey(evidence.nativeWorkloads) !== workloadKey(context.nativeWorkloads))
    findings.push('Evidence omits or changes the frozen native qualification workload matrix.')
  if (workloadKey(evidence.expectedWorkloads) !== workloadKey(context.expectedWorkloads))
    findings.push('Evidence omits or changes the frozen qualification workload matrix.')
  if (context.selectedBatch.messages !== 100)
    findings.push('The trusted evaluation batch denominator is invalid.')
  for (const [scope, count] of Object.entries(context.heldoutCounts)) {
    if (count.total === 0 || count.failed > 0 || count.passed !== count.total)
      findings.push(`Trusted heldout ${scope} has unexecuted or failed checks.`)
  }
  if (
    context.heldoutCounts.nativeCases.total !== 100 ||
    context.heldoutCounts.browserCases.total !== 100
  )
    findings.push(
      'The actual evaluation receipt does not cover all 100 native and browser messages.',
    )
  return findings
}
type TimingWorkload = PromotionEvidence['nativeWorkloads'][number]
function workloadKey(workloads: readonly TimingWorkload[]) {
  return JSON.stringify(
    workloads.map((workload) => [
      workload.id,
      workload.sourceBytes,
      workload.scheduleUnits,
      workload.metrics.toSorted(),
      Reflect.get(workload, 'arrival') ?? null,
      Reflect.get(workload, 'scheduleId') ?? null,
      Reflect.get(workload, 'sourceSha256') ?? null,
      Reflect.get(workload, 'expectedInputUpdates') ?? null,
      Reflect.get(workload, 'paintPolicy') ?? null,
    ]),
  )
}
function requiredScenarioFindings(receipt: PromotionReceipt, context: TrustedPromotionContext) {
  const required = context.scenarioIds[receipt.gate] ?? []
  const findings = required.flatMap((id) =>
    requireMinimum(receipt, `scenario.${id}.executed`, 1).concat(
      requireMetric(receipt, `scenario.${id}.failed`, 0),
    ),
  )
  if (receipt.gate === 'native-heldout-semantics' || receipt.gate === 'browser-heldout-semantics') {
    if (
      receipt.metrics.batchAssetSha256 !== context.selectedBatch.assetSha256 ||
      receipt.metrics.batchId !== context.selectedBatch.id
    )
      findings.push(
        `${receipt.gate}: receipt does not identify the actual selected unretired batch.`,
      )
    if (
      !receipt.artifacts.some((artifact) => artifact.sha256 === context.evaluationArtifact.sha256)
    )
      findings.push(`${receipt.gate}: actual trusted evaluation receipt is missing.`)
  }
  return findings
}

export async function createTrustedPromotionContext(
  options: TrustedPromotionOptions,
): Promise<TrustedPromotionContext> {
  const { readTrustedEvaluationContext } = await import('./evaluate-heldout')
  const { nativePairWorkloads } = await import('./paired-native')
  const selected = await readTrustedEvaluationContext({
    root: options.root,
    receiptPath: options.evaluationReceipt,
    ledgerDirectory: options.evaluationLedger,
  })
  const matrix = nativePairWorkloads('qualification')
  const fields = ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const
  const nativeWorkloads = matrix.map((entry) => ({
    id: entry.id,
    sourceBytes: entry.sourceBytes,
    scheduleUnits: entry.scheduleUnits,
    metrics: fields.slice(),
  }))
  const production: unknown = await import(
    pathToFileURL(path.join(options.root, 'scripts/markdown/production-workloads.ts')).href
  )
  if (!production || typeof production !== 'object')
    throw createScriptError('The production timing manifest is unavailable.', {
      internal: { boundary: 'production-workloads' },
    })
  const producer: unknown = Reflect.get(production, 'productionTimingManifest')
  if (typeof producer !== 'function')
    throw createScriptError('The production timing manifest producer is unavailable.', {
      internal: { boundary: 'production-workloads' },
    })
  const productionManifest = v.parse(
    v.object({
      schemaVersion: v.literal(1),
      domain: v.literal('browser'),
      build: v.literal('production'),
      workloads: productionWorkloadsSchema,
    }),
    Reflect.apply(producer, production, []),
  )
  const expectedWorkloads = productionManifest.workloads
  const identity = {
    ...selected.candidateIdentity,
    budgetSha256: await frozenBudgetSha256(),
    evaluationManifestSha256: selected.selectedBatch.manifestSha256,
    workloadManifestSha256: createHash('sha256')
      .update(
        JSON.stringify(
          matrix.map(({ source, revisions, ...entry }) => ({
            ...entry,
            sourceSha256: createHash('sha256').update(source).digest('hex'),
            revisionSourceSha256:
              revisions?.map((source) => createHash('sha256').update(source).digest('hex')) ?? [],
          })),
        ),
      )
      .digest('hex'),
  }
  const scenarios = FROZEN_SCENARIOS
  const sourceBytes = await readFile(path.join(options.root, 'scripts/markdown/workloads.ts'))
  if (
    createHash('sha256').update(sourceBytes).digest('hex') !==
    '47188894711f5e468868c14dbfd16e6e27cfd35d058413b4a509c879d928455f'
  )
    throw createScriptError('The frozen qualification workload source changed.', {
      internal: { boundary: 'workload-manifest' },
    })
  if (matrix.length !== 75)
    throw createScriptError('The qualification timing matrix changed its frozen denominator.', {
      internal: { expected: 75, observed: matrix.length },
    })
  const sourceSizes = BENCHMARK_PROFILES.promotion
  const benchmarkCells = {
    'cold-mount': 4,
    'warm-completed': 8 + sourceSizes.completedBytes.length,
    'streaming-replay': matrix.filter((entry) => entry.family === 'streaming-replay').length + 4,
    'pathological-scaling': matrix.filter((entry) => entry.family === 'pathological-scaling')
      .length,
    'reference-invalidation': 5,
    'highlighting-extensions': 5,
    'timeline-input': sourceSizes.timelineCounts.length,
    resources: sourceSizes.cycleCounts.length,
    payload: 2,
  }
  return {
    identity,
    expectedWorkloads,
    nativeWorkloads,
    minimumCoverage: FROZEN_COVERAGE,
    benchmarkCells,
    scenarioIds: scenarios,
    selectedBatch: selected.selectedBatch,
    heldoutCounts: selected.requiredChecks,
    evaluationArtifact: {
      path: path.relative(options.evidenceDirectory, selected.artifact.path),
      sha256: selected.artifact.sha256,
    },
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      out: { type: 'string' },
      root: { type: 'string' },
      'evaluation-receipt': { type: 'string' },
      'evaluation-ledger': { type: 'string' },
    },
  })
  if (!values.input)
    throw createScriptError('Promotion evaluation requires --input JSON', {
      internal: { argument: 'input' },
    })
  const directory = path.dirname(path.resolve(values.input))
  const evidence: unknown = JSON.parse(await readFile(values.input, 'utf8'))
  const artifacts = await verifyPromotionArtifacts(evidence, directory)
  let context: TrustedPromotionContext | undefined
  const failures: string[] = []
  if (values['evaluation-receipt'] && values['evaluation-ledger']) {
    try {
      context = await createTrustedPromotionContext({
        root: values.root ? path.resolve(values.root) : path.resolve(import.meta.dirname, '../..'),
        evaluationReceipt: path.resolve(values['evaluation-receipt']),
        evaluationLedger: path.resolve(values['evaluation-ledger']),
        evidenceDirectory: directory,
      })
    } catch (failure) {
      failures.push(
        `Authoritative context could not be established: ${failure instanceof Error ? failure.message : 'invalid evidence'}`,
      )
    }
  }
  const evaluated = evaluatePromotion(evidence, await frozenBudgetSha256(), artifacts, context)
  const result = { ...evaluated, findings: evaluated.findings.concat(failures) }
  if (values.out) await writeFile(values.out, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.verdict === 'VERIFIED' ? 0 : 1
}
