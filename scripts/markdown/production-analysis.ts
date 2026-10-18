import { createHash } from 'node:crypto'

import type {
  ProductionMarkdownReceipt,
  ProductionResourceControlWindow,
  ProductionResourceWindow,
  ProductionTimelineReceipt,
  ProductionTimingReceipt,
} from '../../apps/web/test/factories/markdown-production-types'
import { percentile } from './bench-types'
import { pairedConfidence } from './paired-native'
import frozenBudget from './promotion-budget.json'
import { BENCHMARK_FAMILIES } from './workloads'
import { isSustainedProductStream, reconcileProductionNetworkRequests } from './production-cdp'
import type {
  ProductionCpuMetrics,
  ProductionNetworkRequest,
  ProductionWorkerCpu,
} from './production-cdp'
import type { ProductionWorkload } from './production-workloads'

export type ProductionTrial = {
  readonly workload: string
  readonly family: ProductionWorkload['family']
  readonly pair: number
  readonly order: 'AB' | 'BA'
  readonly engine: 'remark' | 'tree-sitter'
  readonly arrival: 'paced' | 'burst-coalesced'
  readonly cache: 'cold' | 'warm'
  readonly navigationMs: number
  readonly initializationMs: number
  readonly environment: {
    readonly userAgent: string
    readonly concurrency: number
    readonly deviceScaleFactor: number
    readonly viewport: { readonly width: number; readonly height: number }
    readonly fontFamily: string
    readonly fonts: readonly {
      readonly family: string
      readonly status: string
      readonly weight: string
    }[]
  }
  readonly receipt: ProductionTimingReceipt
  readonly correctness: ProductionMarkdownReceipt
  readonly freshCompleted: ProductionMarkdownReceipt['final']
  readonly cpu: {
    readonly before: ProductionCpuMetrics
    readonly after: ProductionCpuMetrics
  } | null
  readonly updateCpu: readonly {
    readonly revision: number
    readonly mainThreadCpuMs: number
  }[]
  readonly workers: {
    readonly created: number
    readonly active: number
  } | null
  readonly network: readonly ProductionNetworkRequest[] | null
  readonly streamMainThreadCpuMs: number | null
  readonly workerCpu: readonly ProductionWorkerCpu[] | null
  readonly timeline: ProductionTimelineReceipt | null
  readonly resourceWindows: readonly ProductionResourceWindow[] | null
  readonly resourceControlWindows: readonly ProductionResourceControlWindow[] | null
}

export function productionPairFindings(
  trials: readonly ProductionTrial[],
  expectedInputs: readonly string[],
) {
  const baseline = trials.find((trial) => trial.engine === 'remark')
  const candidate = trials.find((trial) => trial.engine === 'tree-sitter')
  if (!baseline || !candidate) return ['An independent paired trial is missing.']
  const expectedUpdates = expectedInputs.length
  const failures = validateRevisionReceipts(baseline, expectedInputs).concat(
    validateRevisionReceipts(candidate, expectedInputs),
  )
  for (const trial of [baseline, candidate]) {
    if (
      digestObservation(trial.freshCompleted) !== digestObservation(trial.correctness.final) ||
      trial.freshCompleted.paintedOutput.digest !== digestObservation(trial.freshCompleted)
    )
      failures.push(`${trial.engine}: streamed final differs from a fresh completed message.`)
    if (
      trial.correctness.frames.some(
        (frame) => frame.paintedOutput.digest !== digestObservation(frame),
      )
    )
      failures.push(
        `${trial.engine}: expected projection digest does not match the recorded output.`,
      )
  }
  const first = baseline.correctness.frames
  const second = candidate.correctness.frames
  if (first.length !== expectedUpdates || second.length !== expectedUpdates)
    failures.push('Correctness replay does not cover the frozen input schedule.')
  for (const [index, frame] of first.entries()) {
    if (frame.paintedOutput.digest !== second[index]?.paintedOutput.digest)
      failures.push(`Revision ${index + 1}: paired product projections differ.`)
  }
  if (
    digestObservation(baseline.correctness.final) !== digestObservation(candidate.correctness.final)
  )
    failures.push('Completed product projections differ.')
  if (baseline.correctness.final.text.length === 0 || candidate.correctness.final.text.length === 0)
    failures.push('Completed projection is empty.')
  return failures
}

export function validateRevisionReceipts(
  trial: ProductionTrial,
  expectedInputs: readonly string[],
) {
  const failures: string[] = []
  const processed = trial.receipt.processed
  if (
    processed.length !== expectedInputs.length ||
    new Set(processed.map((entry) => entry.revision)).size !== expectedInputs.length
  )
    failures.push(`${trial.engine}: missing or duplicate revision completions.`)
  for (const [index, entry] of processed.entries()) {
    const input = expectedInputs[index]
    const oracle = trial.correctness.frames[index]
    if (
      input === undefined ||
      entry.inputSha256 !== productionDigest(input) ||
      entry.inputUtf16Units !== input.length ||
      entry.live !== index + 1 < expectedInputs.length
    )
      failures.push(`${trial.engine}: completion ${index + 1} is not bound to the frozen input.`)
    if (!oracle || entry.inputSha256 !== oracle.inputSha256)
      failures.push(
        `${trial.engine}: completion ${index + 1} differs from the independent replay input.`,
      )
    if (
      !Number.isFinite(entry.committed - entry.received) ||
      entry.committed < entry.received ||
      entry.received < entry.scheduled
    )
      failures.push(`${trial.engine}: invalid revision processing timestamps.`)
    if (index > 0 && entry.revision <= processed[index - 1].revision)
      failures.push(`${trial.engine}: revision completions are out of order.`)
  }
  const frames = trial.receipt.frames
  const required = processed.filter(
    (_, index) =>
      trial.arrival === 'paced' || (index + 1) % 32 === 0 || index >= processed.length - 2,
  )
  if (
    required.some((input) => !frames.some((frame) => frame.revision === input.revision)) ||
    new Set(frames.map((frame) => frame.revision)).size !== frames.length
  )
    failures.push(`${trial.engine}: required paint observations are missing or duplicated.`)
  const skipped = processed
    .filter((tick) => !frames.some((frame) => frame.revision === tick.revision))
    .map((tick) => tick.revision)
  if (JSON.stringify(skipped) !== JSON.stringify(trial.receipt.skippedPaintRevisions))
    failures.push(`${trial.engine}: unobserved paint revisions are not fully enumerated.`)
  for (const frame of frames) {
    const index = processed.findIndex((entry) => entry.revision === frame.revision)
    const oracle = trial.correctness.frames[index]
    if (
      index < 0 ||
      !oracle ||
      frame.paintedOutput.digest !== oracle.paintedOutput.digest ||
      frame.observedRevision !== frame.revision
    )
      failures.push(
        `${trial.engine}: paint receipt ${frame.revision} does not match its expected projection.`,
      )
    if (!Number.isFinite(frame.painted - frame.committed) || frame.painted < frame.committed)
      failures.push(`${trial.engine}: paint precedes completion.`)
  }
  if (
    trial.receipt.final.revision !== processed.at(-1)?.revision ||
    trial.receipt.fullyReadyOutput.digest !== trial.correctness.final.paintedOutput.digest
  )
    failures.push(`${trial.engine}: completed product projection was not observed ready.`)
  return failures
}

export function productionDigest(source: string | Buffer) {
  return createHash('sha256').update(source).digest('hex')
}

function digestObservation(frame: ProductionMarkdownReceipt['final']) {
  return productionDigest(JSON.stringify({ text: frame.text, elements: frame.elements }))
}

type ProductionComparisonExclusion = {
  readonly pair: number
  readonly engine: ProductionTrial['engine']
  readonly reason: string
}

type MetricObservation = {
  readonly value: number | null
  readonly reason: string | null
}

export function productionComparisons(
  trials: readonly ProductionTrial[],
  workloads: readonly ProductionWorkload[],
) {
  return workloads.flatMap((workload, index) => {
    const selected = trials.filter((trial) => trial.workload === workload.id && trial.pair >= 0)
    const pairs = Array.from(new Set(selected.map((trial) => trial.pair))).sort(
      (left, right) => left - right,
    )
    return (['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const).map((metric) =>
      compareProductionMetric(selected, pairs, workload.id, index, metric),
    )
  })
}

type ProductionMetric = Parameters<typeof metricObservation>[1]

function compareProductionMetric(
  selected: readonly ProductionTrial[],
  pairs: readonly number[],
  workload: string,
  workloadIndex: number,
  metric: ProductionMetric,
) {
  const excludedPairs: ProductionComparisonExclusion[] = []
  const vectors = pairs.flatMap((pair) => observedMetricPair(selected, pair, metric, excludedPairs))
  const evidence = { workload, metric, selectedPairs: pairs.length, excludedPairs }
  if (vectors.length === 0)
    return {
      ...evidence,
      status: 'inconclusive' as const,
      reason: 'No complete observed metric pairs.',
      independentTrials: 0,
    }
  const comparison = pairedConfidence({
    workload,
    metric,
    baseline: vectors.map((value) => value.baseline),
    candidate: vectors.map((value) => value.candidate),
    seed: 941 + workloadIndex,
    resamples: 4096,
  })
  const cpuEvidenceIncomplete = metric === 'streamCpu' && excludedPairs.length > 0
  return {
    ...comparison,
    ...evidence,
    status: cpuEvidenceIncomplete ? ('inconclusive' as const) : comparison.status,
    reason: cpuEvidenceIncomplete
      ? 'At least one selected stream CPU pair has incomplete evidence.'
      : null,
    domain: 'browser' as const,
    build: 'production' as const,
  }
}

function observedMetricPair(
  selected: readonly ProductionTrial[],
  pair: number,
  metric: ProductionMetric,
  excludedPairs: ProductionComparisonExclusion[],
) {
  const baseline = selected.find((trial) => trial.pair === pair && trial.engine === 'remark')
  const candidate = selected.find((trial) => trial.pair === pair && trial.engine === 'tree-sitter')
  if (!baseline || !candidate) {
    excludedPairs.push({
      pair,
      engine: !baseline ? 'remark' : 'tree-sitter',
      reason: 'Selected pair is missing an engine trial.',
    })
    return []
  }
  const left = metricObservation(baseline, metric)
  const right = metricObservation(candidate, metric)
  for (const [trial, observation] of [
    [baseline, left],
    [candidate, right],
  ] as const) {
    if (observation.value !== null) continue
    excludedPairs.push({
      pair,
      engine: trial.engine,
      reason: observation.reason ?? 'Selected metric observation is incomplete.',
    })
  }
  if (left.value === null || right.value === null) return []
  return [{ baseline: left.value, candidate: right.value }]
}

function metricObservation(
  trial: ProductionTrial,
  metric: 'updateP95' | 'settlementP95' | 'mountP95' | 'streamCpu',
): MetricObservation {
  if (metric === 'mountP95')
    return trial.receipt.frames.length === 0
      ? { value: null, reason: 'No paint frame was observed.' }
      : {
          value: trial.navigationMs + trial.receipt.frames[0].painted - trial.receipt.started,
          reason: null,
        }
  if (metric === 'settlementP95')
    return {
      value: trial.receipt.fullyReady - trial.receipt.final.received,
      reason: null,
    }
  if (metric === 'updateP95')
    return trial.receipt.frames.length === 0
      ? { value: null, reason: 'No paint frame was observed.' }
      : {
          value: percentile(
            trial.receipt.frames.map((frame) => frame.painted - frame.received),
            0.95,
          ),
          reason: null,
        }
  return streamCpuObservation(trial)
}

function streamCpuObservation(trial: ProductionTrial): MetricObservation {
  if (!trial.workers) return { value: null, reason: 'Worker target counts are unavailable.' }
  if (trial.workerCpu === null)
    return { value: null, reason: 'Dedicated-worker CPU evidence is unavailable.' }
  if (trial.workerCpu.length !== trial.workers.created)
    return {
      value: null,
      reason: 'Dedicated-worker CPU receipts do not cover every created worker.',
    }
  if (trial.workers.active > trial.workers.created)
    return { value: null, reason: 'Active worker count exceeds created worker count.' }
  if (
    trial.streamMainThreadCpuMs === null ||
    !Number.isFinite(trial.streamMainThreadCpuMs) ||
    trial.streamMainThreadCpuMs < 0
  )
    return { value: null, reason: 'Main-thread stream CPU evidence is unavailable.' }
  const incompleteWorker = trial.workerCpu.find(
    (worker) =>
      worker.measurement !== 'complete' ||
      worker.cpuMs === null ||
      !Number.isFinite(worker.cpuMs) ||
      worker.cpuMs < 0,
  )
  if (incompleteWorker)
    return {
      value: null,
      reason: `Dedicated-worker CPU is incomplete: ${incompleteWorker.reason ?? 'no exact task total.'}`,
    }
  const workerCpuMs = trial.workerCpu.reduce((sum, worker) => sum + (worker.cpuMs ?? 0), 0)
  return { value: trial.streamMainThreadCpuMs + workerCpuMs, reason: null }
}

function trialMetric(
  trial: ProductionTrial,
  metric: 'updateP95' | 'settlementP95' | 'mountP95' | 'streamCpu',
) {
  return metricObservation(trial, metric).value
}

export function ordinaryProductionFindings(
  trials: readonly ProductionTrial[],
  workloads: readonly ProductionWorkload[],
) {
  const limits = frozenBudget.ordinaryStreaming
  return trials.flatMap((trial) => {
    const workload = workloads.find((entry) => entry.id === trial.workload)
    if (
      !workload ||
      workload.arrival !== 'paced' ||
      workload.scheduleUnits !== limits.scheduleUtf16Units ||
      workload.sourceBytes > limits.maximumSourceBytes
    )
      return []
    const findings: string[] = []
    const prefix = percentile(
      trial.receipt.frames.map((frame) => frame.painted - frame.received),
      0.95,
    )
    if (prefix > limits.p95PrefixProjectionMs)
      findings.push(`${trial.workload}: prefix paint budget crossed.`)
    const held = trial.receipt.heldSyntax
    if (!held) findings.push(`${trial.workload}: held-syntax release was not observed.`)
    if (held && held.released.painted - held.released.received > limits.p95HeldSyntaxReleaseMs)
      findings.push(`${trial.workload}: held-syntax release budget crossed.`)
    if (trial.receipt.frames.length === 0)
      findings.push(`${trial.workload}: prefix paint observation is missing.`)
    const requiredCpuRevisions = trial.receipt.processed.map((tick) => tick.revision)
    if (held) requiredCpuRevisions.push(held.held.revision, held.released.revision)
    if (
      requiredCpuRevisions.some(
        (revision) => !trial.updateCpu.some((tick) => tick.revision === revision),
      )
    )
      findings.push(`${trial.workload}: per-update thread CPU is missing.`)
    if (
      trial.updateCpu.length > 0 &&
      percentile(
        trial.updateCpu.map((entry) => entry.mainThreadCpuMs),
        0.95,
      ) > limits.p95MainThreadMs
    )
      findings.push(`${trial.workload}: main-thread CPU budget crossed.`)
    if (trial.receipt.longTasks === null)
      findings.push(`${trial.workload}: long-task observation is unavailable.`)
    if (trial.receipt.longTasks?.some((duration) => duration > limits.maximumAttributableTaskMs))
      findings.push(`${trial.workload}: an observed long task crossed the ordinary budget.`)
    return findings
  })
}

export function productionFamilyCoverage(
  trials: readonly ProductionTrial[],
  workloads: readonly ProductionWorkload[],
) {
  return BENCHMARK_FAMILIES.map((family) => {
    const expected = workloads.filter((entry) => entry.family === family)
    const observed = trials.filter((trial) => trial.family === family && trial.pair >= 0)
    const measured = expected.filter((entry) =>
      ['remark', 'tree-sitter'].every((engine) =>
        observed.some((trial) => trial.workload === entry.id && trial.engine === engine),
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

export const PRODUCTION_RESOURCE_SCHEDULE = {
  id: 'fixed-settle-2-tail-4-v1',
  settlingBatches: 2,
  tailBatches: 4,
  simultaneousMessages: 4,
} as const

export function productionResourcePlateau(
  windows: readonly ProductionResourceWindow[] | null,
  controls: readonly ProductionResourceControlWindow[] | null = null,
  wasmRequired = true,
) {
  const schedule = PRODUCTION_RESOURCE_SCHEDULE
  const required = schedule.settlingBatches + schedule.tailBatches
  if (!windows || windows.length < 4)
    return { status: 'INCONCLUSIVE', reason: 'Four disposed-message batches were not observed.' }
  const retained = windows.some(
    (window) =>
      window.retainedMessageNodes > 0 || window.queryObserversAfter > window.queryObserversBefore,
  )
  const live = windows.map((window) => window.jsHeapUsedAfterBytes)
  const backing = windows.map((window) => window.backingStorageAfterBytes)
  const peaks = windows.map((window) => window.peakWasmReservedBytes)
  const nativeGrowth = wasmRequired && strictlyGrowing(peaks.slice(-4))
  const completeSchedule =
    controls !== null && windows.length === required && controls.length === required
  const tail = completeSchedule ? windows.slice(schedule.settlingBatches) : null
  const controlTail = completeSchedule ? controls.slice(schedule.settlingBatches) : null
  const liveGrowth = strictlyGrowing(live.slice(-4))
  const backingGrowth = strictlyGrowing(backing.slice(-4))
  const controlLiveGrowth = controlTail
    ? hasFiniteGrowth(controlTail.map((window) => window.jsHeapUsedAfterBytes))
    : false
  const controlBackingGrowth = controlTail
    ? strictlyGrowing(controlTail.map((window) => window.backingStorageAfterBytes))
    : false
  const matchedControlGrowth =
    (liveGrowth && controlLiveGrowth) || (backingGrowth && controlBackingGrowth)
  const unattributedGrowth = (liveGrowth || backingGrowth) && !matchedControlGrowth
  if (retained || nativeGrowth || unattributedGrowth)
    return {
      status: 'NOT VERIFIED',
      reason:
        'Retained nodes, observers, or product-attributed monotonic post-GC live/native growth was observed.',
      live,
      backing,
      peaks,
    }
  if (!tail || !controlTail || !controls)
    return {
      status: 'INCONCLUSIVE',
      reason: matchedControlGrowth
        ? 'Post-GC live/backing growth was also observed in the matching no-op control, so product attribution is inconclusive.'
        : 'The fixed settling/tail schedule and matching no-op control were not completed.',
      schedule,
      live,
      backing,
      peaks,
    }
  const observations = tail
    .flatMap((window) => [window.jsHeapUsedAfterBytes, window.backingStorageAfterBytes])
    .concat(
      controlTail.flatMap((window) => [
        window.jsHeapUsedAfterBytes,
        window.backingStorageAfterBytes,
      ]),
    )
  if (observations.some((value) => value === null || !Number.isFinite(value)))
    return {
      status: 'INCONCLUSIVE',
      reason: 'A required post-GC live/backing observation is unavailable.',
      schedule,
      live,
      backing,
      peaks,
    }
  const plateau =
    allEqual(tail.map((window) => window.jsHeapUsedAfterBytes)) &&
    allEqual(tail.map((window) => window.backingStorageAfterBytes)) &&
    tail.every((window) => window.queryObserversAfter === tail[0].queryObserversAfter)
  const controlPlateau =
    allEqual(controlTail.map((window) => window.jsHeapUsedAfterBytes)) &&
    allEqual(controlTail.map((window) => window.backingStorageAfterBytes))
  const wasmReuse =
    !wasmRequired ||
    (tail.every(
      (window) => window.peakWasmReservedBytes !== null && window.peakWasmReservedBytes > 0,
    ) &&
      allEqual(tail.map((window) => window.peakWasmReservedBytes)))
  const scheduleValid =
    windows.every(
      (window) =>
        Number.isInteger(window.cycles) &&
        window.cycles > 0 &&
        window.cycles === windows[0].cycles &&
        window.simultaneousMessages === schedule.simultaneousMessages &&
        window.peakMessageNodes === schedule.simultaneousMessages,
    ) && controls.every((window) => window.cycles === windows[0].cycles)
  const observedPlateau = plateau && controlPlateau && wasmReuse && scheduleValid
  return {
    status: observedPlateau ? 'OBSERVED_PLATEAU' : 'INCONCLUSIVE',
    schedule,
    jsLiveAfterGcBytes: live,
    backingStorageAfterGcBytes: backing,
    wasmReservationPeakBytes: peaks,
    controlJsLiveAfterGcBytes: controls.map((window) => window.jsHeapUsedAfterBytes),
    observedPersistentGrowth: observedPlateau ? false : null,
    observedWasmHighWaterReuse: wasmRequired ? wasmReuse : null,
    reason: matchedControlGrowth
      ? 'Post-GC live/backing growth was also observed in the matching no-op control, so the bounded measurement cannot attribute it to Markdown.'
      : 'A passing bounded observation requires four exactly stable post-GC live/backing windows after two settling batches, unchanged observers, repeated peak reservation reuse and a stable no-op control. No control subtraction or heap tolerance is applied. This does not certify unobserved future lifetimes.',
  }
}

function allEqual(values: readonly (number | null)[]) {
  const first = values[0]
  return (
    first !== undefined &&
    first !== null &&
    Number.isFinite(first) &&
    values.every((value) => value === first)
  )
}

function strictlyGrowing(values: readonly (number | null)[]) {
  return (
    values.length >= 4 &&
    values.every((value, index) => {
      const previous = values[index - 1]
      if (index === 0) return value !== null && Number.isFinite(value)
      return value !== null && previous !== null && value > previous
    })
  )
}

function hasFiniteGrowth(values: readonly (number | null)[]) {
  if (values.length < 4) return false
  const first = values[0]
  if (first === undefined || first === null || !Number.isFinite(first)) return false
  let maximum = first
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]
    if (value === null || value === undefined || !Number.isFinite(value)) return false
    maximum = Math.max(maximum, value)
  }
  return maximum > first
}

export function productionTrialSummary(trial: ProductionTrial) {
  const latency = trial.receipt.frames.map((frame) => frame.painted - frame.received)
  const cpu = trial.updateCpu.map((tick) => tick.mainThreadCpuMs)
  return {
    workload: trial.workload,
    engine: trial.engine,
    pair: trial.pair,
    processedUpdates: trial.receipt.processed.length,
    observedPaints: trial.receipt.frames.length,
    skippedPaintRevisions: trial.receipt.skippedPaintRevisions,
    elapsedReplayMs: trial.receipt.ended - trial.receipt.started,
    prefixPaintMs: distribution(latency),
    updateMainThreadCpuMs: distribution(cpu),
    parserWallMs: distribution(trial.receipt.processed.map((tick) => tick.parserWallMs)),
    producerLatenessMs: distribution(
      trial.receipt.processed.map((tick) => tick.received - tick.scheduled),
    ),
    settlementMs: trial.receipt.fullyReady - trial.receipt.final.received,
    heldSyntaxReleaseMs: trial.receipt.heldSyntax
      ? trial.receipt.heldSyntax.released.painted - trial.receipt.heldSyntax.released.received
      : null,
    streamCombinedCpuMs: trialMetric(trial, 'streamCpu'),
    transferred: payloadSummary(trial.network),
  }
}

function distribution(values: readonly number[]) {
  if (values.length === 0) return null
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: Math.max(...values),
  }
}

function payloadSummary(network: readonly ProductionNetworkRequest[] | null) {
  if (network === null) return null
  const reconciled = reconcileProductionNetworkRequests(network)
  return (['host', 'grammar', 'resolver', 'javascript', 'other'] as const).map((kind) => {
    const requests = reconciled.filter(
      (request) =>
        request.kind === kind &&
        request.resolvedByWorkerRequestId === null &&
        !isSustainedProductStream(request),
    )
    const missing = requests.filter(
      (request) =>
        (request.transferredBytes === null && request.resolvedByWorkerRequestId === null) ||
        request.failure !== null ||
        Boolean(request.transferReceiptError),
    )
    const observedDataReceived = requests.filter((request) => request.dataReceivedBytes !== null)
    return {
      kind,
      requests: requests.length,
      cacheHits: requests.filter((request) => request.fromCache).length,
      transferredBytes:
        missing.length > 0
          ? null
          : requests.reduce((sum, request) => sum + (request.transferredBytes ?? 0), 0),
      dataReceivedBytes:
        observedDataReceived.length === requests.length
          ? observedDataReceived.reduce((sum, request) => sum + (request.dataReceivedBytes ?? 0), 0)
          : null,
      dataReceivedRequestCount: observedDataReceived.length,
      incompleteRequests: missing.length,
    }
  })
}
