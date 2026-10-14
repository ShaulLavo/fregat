import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import * as v from 'valibot'
import { createScriptError } from '../structured-errors'
import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import { BENCHMARK_FAMILIES } from './workloads'
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
const evidenceSchema = v.strictObject({
  schemaVersion: v.literal(1),
  identity: identitySchema,
  expectedWorkloads: v.pipe(
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
  receipts: v.array(receiptSchema),
})
export type PromotionEvidence = v.InferOutput<typeof evidenceSchema>
export type PromotionReceipt = PromotionEvidence['receipts'][number]
export type PromotionComparison = v.InferOutput<typeof comparisonSchema>
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
  const gates = PROMOTION_GATES.map((gate) => evaluateGate(gate, evidence, verifiedArtifacts))
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
  const requiredCoverage = minimumCoverage(gate)
  if (receipt.counts.executed < requiredCoverage)
    findings.push(`${gate}: fewer than ${requiredCoverage} required cases were executed.`)
  for (const artifact of receipt.artifacts) {
    if (verifiedArtifacts.get(artifact.path) !== artifact.sha256)
      findings.push(`${gate}: missing or changed evidence artifact ${artifact.path}.`)
  }
  findings.push(...measurementFindings(receipt, evidence))
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

function minimumCoverage(gate: PromotionReceipt['gate']) {
  if (gate === 'native-development-semantics') return 652 + 672 + MARKDOWN_CASES.length
  if (gate === 'native-heldout-semantics' || gate === 'browser-heldout-semantics') return 100
  if (gate === 'visual-states') return 128
  return 1
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

function measurementFindings(receipt: PromotionReceipt, evidence: PromotionEvidence): string[] {
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
        requirePositive(receipt, `${family}.measuredCells`).concat(
          requireMetric(receipt, `${family}.missingFields`, 0),
        ),
      )
    case 'production-timing':
      return productionTimingFindings(receipt, evidence.expectedWorkloads)
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
    findings.push(...workloadTimingFindings(receipt, workload, comparisons))
  const expectedCount = workloads.reduce((sum, workload) => sum + workload.metrics.length, 0)
  if (comparisons.length !== expectedCount)
    findings.push(
      'production-timing: paired comparison coverage differs from the workload manifest.',
    )
  return findings
}

function workloadTimingFindings(
  receipt: PromotionReceipt,
  workload: PromotionEvidence['expectedWorkloads'][number],
  comparisons: readonly PromotionComparison[],
) {
  const findings = workload.metrics.flatMap((field) => {
    const selected = comparisons.filter(
      (comparison) => comparison.workload === workload.id && comparison.metric === field,
    )
    if (selected.length !== 1)
      return [`${workload.id}: missing or duplicate paired ${field} receipt.`]
    return comparisonFindings(selected[0])
  })
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

function comparisonFindings(comparison: PromotionComparison) {
  const findings: string[] = []
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

function ordinaryWorkload(workload: PromotionEvidence['expectedWorkloads'][number]) {
  return (
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
function requirePositive(receipt: PromotionReceipt, field: string) {
  const actual = receipt.metrics[field]
  return typeof actual === 'number' && actual > 0
    ? []
    : [`${receipt.gate}: no actual measured ${field}.`]
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
  const paths = new Set(
    parsed.output.receipts.flatMap((receipt) => receipt.artifacts.map((artifact) => artifact.path)),
  )
  for (const file of paths) {
    try {
      verified.set(
        file,
        createHash('sha256')
          .update(await readFile(path.resolve(directory, file)))
          .digest('hex'),
      )
    } catch {
      // Missing or unreadable artifacts remain absent and block their owning gates.
    }
  }
  return verified
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, out: { type: 'string' } } })
  if (!values.input)
    throw createScriptError('Promotion evaluation requires --input JSON', {
      internal: { argument: 'input' },
    })
  const evidence: unknown = JSON.parse(await readFile(values.input, 'utf8'))
  const artifacts = await verifyPromotionArtifacts(
    evidence,
    path.dirname(path.resolve(values.input)),
  )
  const result = evaluatePromotion(evidence, await frozenBudgetSha256(), artifacts)
  if (values.out) await writeFile(values.out, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.verdict === 'VERIFIED' ? 0 : 1
}
