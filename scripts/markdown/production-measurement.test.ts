import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'

import { oracleIdentity } from './production-oracle'
import type { ProductionTrial } from './production-analysis'
import {
  ordinaryProductionFindings,
  productionDigest,
  productionComparisons,
  productionMetricObservation,
  productionFamilyCoverage,
  productionPairFindings,
  productionTrialSummary,
  productionResourcePlateau,
  validateRevisionReceipts,
} from './production-analysis'
import {
  updateCpuReceipts,
  workerCpuReceipts,
  streamMainThreadCpu,
  completedWorkerAlias,
  reconcileProductionNetworkRequests,
  handleWorkerEvent,
  isSustainedProductStream,
  type ProductionNetworkRequest,
} from './production-cdp'
import {
  encodeProductionInputs,
  replayProductionOracle,
  replayProductionTiming,
  validateProductionBuildIdentity,
  productionTrialRecords,
  writeProductionTrials,
} from './production-browser'
import { productionAssetKind } from '../../apps/web/test/factories/markdown-production-assets'
import { withProductionDeadline } from './production-deadline'
import {
  productionArrivalOffsets,
  productionBrowserWorkloads,
  productionTimingManifest,
  productionUpdates,
} from './production-workloads'
import { BENCHMARK_FAMILIES, BENCHMARK_PROFILES } from './workloads'
import { pairedConfidence } from './paired-native'

function hash(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

function trial(engine: ProductionTrial['engine']) {
  const observation = {
    text: 'Actual',
    elements: [{ tag: 'p', text: 'Actual', parents: [], attributes: {} }],
  }
  const output = {
    digest: hash(JSON.stringify(observation)),
    textBytes: 6,
    elementCount: 1,
  }
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
    correctness: {
      artifact: {
        path: 'unit-oracle.jsonl',
        sha256: hash('unit oracle descriptor'),
        byteLength: 1,
        recordCount: 3,
      },
      frames: [oracleIdentity(frame)],
      final: oracleIdentity(frame),
      fullyReady: 4,
      longTasks: [],
      resources: [],
    },
    freshCompleted: oracleIdentity(frame),
    cpu: null,
    updateCpu: [],
    workers: null,
    network: null,
    workerCpu: null,
    streamMainThreadCpuMs: null,
    timeline: null,
    resourceWindows: null,
    resourceControlWindows: null,
  } satisfies ProductionTrial
}

test('matrix names all nine families with unique source-bound cells and frozen counts', () => {
  const matrix = productionBrowserWorkloads()
  expect(new Set(matrix.map((entry) => entry.family))).toEqual(new Set(BENCHMARK_FAMILIES))
  expect(new Set(matrix.map((entry) => entry.id)).size).toBe(matrix.length)
  const manifest = productionTimingManifest()
  expect(manifest.workloads).toHaveLength(matrix.length)
  expect(matrix).toHaveLength(86)
  expect(BENCHMARK_PROFILES.promotion).toMatchObject({ trials: 20, warmups: 3 })
  expect(matrix.length * (20 + 3) * 2).toBe(3956)
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

test('production input transport encodes only exact UTF16 prefixes and preserves revision order', () => {
  const source = 'A😀B\ud800tail'
  const inputs = ['', 'A', 'A\ud83d', 'A😀', 'revision', 'X😀', source, '', source]
  expect(encodeProductionInputs(source, inputs)).toEqual([
    0,
    1,
    2,
    3,
    'revision',
    'X😀',
    source.length,
    0,
    source.length,
  ])
})

async function replayBoundary(
  source: string,
  inputs: readonly string[],
  arrivalOffsetsMs = inputs.map((_, index) => index * 18),
  arrival = 'paced',
) {
  const encodedInputs = JSON.parse(JSON.stringify(encodeProductionInputs(source, inputs)))
  const expected = inputs
    .concat([source])
    .map((input) => ({ digest: hash(input), textBytes: input.length, elementCount: 1 }))
  const oracleCalls: unknown[] = []
  const timingCalls: unknown[] = []
  const record = { kind: 'fixture' }
  const window = {
    markdownOracleFrame: (value: unknown) => {
      oracleCalls.push(value)
    },
    markdownProductionProbe: {
      streamOracle: (receivedSource: string, chunks: string[], sink: (value: unknown) => void) => {
        expect(receivedSource).toBe(source)
        expect(chunks).toEqual(inputs)
        sink(record)
      },
      time: (
        receivedSource: string,
        chunks: string[],
        options: {
          arrival: string
          arrivalOffsetsMs: number[]
          expected: unknown
          heldSyntax: unknown
        },
      ) => {
        expect(receivedSource).toBe(source)
        expect(chunks).toEqual(inputs)
        expect(chunks.concat([receivedSource])).toEqual(inputs.concat([source]))
        expect(options.arrival).toBe(arrival)
        expect(options.arrivalOffsetsMs).toBe(arrivalOffsetsMs)
        expect(options.expected).toBe(expected)
        expect(options.heldSyntax).toEqual({
          held: 'Stable\n\n## ',
          released: 'Stable\n\n## Ready',
        })
        timingCalls.push(options)
      },
    },
  }
  const payload = { source, encodedInputs, arrival, arrivalOffsetsMs, expected }
  await runInNewContext(`(${replayProductionOracle.toString()})(payload)`, { window, payload })
  await runInNewContext(`(${replayProductionTiming.toString()})(payload)`, { window, payload })
  expect(oracleCalls).toEqual([record])
  expect(timingCalls).toHaveLength(1)
}

test('production input transport callbacks preserve empty, surrogate and nonprefix revisions and completed duplication', async () => {
  const source = 'A😀B\ud800tail'
  await replayBoundary(source, ['', 'A', 'A\ud83d', 'A😀', 'revision', 'X😀', source, '', source])
  await replayBoundary(source, [])
})

test('production input transport keeps fixed, provider-paced and reference builder sequences authoritative', async () => {
  const selected = productionBrowserWorkloads().filter(
    (entry) =>
      entry.id === 'streaming-replay-mixed-256-fixed-24' ||
      entry.scheduleId === 'provider-paced-v1' ||
      entry.family === 'reference-invalidation',
  )
  expect(selected.some((entry) => entry.family === 'reference-invalidation')).toBe(true)
  expect(selected.some((entry) => entry.scheduleId === 'provider-paced-v1')).toBe(true)
  for (const entry of selected)
    await replayBoundary(
      entry.source,
      productionUpdates(entry),
      productionArrivalOffsets(entry),
      entry.arrival,
    )
  const burst = selected[0]
  if (!burst) throw new TypeError('Schedule fixture missing')
  const entry = { ...burst, arrival: 'burst-coalesced' as const }
  await replayBoundary(
    entry.source,
    productionUpdates(entry),
    productionArrivalOffsets(entry),
    entry.arrival,
  )
})

test('production input transport sends one source and linear offsets for a bounded prefix schedule', () => {
  const source = 'x'.repeat(4096)
  const inputs = Array.from({ length: 512 }, (_, index) => source.slice(0, (index + 1) * 8))
  const encodedInputs = encodeProductionInputs(source, inputs)
  expect(encodedInputs.every((input) => typeof input === 'number')).toBe(true)
  expect(Buffer.byteLength(JSON.stringify({ source, encodedInputs }))).toBeLessThan(8192)
  expect(inputs).toHaveLength(512)
})

test.each(['success', 'failure', 'status'])(
  'production CLI finalization flushes pipes and terminates owned handles on %s',
  (mode) => {
    const module = new URL('./production-browser.ts', import.meta.url).href
    const script = `
    import { finalizeProductionCli } from ${JSON.stringify(module)}
    await finalizeProductionCli(async () => {
      process.stdout.write('x'.repeat(524288))
      process.stderr.write('y'.repeat(524288))
      setInterval(() => {}, 1000)
      if (${JSON.stringify(mode)} === 'failure') throw new TypeError('fixture failure')
      if (${JSON.stringify(mode)} === 'status') process.exitCode = 3
    })
  `
    const child = spawnSync('bun', ['-e', script], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 2097152,
    })
    expect(child.error).toBeUndefined()
    expect(child.signal).toBeNull()
    const expectedStatus = mode === 'status' ? 3 : Number(mode === 'failure')
    expect(child.status).toBe(expectedStatus)
    expect(child.stdout.length).toBe(524288)
    expect(hash(child.stdout)).toBe(hash('x'.repeat(524288)))
    expect(hash(child.stderr.slice(0, 524288))).toBe(hash('y'.repeat(524288)))
    if (mode === 'failure') expect(child.stderr).toContain('fixture failure')
    else expect(child.stderr.length).toBe(524288)
  },
)

test('production browser import leaves the host process and its exit status under caller control', () => {
  const module = new URL('./production-browser.ts', import.meta.url).href
  const child = spawnSync(
    'bun',
    [
      '-e',
      `
    const before = process.eventNames().map(String).sort().join(',')
    await import(${JSON.stringify(module)})
    if (process.eventNames().map(String).sort().join(',') !== before) throw new TypeError('Import installed process hooks')
    process.stdout.write('import-complete')
    process.exitCode = 7
  `,
    ],
    { encoding: 'utf8', timeout: 5000 },
  )
  expect(child.error).toBeUndefined()
  expect(child.status).toBe(7)
  expect(child.stdout).toBe('import-complete')
  expect(child.stderr).toBe('')
})

test('known-good paired receipts pass observation comparison only', () => {
  expect(productionPairFindings([trial('remark'), trial('tree-sitter')], ['Actual'])).toEqual([])
})

test('wrong source hash and missing completions fail without claimed counts', () => {
  const stale = trial('tree-sitter')
  stale.receipt.processed[0] = {
    ...stale.receipt.processed[0],
    inputSha256: 'b'.repeat(64),
  }
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
  candidate.correctness = {
    ...candidate.correctness,
    final: {
      ...candidate.correctness.final,
      paintedOutput: {
        ...candidate.correctness.final.paintedOutput,
        digest: hash('Changed destination'),
      },
    },
  }
  candidate.receipt.frames[0] = {
    ...candidate.receipt.frames[0],
    paintedOutput: { digest: 'c'.repeat(64), textBytes: 6, elementCount: 1 },
  }
  expect(productionPairFindings([trial('remark'), candidate], ['Actual']).join(' ')).toContain(
    'projections differ',
  )
})

test('CPU requires same-thread thread ticks and never substitutes wall timestamps', () => {
  const start = {
    name: 'markdown-update-7-start',
    pid: 1,
    tid: 2,
    ts: 1000,
    tts: 30,
  }
  const commit = {
    name: 'markdown-update-7-commit',
    pid: 1,
    tid: 2,
    ts: 21000,
    tts: 1030,
  }
  expect(updateCpuReceipts([start, commit])).toEqual([{ revision: 7, mainThreadCpuMs: 1 }])
  expect(updateCpuReceipts([{ ...start, tts: undefined }, commit])).toEqual([])
  expect(updateCpuReceipts([start, { ...commit, tid: 3 }])).toEqual([])
  expect(updateCpuReceipts([start, { ...commit, tts: 1 }])).toEqual([])
})

test('one paired trial and absent CPU remain inconclusive, not a default pass', () => {
  const entry = { ...productionBrowserWorkloads()[0], id: 'control' }
  const comparisons = productionComparisons(
    [trial('remark'), trial('tree-sitter')].map(productionMetricObservation),
    [entry],
  )
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
  const comparisons = productionComparisons(trials.map(productionMetricObservation), [entry])
  expect(comparisons.find((comparison) => comparison.metric === 'updateP95')?.status).toBe('passed')
  expect(comparisons.find((comparison) => comparison.metric === 'streamCpu')?.status).toBe(
    'inconclusive',
  )
})

test('selected incomplete stream CPU pairs remain excluded from a passing population', () => {
  const completeWorker = {
    targetId: 'worker',
    url: 'https://fixture.test/shiki.worker.js',
    threadId: 3,
    pid: 1,
    cpuMs: 1,
    coveredCpuMs: 1,
    taskCount: 1,
    nestedTaskCount: 0,
    incompleteTaskCount: 0,
    boundaryCrossingTaskCount: 0,
    measurement: 'complete' as const,
    reason: null,
  }
  const trials = Array.from({ length: 21 }, (_, pair) =>
    (['remark', 'tree-sitter'] as const).map((engine) => ({
      ...trial(engine),
      pair,
      workload: 'control',
      workers: { created: 1, active: 1 },
      streamMainThreadCpuMs: 100,
      workerCpu: [
        pair === 20 && engine === 'tree-sitter'
          ? {
              ...completeWorker,
              cpuMs: null,
              measurement: 'incomplete' as const,
              incompleteTaskCount: 1,
              reason: 'A worker task lacked complete thread CPU data.',
            }
          : completeWorker,
      ],
    })),
  ).flat()
  const comparison = productionComparisons(trials.map(productionMetricObservation), [
    { ...productionBrowserWorkloads()[0], id: 'control' },
  ]).find((entry) => entry.metric === 'streamCpu')
  expect(comparison).toMatchObject({
    status: 'inconclusive',
    independentTrials: 20,
    selectedPairs: 21,
    excludedPairs: [
      {
        pair: 20,
        engine: 'tree-sitter',
        reason:
          'Dedicated-worker CPU is incomplete: A worker task lacked complete thread CPU data.',
      },
    ],
  })
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
  candidate.freshCompleted = {
    ...candidate.freshCompleted,
    paintedOutput: {
      ...candidate.freshCompleted.paintedOutput,
      digest: hash('A stale completed message'),
    },
  }
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

test.each(['tree-sitter-markdown-chat.wasm', 'tree-sitter-markdown-chat-Ab3_def.wasm'])(
  'CHAT grammar URL %s retains grammar attribution with query strings',
  (filename) => {
    expect(productionAssetKind(`https://fixture.test/assets/${filename}?v=fixture&wasm=1`)).toBe(
      'grammar',
    )
  },
)

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

const worker = {
  targetId: 'worker-1',
  url: 'https://fixture.test/shiki.worker.js',
  attachedAtMs: 1,
  detachedAtMs: null,
}
const streamStart = {
  name: 'markdown-stream-start',
  pid: 1,
  tid: 2,
  ts: 1000,
  tts: 300,
}
const streamEnd = {
  name: 'markdown-stream-end',
  pid: 1,
  tid: 2,
  ts: 5000,
  tts: 2300,
}
const workerMapping = {
  name: 'TracingSessionIdForWorker',
  pid: 1,
  tid: 3,
  args: { data: { workerId: worker.targetId, workerThreadId: 3 } },
}
const workerTask = {
  name: 'RunTask',
  ph: 'X',
  pid: 1,
  tid: 3,
  ts: 2000,
  dur: 1000,
  tdur: 600,
}

test('stream CPU uses main and dedicated worker thread ticks over the same explicit interval', () => {
  const events = [streamStart, streamEnd, workerMapping, workerTask]
  expect(streamMainThreadCpu(events)).toBe(2)
  expect(workerCpuReceipts(events, [worker])[0]).toMatchObject({
    cpuMs: 0.6,
    coveredCpuMs: 0.6,
    taskCount: 1,
    incompleteTaskCount: 0,
    boundaryCrossingTaskCount: 0,
    measurement: 'complete',
  })
  expect(streamMainThreadCpu([streamStart, { ...streamEnd, tts: undefined }])).toBeNull()
  expect(streamMainThreadCpu([streamStart, { ...streamEnd, tid: 4 }])).toBeNull()
})

test('worker CPU stays incomplete for missing ticks, absent mappings and crossing task boundaries', () => {
  const events: unknown[] = [streamStart, streamEnd, workerMapping]
  for (const task of [
    { ...workerTask, tdur: undefined },
    { ...workerTask, ts: undefined },
    { ...workerTask, dur: Number.NaN },
    { ...workerTask, ph: 'B' },
    { ...workerTask, ts: 500 },
    { ...workerTask, dur: 4000 },
  ])
    expect(workerCpuReceipts(events.concat([task]), [worker])[0].measurement).toBe('incomplete')
  expect(workerCpuReceipts(events.concat([{ ...workerTask, ts: 500 }]), [worker])[0]).toMatchObject(
    {
      coveredCpuMs: 0,
      taskCount: 1,
      incompleteTaskCount: 1,
      boundaryCrossingTaskCount: 1,
    },
  )
  expect(
    workerCpuReceipts(events.concat([{ ...workerTask, tdur: undefined }]), [worker])[0],
  ).toMatchObject({
    coveredCpuMs: 0,
    taskCount: 1,
    incompleteTaskCount: 1,
    boundaryCrossingTaskCount: 0,
  })
  expect(workerCpuReceipts([streamStart, streamEnd], [worker])[0].measurement).toBe('incomplete')
  expect(workerCpuReceipts([workerMapping], [worker])[0].measurement).toBe('incomplete')
  expect(workerCpuReceipts(events, [worker])[0]).toMatchObject({
    measurement: 'incomplete',
    cpuMs: null,
    coveredCpuMs: null,
    taskCount: 0,
    incompleteTaskCount: 0,
    boundaryCrossingTaskCount: 0,
  })
  expect(workerCpuReceipts(events.concat([{ ...workerTask, ts: 6000 }]), [worker])[0].cpuMs).toBe(0)
  const replacement = {
    ...workerMapping,
    args: { data: { workerId: 'replacement', workerThreadId: 3 } },
  }
  expect(workerCpuReceipts(events.concat([replacement]), [worker])[0].measurement).toBe(
    'incomplete',
  )
})

function request(target: 'page' | 'worker'): ProductionNetworkRequest {
  return {
    id: worker.targetId,
    url: worker.url,
    type: 'Script',
    fromCache: false,
    transferredBytes: null,
    completionEncodedBytes: null,
    dataReceivedBytes: null,
    transferScope: 'full-request',
    phase: 'navigation',
    kind: 'javascript',
    failure: null,
    target,
    workerTargetId: target === 'worker' ? worker.targetId : null,
    resolvedByWorkerRequestId: null,
  }
}

test('a worker alias requires a completed actual transfer and worker target identity', () => {
  const page = request('page')
  const incomplete = request('worker')
  expect(completedWorkerAlias(page, incomplete)).toBeNull()
  expect(completedWorkerAlias(page, { ...incomplete, transferredBytes: 123 })).toMatchObject({
    resolvedByWorkerRequestId: worker.targetId,
    transferredBytes: null,
  })
  expect(
    completedWorkerAlias(page, {
      ...incomplete,
      id: 'other',
      transferredBytes: 123,
    }),
  ).toBeNull()
  expect(
    completedWorkerAlias(page, {
      ...incomplete,
      transferredBytes: 123,
      failure: 'aborted',
    }),
  ).toBeNull()
  expect(
    completedWorkerAlias(page, {
      ...incomplete,
      transferredBytes: 123,
      workerTargetId: null,
    }),
  ).toBeNull()
  expect(
    completedWorkerAlias(page, {
      ...incomplete,
      transferredBytes: 123,
      kind: 'other',
    }),
  ).toBeNull()
  expect(
    completedWorkerAlias(
      { ...page, transferredBytes: 456 },
      { ...incomplete, transferredBytes: 123 },
    ),
  ).toBeNull()
  expect(
    completedWorkerAlias(
      { ...page, url: 'https://fixture.test/other.js' },
      { ...incomplete, transferredBytes: 123 },
    ),
  ).toBeNull()
})

test('worker script transfers require real network events and preserve unknown byte counts', () => {
  const pageRequest = request('page')
  const pages = new Map([[pageRequest.id, pageRequest]])
  const observed = new Map<string, ProductionNetworkRequest>()
  const aliases: ProductionNetworkRequest[] = []
  const dispatch = (method: string, params: Record<string, unknown>) =>
    handleWorkerEvent(
      worker,
      method,
      params,
      observed,
      pages,
      (targetId, entry) => observed.set(`${targetId}:${entry.id}`, entry),
      (entry) => aliases.push(entry),
      'measurement',
    )
  const event = (id: string, bytes: number) =>
    dispatch('Network.loadingFinished', { requestId: id, encodedDataLength: bytes })
  expect(observed.size).toBe(0)
  event('unobserved-request', 123)
  expect(observed.size).toBe(0)
  dispatch('Network.dataReceived', { requestId: worker.targetId, dataLength: 500000 })
  dispatch('Network.dataReceived', { requestId: worker.targetId, dataLength: 294046 })
  const bodyOnly = observed.get(`${worker.targetId}:${worker.targetId}`)
  expect(bodyOnly).toMatchObject({
    phase: 'navigation',
    transferredBytes: null,
    dataReceivedBytes: 794046,
    target: 'worker',
  })
  expect(bodyOnly && completedWorkerAlias(pageRequest, bodyOnly)).toBeNull()
  event(worker.targetId, -1)
  const unknown = observed.get(`${worker.targetId}:${worker.targetId}`)
  expect(unknown).toMatchObject({
    phase: 'navigation',
    transferredBytes: null,
    dataReceivedBytes: 794046,
    target: 'worker',
  })
  expect(unknown && completedWorkerAlias(pageRequest, unknown)).toBeNull()
  event(worker.targetId, 123)
  expect(observed.get(`${worker.targetId}:${worker.targetId}`)).toMatchObject({
    phase: 'navigation',
    transferredBytes: null,
    dataReceivedBytes: 794046,
    completionEncodedBytes: 123,
    transferScope: 'worker-bootstrap-completion',
  })
  expect(aliases).toHaveLength(2)
  expect(completedWorkerAlias(pageRequest, aliases[1])).toBeNull()
  dispatch('Network.requestWillBeSent', {
    requestId: worker.targetId,
    request: { url: worker.url },
    type: 'Script',
  })
  event(worker.targetId, 794046)
  expect(observed.get(`${worker.targetId}:${worker.targetId}`)).toMatchObject({
    transferredBytes: 794046,
    dataReceivedBytes: 794046,
    completionEncodedBytes: 794046,
    transferScope: 'full-request',
  })
  expect(completedWorkerAlias(pageRequest, aliases[2])).not.toBeNull()
})

test('payload summaries retain bootstrap body bytes without inventing transfer bytes', () => {
  const summary = productionTrialSummary({
    ...trial('tree-sitter'),
    network: [
      {
        ...request('worker'),
        dataReceivedBytes: 794046,
        completionEncodedBytes: 162,
        transferScope: 'worker-bootstrap-completion',
      },
    ],
  }).transferred
  expect(summary?.find((entry) => entry.kind === 'javascript')).toMatchObject({
    requests: 1,
    transferredBytes: null,
    dataReceivedBytes: 794046,
    dataReceivedRequestCount: 1,
    incompleteRequests: 1,
  })
})

test('payload summaries charge one transfer for complete page and worker copies', () => {
  const page = {
    ...request('page'),
    transferredBytes: 794489,
    completionEncodedBytes: 794489,
  }
  const workerCopy = {
    ...request('worker'),
    transferredBytes: 794489,
    completionEncodedBytes: 794489,
  }
  const summary = productionTrialSummary({
    ...trial('tree-sitter'),
    network: [page, workerCopy],
  }).transferred
  expect(summary?.find((entry) => entry.kind === 'javascript')).toMatchObject({
    requests: 1,
    transferredBytes: 794489,
    incompleteRequests: 0,
  })
  expect(completedWorkerAlias(page, workerCopy)).toMatchObject({
    resolvedByWorkerRequestId: workerCopy.id,
  })
})

test('base and CHAT grammar totals count encoded, decoded and transfer receipts once across page and worker aliases', () => {
  const urls = [
    'https://fixture.test/assets/tree-sitter-markdown.wasm?v=fixture',
    'https://fixture.test/assets/tree-sitter-markdown-chat-Ab3_def.wasm?v=fixture',
  ]
  const network: ProductionNetworkRequest[] = urls.flatMap((url, index) => {
    const page = {
      ...request('page'),
      id: `grammar-${index}`,
      url,
      kind: productionAssetKind(url),
      workerTargetId: worker.targetId,
      completionEncodedBytes: [101, 211][index],
      dataReceivedBytes: [1000, 2030][index],
      transferredBytes: [121, 241][index],
    }
    return [page, { ...page, target: 'worker' }]
  })
  const receipts = reconcileProductionNetworkRequests(network).filter(
    (entry) => entry.resolvedByWorkerRequestId === null,
  )
  expect(receipts).toHaveLength(2)
  expect(receipts.map((entry) => entry.completionEncodedBytes)).toEqual([101, 211])
  expect(receipts.reduce((sum, entry) => sum + (entry.completionEncodedBytes ?? 0), 0)).toBe(312)
  const summary = productionTrialSummary({ ...trial('tree-sitter'), network }).transferred
  expect(summary?.find((entry) => entry.kind === 'grammar')).toEqual({
    kind: 'grammar',
    requests: 2,
    cacheHits: 0,
    transferredBytes: 362,
    dataReceivedBytes: 3030,
    dataReceivedRequestCount: 2,
    incompleteRequests: 0,
  })
})

test('payload summaries expose conflicting page and worker receipts as incomplete', () => {
  const page = { ...request('page'), transferredBytes: 794489 }
  const workerCopy = { ...request('worker'), transferredBytes: 794490 }
  const summary = productionTrialSummary({
    ...trial('tree-sitter'),
    network: [page, workerCopy],
  }).transferred
  expect(summary?.find((entry) => entry.kind === 'javascript')).toMatchObject({
    requests: 1,
    transferredBytes: null,
    incompleteRequests: 1,
  })
})

test('only sustained product event streams are distinguished from incomplete finite assets', () => {
  expect(
    isSustainedProductStream({
      type: 'EventSource',
      url: 'https://fixture.test/settings/events',
    }),
  ).toBe(true)
  expect(isSustainedProductStream({ type: 'Script', url: worker.url })).toBe(false)
  expect(
    isSustainedProductStream({
      type: 'Fetch',
      url: 'https://fixture.test/settings/events',
    }),
  ).toBe(false)
})

test('served artifact bindings reject changed source, pins, budget, manifest and an unstable build', () => {
  const source = {
    revision: 'commit',
    trackedDiffSha256: 'diff',
    sourceClosureSha256: 'closure',
    lockfileSha256: 'lock',
  }
  const build = {
    sourceBefore: source,
    sourceAfter: source,
    sourceConsistent: true,
    budgetSha256: 'budget',
    artifactManifestSha256: productionDigest('{}'),
    artifacts: [],
  }
  expect(validateProductionBuildIdentity(build, '{}', source, 'budget').revision).toBe('commit')
  expect(() =>
    validateProductionBuildIdentity(
      build,
      '{}',
      { ...source, sourceClosureSha256: 'changed' },
      'budget',
    ),
  ).toThrow('source closure')
  expect(() =>
    validateProductionBuildIdentity(build, '{}', { ...source, revision: 'changed' }, 'budget'),
  ).toThrow('revision')
  expect(() =>
    validateProductionBuildIdentity(
      build,
      '{}',
      { ...source, lockfileSha256: 'changed' },
      'budget',
    ),
  ).toThrow('pins')
  expect(() => validateProductionBuildIdentity(build, '{}', source, 'changed')).toThrow('budget')
  expect(() => validateProductionBuildIdentity(build, 'changed', source, 'budget')).toThrow(
    'manifest',
  )
  expect(() =>
    validateProductionBuildIdentity({ ...build, sourceConsistent: false }, '{}', source, 'budget'),
  ).toThrow('changed during')
})

test('only the predeclared stable cache tail with matching stable control can observe a plateau', () => {
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
  const windows = Array.from({ length: 6 }, () => ({ ...window }))
  const controls = windows.map(
    ({
      cycles,
      elapsedMs,
      jsHeapUsedBeforeBytes,
      jsHeapUsedAfterBytes,
      backingStorageBeforeBytes,
      backingStorageAfterBytes,
    }) => ({
      cycles,
      elapsedMs,
      jsHeapUsedBeforeBytes,
      jsHeapUsedAfterBytes,
      backingStorageBeforeBytes,
      backingStorageAfterBytes,
    }),
  )
  expect(productionResourcePlateau(windows, controls).status).toBe('OBSERVED_PLATEAU')
  expect(
    productionResourcePlateau(
      windows,
      controls.map((entry, index) => (index < 2 ? { ...entry, cycles: 0 } : entry)),
    ).status,
  ).toBe('INCONCLUSIVE')
  expect(productionResourcePlateau(windows, null).status).toBe('INCONCLUSIVE')
  expect(
    productionResourcePlateau(
      windows,
      controls.map((entry, index) => ({
        ...entry,
        jsHeapUsedAfterBytes: 100 + index,
      })),
    ).status,
  ).toBe('INCONCLUSIVE')
  expect(
    productionResourcePlateau(
      windows.map((entry, index) => ({
        ...entry,
        jsHeapUsedAfterBytes: 100 + index,
      })),
      controls.map((entry, index) => ({
        ...entry,
        jsHeapUsedAfterBytes: 200 + index - (index === 3 ? 2 : 0),
      })),
    ),
  ).toMatchObject({
    status: 'INCONCLUSIVE',
    reason: expect.stringContaining('no-op control'),
  })
  expect(
    productionResourcePlateau(
      windows.map((entry, index) => ({
        ...entry,
        jsHeapUsedAfterBytes: 100 + index,
      })),
      controls,
    ).status,
  ).toBe('NOT VERIFIED')
  expect(
    productionResourcePlateau(
      windows.map((entry) => ({ ...entry, cycles: 0 })),
      controls,
    ).status,
  ).toBe('INCONCLUSIVE')
  expect(
    productionResourcePlateau(
      windows.map((entry) => ({ ...entry, peakWasmReservedBytes: null })),
      controls,
    ).status,
  ).toBe('INCONCLUSIVE')
  expect(
    productionResourcePlateau(
      windows.map((entry) => ({ ...entry, peakWasmReservedBytes: null })),
      controls,
      false,
    ).status,
  ).toBe('OBSERVED_PLATEAU')
})

test('a supported fence worker contributes to combined CPU instead of forcing null', () => {
  const sample: ProductionTrial = {
    ...trial('remark'),
    workers: { created: 1, active: 1 },
    streamMainThreadCpuMs: 2,
    workerCpu: workerCpuReceipts([streamStart, streamEnd, workerMapping, workerTask], [worker]),
  }
  expect(productionTrialSummary(sample).streamCombinedCpuMs).toBe(2.6)
  expect(
    productionTrialSummary({
      ...sample,
      workerCpu: workerCpuReceipts([streamStart, streamEnd], [worker]),
    }).streamCombinedCpuMs,
  ).toBeNull()
  expect(
    productionTrialSummary({ ...sample, workers: { created: 2, active: 1 } }).streamCombinedCpuMs,
  ).toBeNull()
})

test('artifact streaming production preserves warmups, execution order and all raw fields', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'production-artifacts-'))
  try {
    const workload = { ...productionBrowserWorkloads()[0], id: 'control', source: 'Actual' }
    const failures: string[] = []
    const calls: string[] = []
    const records = productionTrialRecords({
      workloads: [workload],
      trials: 2,
      warmups: 1,
      failures,
      capture: async ({ pair, order, engine }) => {
        const temporary = (await readdir(output)).find((name) =>
          name.startsWith('.timing-artifact-'),
        )
        if (!temporary) throw new TypeError('Missing owned output stream')
        const written = await readFile(path.join(output, temporary, 'partial.jsonl'), 'utf8')
        expect(written.split('\n').length - 1).toBe(calls.length)
        expect(await readdir(output)).not.toContain('raw-production-trials.jsonl')
        calls.push(`${pair}/${engine}`)
        return { ...trial(engine), pair, order }
      },
    })
    const summary = await writeProductionTrials({
      output,
      workloads: [workload],
      available: [workload],
      records,
    })
    const lines: unknown[] = (
      await readFile(path.join(output, summary.trialsArtifact.path), 'utf8')
    )
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(lines).toHaveLength(6)
    expect(calls).toEqual([
      '-1/tree-sitter',
      '-1/remark',
      '0/remark',
      '0/tree-sitter',
      '1/tree-sitter',
      '1/remark',
    ])
    expect(lines[0]).toEqual({ ...trial('tree-sitter'), pair: -1, order: 'BA' })
    expect(summary.sampleSummaries).toHaveLength(4)
    expect(summary.observations).toHaveLength(4)
    expect(summary.observations[0]).not.toHaveProperty('receipt')
    expect(summary.observations[0]).not.toHaveProperty('correctness')
    expect(summary.comparisons).toEqual(productionComparisons(summary.observations, [workload]))
    expect(summary.familyCoverage).toEqual(
      productionFamilyCoverage(summary.observations, [workload]),
    )
    expect(summary.resourcePlateaus).toEqual([])
    const measured = [
      trial('remark'),
      trial('tree-sitter'),
      { ...trial('tree-sitter'), pair: 1, order: 'BA' as const },
      { ...trial('remark'), pair: 1, order: 'BA' as const },
    ]
    expect(summary.sampleSummaries).toEqual(measured.map(productionTrialSummary))
    expect(summary.ordinaryFindings).toEqual(ordinaryProductionFindings(measured, [workload]))
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('artifact streaming production seals the first arm after a second-arm failure', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'production-partial-'))
  try {
    const workload = { ...productionBrowserWorkloads()[0], id: 'control', source: 'Actual' }
    const failures: string[] = []
    const exception = new TypeError('second arm failed')
    let calls = 0
    const records = productionTrialRecords({
      workloads: [workload],
      trials: 2,
      warmups: 0,
      failures,
      capture: async ({ engine }) => {
        calls++
        if (calls === 2) throw exception
        return trial(engine)
      },
    })
    const summary = await writeProductionTrials({
      output,
      workloads: [workload],
      available: [workload],
      records,
    })
    expect(summary.trialsArtifact.recordCount).toBe(1)
    expect(
      JSON.parse(await readFile(path.join(output, summary.trialsArtifact.path), 'utf8')),
    ).toEqual(trial('remark'))
    expect(failures).toEqual(['control/pair-0: second arm failed'])
    expect(calls).toBe(2)
    expect(summary.comparisons.every((entry) => entry.independentTrials === 0)).toBe(true)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('scalar observations retain exact comparison metrics and CPU exclusion reasons', () => {
  const raw = trial('remark')
  const compact = productionMetricObservation(raw)
  expect(compact).toEqual({
    workload: raw.workload,
    family: raw.family,
    pair: raw.pair,
    engine: raw.engine,
    metrics: {
      updateP95: { value: 2, reason: null },
      settlementP95: { value: 3, reason: null },
      mountP95: { value: 2, reason: null },
      streamCpu: { value: null, reason: 'Worker target counts are unavailable.' },
    },
  })
  raw.correctness.frames.splice(0)
  raw.receipt.frames.splice(0)
  expect(compact.metrics.updateP95.value).toBe(2)
  expect(compact).not.toHaveProperty('receipt')
})

test('artifact streaming production derives resource and network findings without retaining raw rows', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'production-resources-'))
  try {
    const workload = {
      ...productionBrowserWorkloads()[0],
      id: 'control',
      family: 'resources' as const,
      source: 'Actual',
    }
    const raw = { ...trial('tree-sitter'), family: workload.family }
    async function* records() {
      yield raw
    }
    const summary = await writeProductionTrials({
      output,
      workloads: [workload],
      available: [workload],
      records: records(),
    })
    expect(summary.resourcePlateaus).toEqual([
      {
        workload: 'control',
        pair: 0,
        engine: 'tree-sitter',
        ...productionResourcePlateau(raw.resourceWindows, raw.resourceControlWindows, true),
      },
    ])
    expect(summary.incompleteEvidence).toEqual([
      'control/tree-sitter: browser resource receipts are unavailable.',
    ])
    expect(summary.sampleSummaries).toEqual([productionTrialSummary(raw)])
    expect(summary).not.toHaveProperty('rawTrials')
    expect(summary).not.toHaveProperty('warmupResults')
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('artifact streaming production rejects source failure and removes its unsealed raw artifact', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'production-io-failure-'))
  try {
    const workload = { ...productionBrowserWorkloads()[0], id: 'control' }
    const error = new TypeError('raw source failed')
    async function* records() {
      yield trial('remark')
      throw error
    }
    await expect(
      writeProductionTrials({
        output,
        workloads: [workload],
        available: [workload],
        records: records(),
      }),
    ).rejects.toBe(error)
    expect(await readdir(output)).toEqual([])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('scalar observations keep workload-index bootstrap seeds and all four metrics unchanged', () => {
  const workload = { ...productionBrowserWorkloads()[0], id: 'control' }
  const observations = Array.from({ length: 20 }, (_, pair) =>
    (['remark', 'tree-sitter'] as const).map((engine) => {
      const value = engine === 'remark' ? pair + 10 : (pair % 5) + 2
      const metric = { value, reason: null }
      return {
        ...productionMetricObservation(trial(engine)),
        pair,
        metrics: { updateP95: metric, settlementP95: metric, mountP95: metric, streamCpu: metric },
      }
    }),
  ).flat()
  const comparisons = productionComparisons(observations, [
    { ...workload, id: 'unobserved' },
    workload,
  ]).filter((entry) => entry.workload === 'control')
  for (const metric of ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const) {
    const expected = pairedConfidence({
      workload: 'control',
      metric,
      baseline: Array.from({ length: 20 }, (_, pair) => pair + 10),
      candidate: Array.from({ length: 20 }, (_, pair) => (pair % 5) + 2),
      seed: 942,
      resamples: 4096,
    })
    expect(comparisons.find((entry) => entry.metric === metric)).toEqual({
      ...expected,
      selectedPairs: 20,
      excludedPairs: [],
      reason: null,
      domain: 'browser',
      build: 'production',
    })
  }
})

test('artifact streaming production retains later workloads after a partial pair failure', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'production-later-workload-'))
  try {
    const first = { ...productionBrowserWorkloads()[0], id: 'first', source: 'Actual' }
    const second = { ...first, id: 'second' }
    const workloads = [first, second]
    const failures: string[] = []
    const records = productionTrialRecords({
      workloads,
      trials: 1,
      warmups: 0,
      failures,
      capture: async ({ workload, engine }) => {
        if (workload.id === 'first' && engine === 'tree-sitter')
          throw new TypeError('first workload second arm')
        return { ...trial(engine), workload: workload.id }
      },
    })
    const summary = await writeProductionTrials({
      output,
      workloads,
      available: workloads,
      records,
    })
    expect(summary.trialsArtifact.recordCount).toBe(3)
    expect(summary.observations.map((entry) => `${entry.workload}/${entry.engine}`)).toEqual([
      'first/remark',
      'second/remark',
      'second/tree-sitter',
    ])
    expect(failures).toEqual(['first/pair-0: first workload second arm'])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
