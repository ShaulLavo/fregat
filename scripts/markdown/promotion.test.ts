import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
} from './promotion'
import { BENCHMARK_FAMILIES } from './workloads'

const budgetHash = 'a'.repeat(64)
const artifactHash = 'b'.repeat(64)
const grammarHash = '1'.repeat(64)
const resolverHash = '2'.repeat(64)
const verified = new Map([
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
    hostId: 'test-host',
    runtimeVersion: 'test-runtime',
    browserVersion: 'test-browser',
    fontFingerprint: 'test-fonts',
    'ordinary.prefixProjectionP95Ms': 10,
    'ordinary.heldSyntaxReleaseP95Ms': 10,
    'ordinary.mainThreadP95Ms': 2,
    'ordinary.maximumAttributableTaskMs': 20,
  }
  const benchmarkMetrics = Object.fromEntries(
    BENCHMARK_FAMILIES.flatMap((family) => [
      [`${family}.measuredCells`, 1],
      [`${family}.missingFields`, 0],
    ]),
  )
  const fields = ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const
  const comparisons = fields.map((metric) => ({
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
    expectedWorkloads: [
      { id: 'ordinary', sourceBytes: 2048, scheduleUnits: 24, metrics: fields.slice() },
    ],
    receipts: PROMOTION_GATES.map((gate) => ({
      gate,
      status: 'complete',
      identity: { ...identity },
      artifacts: [
        { path: 'receipts.json', sha256: artifactHash },
        { path: 'grammar.wasm', sha256: grammarHash },
        { path: 'resolver.wasm', sha256: resolverHash },
      ],
      counts: { executed: 2000, failed: 0, skipped: 0 },
      metrics: { ...metrics, ...benchmarkMetrics },
      ...(gate === 'production-timing' ? { comparisons } : {}),
    })),
  }
}

function gate(data: PromotionEvidence, id: PromotionReceipt['gate']) {
  const receipt = data.receipts.find((receipt) => receipt.gate === id)
  expect(receipt).toBeDefined()
  if (!receipt) throw new TypeError('Test control receipt is missing')
  return receipt
}

test('complete explicit receipts can pass; baseline status and native summaries alone cannot', () => {
  expect(evaluatePromotion(evidence(), budgetHash, verified).verdict).toBe('VERIFIED')
  expect(evaluatePromotion({ verdict: 'PAIRED NATIVE PASS' }, budgetHash, verified).verdict).toBe(
    'NOT VERIFIED',
  )
  expect(evaluatePromotion(evidence(), budgetHash).verdict).toBe('NOT VERIFIED')
})

test.each(PROMOTION_GATES)('missing %s remains a cutover blocker', (id) => {
  const data = evidence()
  data.receipts = data.receipts.filter((receipt) => receipt.gate !== id)
  const result = evaluatePromotion(data, budgetHash, verified)
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.gates.find((receipt) => receipt.gate === id)?.status).toBe('blocked')
})

test.each(['math', 'footnotes', 'cjkFlanking'])(
  'missing %s capability blocks otherwise passing semantics',
  (field) => {
    const data = evidence()
    gate(data, 'candidate-capabilities').metrics[field] = false
    expect(evaluatePromotion(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
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
    expect(evaluatePromotion(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  }
  const data = evidence()
  gate(data, 'visual-states').metrics.pairedEngineCount = 1
  expect(evaluatePromotion(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  const missingWasm = evidence()
  gate(missingWasm, 'candidate-capabilities').artifacts = [
    { path: 'receipts.json', sha256: artifactHash },
  ]
  expect(evaluatePromotion(missingWasm, budgetHash, verified).verdict).toBe('NOT VERIFIED')
})

test('skipped coverage, changed provenance and changed evidence files fail', () => {
  const skipped = evidence()
  gate(skipped, 'native-heldout-semantics').counts.skipped = 1
  expect(evaluatePromotion(skipped, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  const changed = evidence()
  gate(changed, 'browser-heldout-semantics').identity.evaluationManifestSha256 = '0'.repeat(64)
  expect(evaluatePromotion(changed, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  expect(evaluatePromotion(evidence(), '0'.repeat(64), verified).verdict).toBe('NOT VERIFIED')
  expect(
    evaluatePromotion(evidence(), budgetHash, new Map([['receipts.json', '0'.repeat(64)]])).verdict,
  ).toBe('NOT VERIFIED')
})

test('development/noisy timing, insufficient pairs and confidence bounds cannot pass', () => {
  for (const field of ['productionBuild', 'quietHostEstablished']) {
    const data = evidence()
    gate(data, 'production-timing').metrics[field] = false
    expect(evaluatePromotion(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  }
  const data = evidence()
  const receipt = gate(data, 'production-timing')
  const first = receipt.comparisons?.[0]
  expect(first).toBeDefined()
  if (!first) return
  first.independentTrials = 19
  expect(evaluatePromotion(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  first.independentTrials = 20
  first.upperMarginMs = 0.1
  expect(evaluatePromotion(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
  first.upperMarginMs = -1
  first.candidateMs = 50
  expect(evaluatePromotion(data, budgetHash, verified).verdict).toBe('NOT VERIFIED')
})

test('missing family fields, resource reuse and ordinary timing remain explicit blockers', () => {
  for (const [id, field] of [
    ['benchmark-coverage', 'payload.missingFields'],
    ['resources', 'wasmHighWaterReused'],
    ['production-timing', 'ordinary.heldSyntaxReleaseP95Ms'],
  ] satisfies readonly (readonly [PromotionReceipt['gate'], string])[]) {
    const data = evidence()
    delete gate(data, id).metrics[field]
    const result = evaluatePromotion(data, budgetHash, verified)
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
    expect(evaluatePromotion(evidence(), budgetHash, artifacts).verdict).toBe('NOT VERIFIED')
    await rm(path.join(directory, 'receipts.json'))
    expect((await verifyPromotionArtifacts(evidence(), directory)).size).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
