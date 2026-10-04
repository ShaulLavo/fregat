import assert from 'node:assert/strict'
import { x6Protocol, x6SteadyOperations, type TimingRow } from './ghostty-x6-public-statistics.ts'

export interface StopwatchSlice {
  readonly startedAtNanoseconds: string
  readonly endedAtNanoseconds: string
  readonly startedAtMonotonicMilliseconds: number
  readonly endedAtMonotonicMilliseconds: number
}

export interface ObservationInterval extends TimingRow {
  readonly startedAtMilliseconds: number
  readonly endedAtMilliseconds: number
  readonly slices?: readonly StopwatchSlice[]
}

export interface ClockAnchor {
  readonly beforeMonotonicMilliseconds: number
  readonly afterMonotonicMilliseconds: number
  readonly epochMilliseconds: number
}

interface ClockMapping {
  readonly timeOriginMilliseconds: number
  readonly timeOriginNanoseconds: string
  readonly anchors: readonly ClockAnchor[]
}

export interface IntervalBlock {
  readonly rows: readonly ObservationInterval[]
  readonly clock?: ClockMapping
}

export interface RunnerJob {
  readonly id: string
  readonly startedAt: string
  readonly endedAt: string | null
}

interface Interval {
  readonly start: bigint
  readonly end: bigint
}

export function epochNanoseconds(milliseconds: number): bigint {
  assert(Number.isFinite(milliseconds))
  const whole = Math.trunc(milliseconds)
  return BigInt(whole) * 1_000_000n + BigInt(Math.round((milliseconds - whole) * 1_000_000))
}

function union(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => Number(a.start - b.start))
  const result: Interval[] = []
  for (const interval of sorted) {
    const previous = result.at(-1)
    if (!previous || interval.start > previous.end) {
      result.push(interval)
      continue
    }
    result[result.length - 1] = {
      start: previous.start,
      end: previous.end > interval.end ? previous.end : interval.end,
    }
  }
  return result
}

function exposure(intervals: readonly Interval[], job: Interval): number {
  let total = 0n
  for (const interval of intervals) {
    const end = interval.end < job.end ? interval.end : job.end
    const start = interval.start > job.start ? interval.start : job.start
    if (end > start) total += end - start
  }
  return Number(total) / 1_000_000
}

function observations(block: IntervalBlock, operation: string, inert: number): Interval[] {
  const selected = block.rows.filter((row) => row.operation === operation && row.inert === inert)
  assert.equal(selected.length, x6Protocol.observationsPerCount, `${operation}/${inert}`)
  assert.equal(selected.filter((row) => row.repetition === 0).length, 2)
  assert.equal(selected.filter((row) => row.repetition === 1).length, 2)
  return union(selected.flatMap(intervalsForRow))
}

function intervalsForRow(row: ObservationInterval): Interval[] {
  assert(Number.isFinite(row.startedAtMilliseconds))
  assert(Number.isFinite(row.endedAtMilliseconds))
  assert(row.endedAtMilliseconds >= row.startedAtMilliseconds)
  if (!row.slices) {
    assert(row.endedAtMilliseconds > row.startedAtMilliseconds)
    return [
      {
        start: epochNanoseconds(row.startedAtMilliseconds),
        end: epochNanoseconds(row.endedAtMilliseconds),
      },
    ]
  }
  assert(row.slices.length > 0, 'No silent loss of stopwatch slices')
  return row.slices.map((slice) => {
    assert(Number.isFinite(slice.startedAtMonotonicMilliseconds))
    assert(Number.isFinite(slice.endedAtMonotonicMilliseconds))
    assert(
      slice.endedAtMonotonicMilliseconds > slice.startedAtMonotonicMilliseconds,
      'Unresolved zero-width monotonic slice; preserve raw data and stop classification',
    )
    const start = BigInt(slice.startedAtNanoseconds)
    const end = BigInt(slice.endedAtNanoseconds)
    assert(
      end > start,
      'Unresolved rounded stopwatch slice; preserve raw data and stop classification',
    )
    return { start, end }
  })
}

function jobInterval(job: RunnerJob, windowEndedAtMilliseconds: number): Interval {
  const start = Date.parse(job.startedAt)
  const end =
    job.endedAt === null ? Math.max(start, windowEndedAtMilliseconds) : Date.parse(job.endedAt)
  assert(Number.isFinite(start) && Number.isFinite(end), `Runner job ${job.id} timestamps`)
  assert(end > start, `Runner job ${job.id} unresolved zero-width or reversed interval`)
  return { start: epochNanoseconds(start), end: epochNanoseconds(end) }
}

function pair(
  block: IntervalBlock,
  blockIndex: number,
  job: RunnerJob,
  interval: Interval,
  operation: string,
  left: number,
  right: number,
) {
  const leftMilliseconds = exposure(observations(block, operation, left), interval)
  const rightMilliseconds = exposure(observations(block, operation, right), interval)
  const invalid = leftMilliseconds > 0 !== rightMilliseconds > 0
  return {
    blockIndex,
    jobId: job.id,
    operation,
    left,
    right,
    leftMilliseconds,
    rightMilliseconds,
    invalid,
    classification: invalid ? 'ONE-SIDED — INVALID' : 'BOTH OR NEITHER — DISCLOSE',
  }
}

function creation(block: IntervalBlock, blockIndex: number, job: RunnerJob, interval: Interval) {
  const milliseconds = Object.fromEntries(
    [0, 1, 100, 1_000].map((inert) => [
      inert,
      exposure(observations(block, 'public-create', inert), interval),
    ]),
  )
  const touched = Object.values(milliseconds).filter((value) => value > 0).length
  const invalid = touched > 0 && touched < 4
  return {
    blockIndex,
    jobId: job.id,
    operation: 'public-create',
    milliseconds,
    touched,
    invalid,
    classification: invalid ? 'NONEMPTY STRICT SUBSET — INVALID' : 'ALL OR NONE — DISCLOSE',
  }
}

function validateClock(block: IntervalBlock): void {
  const slices = block.rows.flatMap((row) => row.slices ?? [])
  if (slices.length === 0 && !block.clock) return
  const clock = block.clock
  assert(clock, 'Clock mapping required for lifecycle stopwatch slices')
  const origin = BigInt(clock.timeOriginNanoseconds)
  assert.equal(origin, epochNanoseconds(clock.timeOriginMilliseconds))
  assert(clock.anchors.length >= 2, 'Before/after clock anchors required')
  for (const anchor of clock.anchors) {
    assert(Number.isFinite(anchor.beforeMonotonicMilliseconds))
    assert(Number.isFinite(anchor.afterMonotonicMilliseconds))
    assert(Number.isFinite(anchor.epochMilliseconds))
    assert(anchor.afterMonotonicMilliseconds >= anchor.beforeMonotonicMilliseconds)
    const first: number = clock.timeOriginMilliseconds + anchor.beforeMonotonicMilliseconds
    const last: number = clock.timeOriginMilliseconds + anchor.afterMonotonicMilliseconds
    assert(
      first < anchor.epochMilliseconds + 1 && last >= anchor.epochMilliseconds,
      'Unresolved clock alignment; preserve raw data and stop classification',
    )
  }
  for (const slice of slices) {
    assert.equal(
      BigInt(slice.startedAtNanoseconds),
      origin + epochNanoseconds(slice.startedAtMonotonicMilliseconds),
    )
    assert.equal(
      BigInt(slice.endedAtNanoseconds),
      origin + epochNanoseconds(slice.endedAtMonotonicMilliseconds),
    )
  }
}

function validateBlock(block: IntervalBlock): void {
  assert.equal(block.rows.length, 172)
  validateClock(block)
  const required = [...x6SteadyOperations, 'public-create', 'cold-public-first-use']
  for (const operation of required) {
    const counts = operation === 'public-create' ? [0, 1, 100, 1_000] : [0, 100, 1_000]
    for (const inert of counts) observations(block, operation, inert)
  }
}

export function auditX6Overlap(
  blocks: readonly IntervalBlock[],
  jobs: readonly RunnerJob[],
  windowEndedAtMilliseconds: number,
) {
  assert.equal(blocks.length, x6Protocol.blocks)
  assert(Number.isFinite(windowEndedAtMilliseconds))
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length, 'Unique actual runner job IDs')
  // A job touching opposite arms in different processes cannot balance either paired vector.
  const comparisons = blocks.flatMap((block, blockIndex) => {
    validateBlock(block)
    return jobs.flatMap((job) => {
      const interval = jobInterval(job, windowEndedAtMilliseconds)
      return [
        ...x6SteadyOperations.flatMap((operation) =>
          [100, 1_000].map((inert) => pair(block, blockIndex, job, interval, operation, 0, inert)),
        ),
        pair(block, blockIndex, job, interval, 'public-create', 0, 1),
        creation(block, blockIndex, job, interval),
      ]
    })
  })
  return {
    valid: comparisons.every((comparison) => !comparison.invalid),
    jobsDuringRun: jobs,
    comparisons,
    policy: {
      unit: 'Individual runner job ID within each independent process vector; union of every actual lifecycle stopwatch slice from all four observations per operation/count, and each contiguous observation interval for other operations',
      pair: 'Shared T0 versus T100 and T1000; creation T0 versus T1. One-sided exposure invalidates the pair; both-arm durations are disclosed without a balance cutoff.',
      creation:
        'Exposure to a nonempty strict subset of T0/T1/T100/T1000 invalidates the creation comparison; all-four durations are disclosed.',
      consequence:
        'Any invalid comparison invalidates the entire fixed 40-process window. Retain and descriptively analyze every original vector. Only one new-identity full-40 replacement under the same frozen protocol is authorized for qualified one-sided overlap.',
      exclusions:
        'No partial block/column replacement, filtering, optional stopping, GC correction or replay of a valid performance failure. Cold-first-use timing and untimed correctness controls are disclosed and do not add ratio gates.',
      clock:
        'Half-open integer epoch-nanosecond slices mapped from retained monotonic endpoints and the recorded performance.timeOrigin. Mapping and before/after Date.now anchors are validated. Runner ISO timestamps have millisecond resolution; they describe launch/finish, not sampled CPU activity. Null finish is clipped at the completed window end. Zero-width, rounded-away, missing or unresolved clock/journal inputs stop classification without dropping observations or authorizing an overlap replacement.',
      bookkeeping:
        'Slice serialization and timestamp bookkeeping are outside the operation stopwatches and identical across counts. Their allocations can affect later runtime/GC; no correction is applied.',
    },
  }
}
