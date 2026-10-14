import { createHash } from 'node:crypto'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  evaluatePromotion,
  metricBudget,
  PROMOTION_GATES,
  verifyPromotionArtifacts,
  type PromotionEvidence,
  type PromotionReceipt,
  type TrustedPromotionContext,
} from './promotion'
import { BENCHMARK_FAMILIES } from './workloads'
import { nativePairWorkloads } from './paired-native'

const budgetHash = 'a'.repeat(64)
const artifactHash = 'b'.repeat(64)
const grammarHash = '1'.repeat(64)
const resolverHash = '2'.repeat(64)
const evaluationHash = '4'.repeat(64)
const verified = new Map([
  ['evaluation.json', evaluationHash],
  ['receipts.json', artifactHash],
  ['grammar.wasm', grammarHash],
  ['resolver.wasm', resolverHash],
])

function evidence(): PromotionEvidence {
  const identity = {
    candidateCommit: '3'.repeat(40),
    grammarSha256: grammarHash,
    resolverSha256: resolverHash,
    candidateSourceSha256: 'c'.repeat(64),
    lockfileSha256: 'd'.repeat(64),
    budgetSha256: budgetHash,
    evaluationManifestSha256: 'e'.repeat(64),
    workloadManifestSha256: 'f'.repeat(64),
  }
  const metrics = {
    commonmark: true,
    gfm: true,
    math: true,
    footnotes: true,
    cjkFlanking: true,
    pairedEngineCount: 2,
    themeCount: 2,
    viewportWidthCount: 2,
    unexplainedDifferences: 0,
    lostRevisions: 0,
    staleCompletionReceipts: 0,
    lostSelections: 0,
    incorrectClipboardPayloads: 0,
    unsafeActivations: 0,
    isolationFailures: 0,
    unexplainedChangedStates: 0,
    rasterControlsCalibrated: true,
    contentFlashes: 0,
    settledFenceColorDrops: 0,
    persistentGrowthAfterCachePlateau: 0,
    cachePlateauReached: true,
    wasmHighWaterReused: true,
    'disposedCycles-20': 20,
    'disposedCycles-100': 100,
    'disposedCycles-500': 500,
    productionBuild: true,
    quietHostEstablished: true,
    unmeasuredMandatoryCells: 0,
    batchId: 'oasst1-batch-001.json.gz',
    batchAssetSha256: '5'.repeat(64),
    hostId: 'test-host',
    runtimeVersion: 'test-runtime',
    browserVersion: 'test-browser',
    fontFingerprint: 'test-fonts',
    'ordinary.prefixProjectionP95Ms': 10,
    'ordinary.heldSyntaxReleaseP95Ms': 10,
    'ordinary.mainThreadP95Ms': 2,
    'ordinary.maximumAttributableTaskMs': 20,
    'ordinary.processedInputs': 87,
    'ordinary.completionReceipts': 87,
    'ordinary.paintedUpdates': 87,
    'ordinary.unpaintedUpdates': 0,
  }
  const benchmarkMetrics = Object.fromEntries(
    BENCHMARK_FAMILIES.flatMap((family) => [
      [`${family}.measuredCells`, 1],
      [`${family}.missingFields`, 0],
      [`${family}.domain`, 'browser'],
      [`${family}.build`, 'production'],
    ]),
  )
  const fields = ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const
  const nativeWorkloads = nativePairWorkloads('qualification').map((entry) => ({
    id: entry.id,
    sourceBytes: entry.sourceBytes,
    scheduleUnits: entry.scheduleUnits,
    metrics: fields.slice(),
  }))
  const comparisons = fields.map((metric) => ({
    domain: 'browser' as const,
    build: 'production' as const,
    workload: 'ordinary',
    metric,
    independentTrials: 20,
    baselineMs: 10,
    candidateMs: 8,
    ...metricBudget(metric),
    confidence: 0.95 as const,
    resamples: 4096,
    lowerMarginMs: -5,
    upperMarginMs: -1,
    status: 'passed' as const,
  }))
  return {
    schemaVersion: 1,
    identity,
    nativeWorkloads,
    expectedWorkloads: [
      {
        id: 'ordinary',
        sourceBytes: 2048,
        scheduleUnits: 24,
        metrics: fields.slice(),
        arrival: 'paced',
        scheduleId: 'paced-fixed24',
        sourceSha256: '6'.repeat(64),
        expectedInputUpdates: 87,
        paintPolicy: 'every-revision',
      },
    ],
    receipts: PROMOTION_GATES.map((gate) => ({
      gate,
      status: 'complete',
      identity: { ...identity },
      artifacts: [
        { path: 'receipts.json', sha256: artifactHash },
        { path: 'evaluation.json', sha256: evaluationHash },
        { path: 'grammar.wasm', sha256: grammarHash },
        { path: 'resolver.wasm', sha256: resolverHash },
      ],
      counts: { executed: 2000, failed: 0, skipped: 0 },
      metrics: { ...metrics, ...benchmarkMetrics },
      ...(gate === 'production-timing' ? { comparisons } : {}),
      ...(gate === 'native-paired'
        ? {
            comparisons: nativeWorkloads.flatMap((entry) =>
              fields.map((metric) => ({
                ...comparisons[0],
                ...metricBudget(metric),
                workload: entry.id,
                metric,
                domain: 'native' as const,
                build: 'source' as const,
              })),
            ),
          }
        : {}),
    })),
  }
}

function trusted(data: PromotionEvidence = evidence()): TrustedPromotionContext {
  const minimumCoverage = Object.fromEntries(PROMOTION_GATES.map((gate) => [gate, 2]))
  const complete: TrustedPromotionContext['minimumCoverage'] = {
    ...minimumCoverage,
    'candidate-capabilities': 8,
    'native-development-semantics': 1426,
    'browser-development-semantics': 102,
    'native-heldout-semantics': 100,
    'browser-heldout-semantics': 100,
    'streaming-correctness': 88,
    interactions: 4,
    safety: 4,
    'visual-states': 128,
    'frame-probes': 32,
    resources: 3,
    'benchmark-coverage': 9,
    'native-paired': 1500,
    'production-timing': 20,
  }
  return {
    identity: data.identity,
    expectedWorkloads: data.expectedWorkloads,
    nativeWorkloads: data.nativeWorkloads,
    minimumCoverage: complete,
    benchmarkCells: {
      'cold-mount': 1,
      'warm-completed': 1,
      'streaming-replay': 1,
      'pathological-scaling': 1,
      'reference-invalidation': 1,
      'highlighting-extensions': 1,
      'timeline-input': 1,
      resources: 1,
      payload: 1,
    },
    scenarioIds: {},
    selectedBatch: { id: 'oasst1-batch-001.json.gz', assetSha256: '5'.repeat(64), messages: 100 },
    heldoutCounts: {
      nativeCases: { total: 100, passed: 100, failed: 0 },
      browserCases: { total: 100, passed: 100, failed: 0 },
      streamCases: { total: 1000, passed: 1000, failed: 0 },
    },
    evaluationArtifact: { path: 'evaluation.json', sha256: evaluationHash },
  }
}
const authoritative = trusted()
function verify(
  input: unknown,
  budget: string = budgetHash,
  artifacts: ReadonlyMap<string, string> = verified,
) {
  return evaluatePromotion(input, budget, artifacts, authoritative)
}

function gate(data: PromotionEvidence, id: PromotionReceipt['gate']) {
  const receipt = data.receipts.find((receipt) => receipt.gate === id)
  expect(receipt).toBeDefined()
  if (!receipt) throw new TypeError('Test control receipt is missing')
  return receipt
}

test('complete receipts require independently supplied authoritative context and actual artifacts', () => {
  expect(evaluatePromotion(evidence(), budgetHash, verified).verdict).toBe('NOT VERIFIED')
  expect(verify(evidence(), budgetHash, verified).verdict).toBe('VERIFIED')
  expect(verify({ verdict: 'PAIRED NATIVE PASS' }, budgetHash, verified).verdict).toBe(
    'NOT VERIFIED',
  )
  expect(verify(evidence(), budgetHash, new Map()).verdict).toBe('NOT VERIFIED')
})

test.each(PROMOTION_GATES)('missing %s remains a cutover blocker', (id) => {
  const data = evidence()
  data.receipts = data.receipts.filter((receipt) => receipt.gate !== id)
  const result = verify(data, budgetHash, verified)
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.gates.find((receipt) => receipt.gate === id)?.status).toBe('blocked')
})

test.each(['math', 'footnotes', 'cjkFlanking'])(
  'missing %s capability blocks otherwise passing semantics',
  (field) => {
    const data = evidence()
    gate(data, 'candidate-capabilities').metrics[field] = false
    expect(verify(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  },
)

test('minimum heldout, official-spec and paired visual coverage cannot be replaced by a smoke case', () => {
  for (const [id, executed] of [
    ['native-development-semantics', 1324],
    ['native-heldout-semantics', 99],
    ['browser-heldout-semantics', 99],
    ['visual-states', 127],
  ] satisfies readonly (readonly [PromotionReceipt['gate'], number])[]) {
    const data = evidence()
    gate(data, id).counts.executed = executed
    expect(verify(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  }
  const data = evidence()
  gate(data, 'visual-states').metrics.pairedEngineCount = 1
  expect(verify(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  const missingWasm = evidence()
  gate(missingWasm, 'candidate-capabilities').artifacts = [
    { path: 'receipts.json', sha256: artifactHash },
  ]
  expect(verify(missingWasm, budgetHash, verified).verdict).toBe('NOT VERIFIED')
})

test('skipped coverage, changed provenance and changed evidence files fail', () => {
  const skipped = evidence()
  gate(skipped, 'native-heldout-semantics').counts.skipped = 1
  expect(verify(skipped, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  const changed = evidence()
  gate(changed, 'browser-heldout-semantics').identity.evaluationManifestSha256 = '0'.repeat(64)
  expect(verify(changed, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  expect(verify(evidence(), '0'.repeat(64), verified).verdict).toBe('NOT VERIFIED')
  expect(verify(evidence(), budgetHash, new Map([['receipts.json', '0'.repeat(64)]])).verdict).toBe(
    'NOT VERIFIED',
  )
})

test('development/noisy timing, insufficient pairs and confidence bounds cannot pass', () => {
  for (const field of ['productionBuild', 'quietHostEstablished']) {
    const data = evidence()
    gate(data, 'production-timing').metrics[field] = false
    expect(verify(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  }
  const data = evidence()
  const receipt = gate(data, 'production-timing')
  const first = receipt.comparisons?.[0]
  expect(first).toBeDefined()
  if (!first) return
  first.independentTrials = 19
  expect(verify(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  first.independentTrials = 20
  first.upperMarginMs = 0.1
  expect(verify(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  first.upperMarginMs = -1
  first.candidateMs = 50
  expect(verify(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
})

test('missing family fields, resource reuse and ordinary timing remain explicit blockers', () => {
  for (const [id, field] of [
    ['benchmark-coverage', 'payload.missingFields'],
    ['resources', 'wasmHighWaterReused'],
    ['production-timing', 'ordinary.heldSyntaxReleaseP95Ms'],
  ] satisfies readonly (readonly [PromotionReceipt['gate'], string])[]) {
    const data = evidence()
    delete gate(data, id).metrics[field]
    const result = verify(data, budgetHash, verified)
    expect(result.verdict).toBe('NOT VERIFIED')
    expect(result.gates.find((receipt) => receipt.gate === id)?.findings.join(' ')).toContain(field)
  }
})

test('artifact verification hashes actual files and preserves missing evidence as absent', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-promotion-'))
  try {
    const body = 'actual test receipt'
    await writeFile(path.join(directory, 'receipts.json'), body)
    const artifacts = await verifyPromotionArtifacts(evidence(), directory)
    expect(artifacts.get('receipts.json')).toBe(createHash('sha256').update(body).digest('hex'))
    expect(verify(evidence(), budgetHash, artifacts).verdict).toBe('NOT VERIFIED')
    await rm(path.join(directory, 'receipts.json'))
    expect((await verifyPromotionArtifacts(evidence(), directory)).size).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('selfdeclared candidate, trimmed native matrix and retired batch counters cannot override trusted context', () => {
  const changed = evidence()
  changed.identity.candidateCommit = '0'.repeat(40)
  for (const receipt of changed.receipts)
    receipt.identity.candidateCommit = changed.identity.candidateCommit
  expect(verify(changed).verdict).toBe('NOT VERIFIED')
  const trimmed = evidence()
  trimmed.nativeWorkloads = trimmed.nativeWorkloads.slice(0, 1)
  expect(verify(trimmed).verdict).toBe('NOT VERIFIED')
  const wrongBatch = evidence()
  gate(wrongBatch, 'native-heldout-semantics').metrics.batchAssetSha256 = '0'.repeat(64)
  expect(verify(wrongBatch).verdict).toBe('NOT VERIFIED')
  const missingBrowser = {
    ...authoritative,
    heldoutCounts: {
      ...authoritative.heldoutCounts,
      browserCases: { total: 100, passed: 0, failed: 0 },
    },
  }
  expect(evaluatePromotion(evidence(), budgetHash, verified, missingBrowser).verdict).toBe(
    'NOT VERIFIED',
  )
})

test('source-native comparison rows cannot certify production browser latency', () => {
  const data = evidence()
  const comparisons = gate(data, 'production-timing').comparisons
  expect(comparisons).toBeDefined()
  if (!comparisons) return
  for (const comparison of comparisons) {
    comparison.domain = 'native'
    comparison.build = 'source'
  }
  expect(verify(data).verdict).toBe('NOT VERIFIED')
  const wrongSchedule = evidence()
  wrongSchedule.expectedWorkloads[0].arrival = 'burst-coalesced'
  expect(verify(wrongSchedule).verdict).toBe('NOT VERIFIED')
})

test('artifact verification rejects absolute paths, parent traversal and symlink escapes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-evidence-boundary-'))
  const evidenceDirectory = path.join(directory, 'evidence')
  const outside = path.join(directory, 'outside.json')
  try {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(evidenceDirectory)
    await writeFile(outside, 'external proof')
    await symlink(outside, path.join(evidenceDirectory, 'linked.json'))
    const data = evidence()
    for (const receipt of data.receipts)
      receipt.artifacts = [
        { path: '../outside.json', sha256: artifactHash },
        { path: outside, sha256: artifactHash },
        { path: 'linked.json', sha256: artifactHash },
      ]
    expect((await verifyPromotionArtifacts(data, evidenceDirectory)).size).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('missing input completions and invented paint coverage block production timing', () => {
  const omitted = evidence()
  gate(omitted, 'production-timing').metrics['ordinary.completionReceipts'] = 86
  expect(verify(omitted).verdict).toBe('NOT VERIFIED')
  const unpainted = evidence()
  gate(unpainted, 'production-timing').metrics['ordinary.paintedUpdates'] = 86
  gate(unpainted, 'production-timing').metrics['ordinary.unpaintedUpdates'] = 1
  expect(verify(unpainted).verdict).toBe('NOT VERIFIED')
  const nativeCoverage = evidence()
  gate(nativeCoverage, 'benchmark-coverage').metrics['streaming-replay.domain'] = 'native'
  expect(verify(nativeCoverage).verdict).toBe('NOT VERIFIED')
})
