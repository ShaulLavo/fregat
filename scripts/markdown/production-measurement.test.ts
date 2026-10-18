import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'

import type { ProductionTrial } from './production-analysis'
import {
  ordinaryProductionFindings,
  productionDigest,
  productionComparisons,
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
  handleWorkerEvent,
  isSustainedProductStream,
  type ProductionNetworkRequest,
} from './production-cdp'
import { validateProductionBuildIdentity } from './production-browser'
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
      frames: [frame],
      final: frame,
      fullyReady: 4,
      longTasks: [],
      resources: [],
    },
    freshCompleted: { ...frame },
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
  candidate.freshCompleted = {
    ...candidate.freshCompleted,
    text: 'A stale completed message',
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
  expect(workerCpuReceipts([streamStart, streamEnd], [worker])[0].measurement).toBe('incomplete')
  expect(workerCpuReceipts([workerMapping], [worker])[0].measurement).toBe('incomplete')
  expect(workerCpuReceipts(events, [worker])[0]).toMatchObject({
    measurement: 'incomplete',
    cpuMs: null,
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
  event(worker.targetId, -1)
  const unknown = observed.get(`${worker.targetId}:${worker.targetId}`)
  expect(unknown).toMatchObject({ phase: 'navigation', transferredBytes: null, target: 'worker' })
  expect(unknown && completedWorkerAlias(pageRequest, unknown)).toBeNull()
  event(worker.targetId, 123)
  expect(observed.get(`${worker.targetId}:${worker.targetId}`)).toMatchObject({
    phase: 'navigation',
    transferredBytes: null,
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
    completionEncodedBytes: 794046,
    transferScope: 'full-request',
  })
  expect(completedWorkerAlias(pageRequest, aliases[2])).not.toBeNull()
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
