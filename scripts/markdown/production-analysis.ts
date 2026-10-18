import { createHash } from 'node:crypto'

import type {
  ProductionMarkdownReceipt,
  ProductionResourceWindow,
  ProductionTimelineReceipt,
  ProductionTimingReceipt,
} from '../../apps/web/test/factories/markdown-production-types'
import { percentile } from './bench-types'
import { pairedConfidence } from './paired-native'
import frozenBudget from './promotion-budget.json'
import { BENCHMARK_FAMILIES } from './workloads'
import type { ProductionCpuMetrics, ProductionNetworkRequest } from './production-cdp'
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
  readonly timeline: ProductionTimelineReceipt | null
  readonly resourceWindows: readonly ProductionResourceWindow[] | null
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

export function productionComparisons(
  trials: readonly ProductionTrial[],
  workloads: readonly ProductionWorkload[],
) {
  return workloads.flatMap((workload, index) => {
    const selected = trials.filter((trial) => trial.workload === workload.id && trial.pair >= 0)
    const pairs = Array.from(new Set(selected.map((trial) => trial.pair))).sort(
      (left, right) => left - right,
    )
    return (['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const).map((metric) => {
      const vectors = pairs.flatMap((pair) => {
        const baseline = selected.find((trial) => trial.pair === pair && trial.engine === 'remark')
        const candidate = selected.find(
          (trial) => trial.pair === pair && trial.engine === 'tree-sitter',
        )
        if (!baseline || !candidate) return []
        const left = trialMetric(baseline, metric)
        const right = trialMetric(candidate, metric)
        return left === null || right === null ? [] : [{ baseline: left, candidate: right }]
      })
      if (vectors.length === 0)
        return {
          workload: workload.id,
          metric,
          status: 'inconclusive' as const,
          reason: 'No complete observed metric pairs.',
          independentTrials: 0,
        }
      return {
        ...pairedConfidence({
          workload: workload.id,
          metric,
          baseline: vectors.map((value) => value.baseline),
          candidate: vectors.map((value) => value.candidate),
          seed: 941 + index,
          resamples: 4096,
        }),
        domain: 'browser' as const,
        build: 'production' as const,
      }
    })
  })
}

function trialMetric(
  trial: ProductionTrial,
  metric: 'updateP95' | 'settlementP95' | 'mountP95' | 'streamCpu',
) {
  if (metric === 'mountP95')
    return trial.receipt.frames.length === 0
      ? null
      : trial.navigationMs + trial.receipt.frames[0].painted - trial.receipt.started
  if (metric === 'settlementP95') return trial.receipt.fullyReady - trial.receipt.final.received
  if (metric === 'updateP95')
    return trial.receipt.frames.length === 0
      ? null
      : percentile(
          trial.receipt.frames.map((frame) => frame.painted - frame.received),
          0.95,
        )
  if (!trial.cpu || !trial.workers || trial.workers.created > 0) return null
  const { before, after } = trial.cpu
  if (before.mainThreadTaskCpuMs === null || after.mainThreadTaskCpuMs === null) return null
  return after.mainThreadTaskCpuMs - before.mainThreadTaskCpuMs
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

export function productionResourcePlateau(windows: readonly ProductionResourceWindow[] | null) {
  if (!windows || windows.length < 4)
    return {
      status: 'INCONCLUSIVE',
      reason: 'Four disposed-message batches were not observed.',
    }
  const tail = windows.slice(1)
  const live = tail.map((window) => window.jsHeapUsedAfterBytes)
  const backing = tail.map((window) => window.backingStorageAfterBytes)
  const reserved = windows.map((window) => window.peakWasmReservedBytes)
  const hasGrowth = (values: readonly (number | null)[]) =>
    values.every((value, index) => {
      if (index === 0) return true
      const previous = values[index - 1]
      return value !== null && previous !== null && value > previous
    })
  const retained = windows.some(
    (window) =>
      window.retainedMessageNodes > 0 || window.queryObserversAfter > window.queryObserversBefore,
  )
  const observedGrowth = hasGrowth(live) || hasGrowth(backing) || retained
  const firstPeak = reserved[0]
  const wasmReuse =
    firstPeak !== null && firstPeak !== undefined && reserved.every((value) => value !== null)
      ? reserved.slice(1).every((value) => value !== null && value <= firstPeak)
      : null
  return {
    status: observedGrowth || wasmReuse === false ? 'NOT VERIFIED' : 'INCONCLUSIVE',
    jsLiveAfterGcBytes: live,
    backingStorageAfterGcBytes: backing,
    wasmReservationPeakBytes: reserved,
    observedPersistentGrowth: observedGrowth,
    observedWasmHighWaterReuse: wasmReuse,
    reason:
      'Reservations and post-GC live bytes are separate observations. Four windows do not by themselves establish that every reachable cache has plateaued.',
  }
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
    streamMainThreadCpuMs: trialMetric(trial, 'streamCpu'),
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
  return (['host', 'grammar', 'resolver', 'javascript', 'other'] as const).map((kind) => {
    const requests = network.filter((request) => request.kind === kind)
    const missing = requests.filter(
      (request) => request.transferredBytes === null || request.failure !== null,
    )
    return {
      kind,
      requests: requests.length,
      cacheHits: requests.filter((request) => request.fromCache).length,
      transferredBytes:
        missing.length > 0
          ? null
          : requests.reduce((sum, request) => sum + (request.transferredBytes ?? 0), 0),
      incompleteRequests: missing.length,
    }
  })
}
