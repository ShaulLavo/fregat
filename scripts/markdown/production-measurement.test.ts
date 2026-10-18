import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'

import type { ProductionTrial } from './production-analysis'
import {
  ordinaryProductionFindings,
  productionDigest,
  productionComparisons,
  productionPairFindings,
  productionResourcePlateau,
  validateRevisionReceipts,
} from './production-analysis'
import { updateCpuReceipts } from './production-cdp'
import { productionAssetKind } from '../../apps/web/test/factories/markdown-production-assets'
import { withProductionDeadline } from './production-deadline'
import {
  productionArrivalOffsets,
  productionBrowserWorkloads,
  productionTimingManifest,
  productionUpdates,
} from './production-workloads'
import { BENCHMARK_FAMILIES } from './workloads'

function hash(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

function trial(engine: ProductionTrial['engine']) {
  const observation = {
    text: 'Actual',
    elements: [{ tag: 'p', text: 'Actual', parents: [], attributes: {} }],
  }
  const output = { digest: hash(JSON.stringify(observation)), textBytes: 6, elementCount: 1 }
  const tick = {
    revision: 4,
    inputSha256: hash('Actual'),
    inputUtf16Units: 6,
    live: false,
    scheduled: 1,
    received: 1,
    committed: 2,
    parseCalls: 1,
    parserWallMs: 0.5,
    output,
    observedRevision: 4,
    painted: 3,
    paintedOutput: output,
  }
  const frame = { ...tick, ...observation }
  const longTasks: number[] = []
  return {
    workload: 'control',
    family: 'warm-completed',
    pair: 0,
    order: 'AB',
    engine,
    cache: 'warm',
    arrival: 'paced',
    navigationMs: 0,
    initializationMs: 0,
    environment: {
      userAgent: 'synthetic control',
      concurrency: 1,
      deviceScaleFactor: 1,
      viewport: { width: 1440, height: 900 },
      fontFamily: 'sans-serif',
      fonts: [],
    },
    receipt: {
      started: 1,
      ended: 4,
      processed: [tick],
      frames: [tick],
      final: tick,
      fullyReady: 4,
      fullyReadyOutput: output,
      skippedPaintRevisions: [],
      heldSyntax: null,
      longTasks,
      resources: [],
    },
    correctness: { frames: [frame], final: frame, fullyReady: 4, longTasks: [], resources: [] },
    freshCompleted: { ...frame },
    cpu: null,
    updateCpu: [],
    workers: null,
    network: null,
    timeline: null,
    resourceWindows: null,
  } satisfies ProductionTrial
}

test('matrix names all nine families with unique source-bound cells and frozen counts', () => {
  const matrix = productionBrowserWorkloads()
  expect(new Set(matrix.map((entry) => entry.family))).toEqual(new Set(BENCHMARK_FAMILIES))
  expect(new Set(matrix.map((entry) => entry.id)).size).toBe(matrix.length)
  const manifest = productionTimingManifest()
  expect(manifest.workloads).toHaveLength(matrix.length)
  expect(
    manifest.workloads.every(
      (entry) => /^[a-f0-9]{64}$/u.test(entry.sourceSha256) && entry.expectedInputUpdates > 0,
    ),
  ).toBe(true)
  expect(
    matrix.filter((entry) => entry.family === 'resources').map((entry) => entry.count),
  ).toEqual([20, 100, 500])
  expect(
    matrix.filter((entry) => entry.family === 'timeline-input').map((entry) => entry.count),
  ).toEqual([1, 20, 100, 500])
})

test('removed definition remains its own frozen revision, despite equal source to unresolved revision', () => {
  const removed = productionBrowserWorkloads().find(
    (entry) => entry.id === 'reference-invalidation-removed-definition',
  )
  expect(removed).toBeDefined()
  if (!removed) return
  expect(productionUpdates(removed)).toHaveLength(4)
})

test('arrival deadlines are pinned independently of render completion and enumerate burst groups', () => {
  const paced = productionBrowserWorkloads().find(
    (entry) => entry.id === 'streaming-replay-mixed-256-fixed-24',
  )
  const burst = productionBrowserWorkloads().find(
    (entry) => entry.arrival === 'burst-coalesced' && entry.sourceBytes >= 262144,
  )
  if (!paced || !burst) throw new TypeError('Schedule fixture missing')
  expect(productionArrivalOffsets(paced).slice(0, 3)).toEqual([0, 40, 80])
  expect(productionArrivalOffsets(burst).slice(30, 34)).toEqual([0, 0, 40, 40])
})

test('known-good paired receipts pass observation comparison only', () => {
  expect(productionPairFindings([trial('remark'), trial('tree-sitter')], ['Actual'])).toEqual([])
})

test('wrong source hash and missing completions fail without claimed counts', () => {
  const stale = trial('tree-sitter')
  stale.receipt.processed[0] = { ...stale.receipt.processed[0], inputSha256: 'b'.repeat(64) }
  expect(validateRevisionReceipts(stale, ['Actual']).join(' ')).toContain('independent replay')
  expect(validateRevisionReceipts(trial('remark'), ['A', 'Actual']).join(' ')).toContain(
    'revision completions',
  )
})

test('unchanged stale frame cannot satisfy completion with the correct source count', () => {
  const stale = trial('tree-sitter')
  stale.receipt.frames[0] = { ...stale.receipt.frames[0], observedRevision: 3 }
  expect(validateRevisionReceipts(stale, ['Actual']).join(' ')).toContain('expected projection')
})

test('missing paint fails, and cannot be hidden behind an empty skipped list', () => {
  const missing = trial('tree-sitter')
  missing.receipt.frames.splice(0)
  expect(validateRevisionReceipts(missing, ['Actual']).join(' ')).toContain('paint observations')
  expect(validateRevisionReceipts(missing, ['Actual']).join(' ')).toContain('enumerated')
})

test('wrong painted projection and changed final output fail despite matching input counts', () => {
  const candidate = trial('tree-sitter')
  candidate.correctness.final.text = 'Changed destination'
  candidate.receipt.frames[0] = {
    ...candidate.receipt.frames[0],
    paintedOutput: { digest: 'c'.repeat(64), textBytes: 6, elementCount: 1 },
  }
  expect(productionPairFindings([trial('remark'), candidate], ['Actual']).join(' ')).toContain(
    'projections differ',
  )
})

test('CPU requires same-thread thread ticks and never substitutes wall timestamps', () => {
  const start = { name: 'markdown-update-7-start', pid: 1, tid: 2, ts: 1000, tts: 30 }
  const commit = { name: 'markdown-update-7-commit', pid: 1, tid: 2, ts: 21000, tts: 1030 }
  expect(updateCpuReceipts([start, commit])).toEqual([{ revision: 7, mainThreadCpuMs: 1 }])
  expect(updateCpuReceipts([{ ...start, tts: undefined }, commit])).toEqual([])
  expect(updateCpuReceipts([start, { ...commit, tid: 3 }])).toEqual([])
  expect(updateCpuReceipts([start, { ...commit, tts: 1 }])).toEqual([])
})

test('one paired trial and absent CPU remain inconclusive, not a default pass', () => {
  const entry = { ...productionBrowserWorkloads()[0], id: 'control' }
  const comparisons = productionComparisons([trial('remark'), trial('tree-sitter')], [entry])
  expect(comparisons.every((comparison) => comparison.status === 'inconclusive')).toBe(true)
  expect(
    comparisons.find((comparison) => comparison.metric === 'streamCpu')?.independentTrials,
  ).toBe(0)
})

test('20 independent observed pairs may clear a paired bound, without qualifying the whole run', () => {
  const trials = Array.from({ length: 20 }, (_, pair) => [
    { ...trial('remark'), pair },
    { ...trial('tree-sitter'), pair },
  ]).flat()
  const entry = { ...productionBrowserWorkloads()[0], id: 'control' }
  const comparisons = productionComparisons(trials, [entry])
  expect(comparisons.find((comparison) => comparison.metric === 'updateP95')?.status).toBe('passed')
  expect(comparisons.find((comparison) => comparison.metric === 'streamCpu')?.status).toBe(
    'inconclusive',
  )
})

test('ordinary frozen budgets reject missing held syntax, CPU, and oversized long tasks', () => {
  const workload = productionBrowserWorkloads().find((entry) => entry.scheduleUnits === 24)
  if (!workload) throw new TypeError('Ordinary fixture missing')
  const sample = { ...trial('remark'), workload: workload.id }
  sample.receipt.longTasks.push(51)
  const findings = ordinaryProductionFindings([sample], [workload]).join(' ')
  expect(findings).toContain('held-syntax')
  expect(findings).toContain('thread CPU is missing')
  expect(findings).toContain('long task')
})

test('absent lifecycle observations cannot certify a memory plateau', () => {
  expect(productionResourcePlateau(null).status).toBe('INCONCLUSIVE')
  expect(productionResourcePlateau([]).status).toBe('INCONCLUSIVE')
})

test('shared production digest binds text and binary build artifacts identically', () => {
  expect(productionDigest('Actual')).toBe(hash('Actual'))
  expect(productionDigest(Buffer.from('Actual'))).toBe(hash('Actual'))
})

test('streamed final must equal a fresh completed message', () => {
  const candidate = trial('tree-sitter')
  candidate.freshCompleted = { ...candidate.freshCompleted, text: 'A stale completed message' }
  expect(productionPairFindings([trial('remark'), candidate], ['Actual']).join(' ')).toContain(
    'fresh completed message',
  )
})

test('lifecycle controls reject retained nodes, live growth, and non-reused native reservation', () => {
  const window = {
    cycles: 20,
    elapsedMs: 1,
    parserWasmReservedBeforeBytes: 100,
    parserWasmReservedAfterBytes: 100,
    jsHeapUsedBeforeBytes: 100,
    jsHeapUsedAfterBytes: 100,
    jsHeapReservedBeforeBytes: 200,
    jsHeapReservedAfterBytes: 200,
    backingStorageBeforeBytes: 0,
    backingStorageAfterBytes: 0,
    queryObserversBefore: 0,
    queryObserversAfter: 0,
    retainedMessageNodes: 0,
    simultaneousMessages: 4,
    peakWasmReservedBytes: 100,
    peakMessageNodes: 4,
  }
  const steady = Array.from({ length: 4 }, () => ({ ...window }))
  expect(productionResourcePlateau(steady).status).toBe('INCONCLUSIVE')
  expect(
    productionResourcePlateau(
      steady.map((entry, index) => ({
        ...entry,
        jsHeapUsedAfterBytes: 100 + index,
      })),
    ).status,
  ).toBe('NOT VERIFIED')
  expect(
    productionResourcePlateau(
      steady.map((entry) => ({
        ...entry,
        retainedMessageNodes: 1,
      })),
    ).status,
  ).toBe('NOT VERIFIED')
  expect(
    productionResourcePlateau(
      steady.map((entry, index) => ({
        ...entry,
        peakWasmReservedBytes: 100 + index,
      })),
    ).status,
  ).toBe('NOT VERIFIED')
})

test('hashed production WASM requests keep runtime, grammar and resolver attribution', () => {
  expect(productionAssetKind('https://fixture.test/assets/web-tree-sitter-Ab3_def.wasm')).toBe(
    'host',
  )
  expect(productionAssetKind('https://fixture.test/assets/tree-sitter-markdown-Ab3_def.wasm')).toBe(
    'grammar',
  )
  expect(productionAssetKind('https://fixture.test/assets/tree-sitter-md-Ab3_def.wasm')).toBe(
    'resolver',
  )
})

test('a missing observation hits its bounded deadline and cannot return a receipt', async () => {
  await expect(
    withProductionDeadline(new Promise<never>(() => undefined), 'control', 1),
  ).rejects.toThrow('control')
  await expect(withProductionDeadline(Promise.resolve('observed'), 'control', 100)).resolves.toBe(
    'observed',
  )
})

test('extra CPU samples cannot hide a missing input revision or held-syntax cost', () => {
  const workload = productionBrowserWorkloads().find((entry) => entry.scheduleUnits === 24)
  if (!workload) throw new TypeError('Ordinary fixture missing')
  const sample: ProductionTrial = { ...trial('remark'), workload: workload.id }
  const frame = sample.receipt.final
  const withHeld: ProductionTrial = {
    ...sample,
    receipt: {
      ...sample.receipt,
      heldSyntax: {
        held: { ...frame, revision: 5 },
        released: { ...frame, revision: 6 },
        holdMs: 80,
      },
    },
    updateCpu: [
      { revision: 5, mainThreadCpuMs: 1 },
      { revision: 6, mainThreadCpuMs: 1 },
    ],
  }
  expect(ordinaryProductionFindings([withHeld], [workload]).join(' ')).toContain(
    'thread CPU is missing',
  )
  const missingRelease: ProductionTrial = {
    ...withHeld,
    updateCpu: [
      { revision: 4, mainThreadCpuMs: 1 },
      { revision: 5, mainThreadCpuMs: 1 },
    ],
  }
  expect(ordinaryProductionFindings([missingRelease], [workload]).join(' ')).toContain(
    'thread CPU is missing',
  )
})
