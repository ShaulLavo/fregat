import { expect, it } from 'vitest'
import {
  auditX6Overlap,
  epochNanoseconds,
  type IntervalBlock,
  type ObservationInterval,
  type RunnerJob,
  type StopwatchSlice,
} from './ghostty-x6-public-overlap.ts'
import { x6SteadyOperations } from './ghostty-x6-public-statistics.ts'

const epoch = Date.parse('2026-10-04T00:00:00.000Z')

function blocks(): IntervalBlock[] {
  return Array.from({ length: 40 }, (_, block) => {
    const rows: ObservationInterval[] = []
    function add(operation: string, inert: number, repetition: number): void {
      const start = epoch + block * 5_000 + rows.length * 10
      rows.push({
        operation,
        inert,
        repetition,
        milliseconds: 1,
        operations: 2_000,
        startedAtMilliseconds: start,
        endedAtMilliseconds: start + (inert === 100 ? 3 : 4),
      })
    }
    for (const repetition of [0, 1]) {
      for (const inert of [0, 1, 100, 1_000, 1_000, 100, 1, 0])
        add('public-create', inert, repetition)
      for (const inert of [0, 100, 1_000, 1_000, 100, 0]) {
        add('cold-public-first-use', inert, repetition)
        for (const operation of x6SteadyOperations) add(operation, inert, repetition)
      }
    }
    return { rows }
  })
}

function job(start: number, end: number | null, id = 'actual-job-1'): RunnerJob {
  return {
    id,
    startedAt: new Date(start).toISOString(),
    endedAt: end === null ? null : new Date(end).toISOString(),
  }
}

it('accepts no overlap and retains every process vector', () => {
  const result = auditX6Overlap(blocks(), [], epoch + 200_000)
  expect(result.valid).toBe(true)
  expect(result.comparisons).toEqual([])
  expect(result.jobsDuringRun).toEqual([])
})

it('invalidates the entire window for one observed side without dropping a block', () => {
  const data = blocks()
  const row = data[0]!.rows.find(
    (item) => item.operation === 'public-dom-key' && item.inert === 100,
  )!
  const actualJob = job(row.startedAtMilliseconds, row.endedAtMilliseconds)
  const result = auditX6Overlap(data, [actualJob], epoch + 200_000)
  expect(result.valid).toBe(false)
  expect(result.comparisons).toHaveLength(40 * 26)
  expect(result.jobsDuringRun).toEqual([actualJob])
  expect(
    result.comparisons.some(
      (item) => item.blockIndex === 0 && item.operation === 'public-dom-key' && item.invalid,
    ),
  ).toBe(true)
})

it('discloses both-side unequal exposure without inventing a balance cutoff', () => {
  const result = auditX6Overlap(blocks(), [job(epoch - 1, epoch + 200_000)], epoch + 200_000)
  expect(result.valid).toBe(true)
  const comparison = result.comparisons.find((item) => item.operation === 'public-dom-key')!
  expect('leftMilliseconds' in comparison && comparison.leftMilliseconds).toBe(16)
  expect('rightMilliseconds' in comparison && comparison.rightMilliseconds).toBe(12)
})

it('classifies each job independently even when combined exposures cover both sides', () => {
  const data = blocks()
  const zero = data[0]!.rows.find(
    (item) => item.operation === 'public-dom-key' && item.inert === 0,
  )!
  const hundred = data[0]!.rows.find(
    (item) => item.operation === 'public-dom-key' && item.inert === 100,
  )!
  const jobs = [
    job(zero.startedAtMilliseconds, zero.endedAtMilliseconds, 'zero-only'),
    job(hundred.startedAtMilliseconds, hundred.endedAtMilliseconds, 'hundred-only'),
  ]
  const result = auditX6Overlap(data, jobs, epoch + 200_000)
  expect(result.valid).toBe(false)
  expect(
    result.comparisons.filter((item) => item.operation === 'public-dom-key' && item.invalid),
  ).toHaveLength(3)
})

it('invalidates creation strict-subset exposure and T1/T0 activation separately', () => {
  const data = blocks()
  const one = data[0]!.rows.find((item) => item.operation === 'public-create' && item.inert === 1)!
  const result = auditX6Overlap(
    data,
    [job(one.startedAtMilliseconds, one.endedAtMilliseconds)],
    epoch + 200_000,
  )
  const invalid = result.comparisons.filter((item) => item.invalid)
  expect(invalid).toHaveLength(2)
  expect(invalid.some((item) => 'touched' in item && item.touched === 1)).toBe(true)
  expect(invalid.some((item) => 'right' in item && item.right === 1)).toBe(true)
})

it('clips an ongoing actual job at window end and uses half-open boundaries', () => {
  const data = blocks()
  expect(auditX6Overlap(data, [job(epoch - 100, epoch)], epoch + 200_000).valid).toBe(true)
  const ongoing = job(epoch - 1, null)
  const result = auditX6Overlap(data, [ongoing], epoch + 200_000)
  expect(result.valid).toBe(true)
  expect(result.jobsDuringRun[0]!.endedAt).toBeNull()
})

it('stops classification for runner intervals rounded to zero width', () => {
  const data = blocks()
  const row = data[0]!.rows.find(
    (item) => item.operation === 'public-dom-key' && item.inert === 100,
  )!
  expect(
    auditX6Overlap(data, [job(row.startedAtMilliseconds, row.endedAtMilliseconds)], epoch + 200_000)
      .valid,
  ).toBe(false)
  const rounded = job(row.startedAtMilliseconds + 0.1, row.startedAtMilliseconds + 0.9)
  expect(rounded.endedAt).toBe(rounded.startedAt)
  expect(() => auditX6Overlap(data, [rounded], epoch + 200_000)).toThrow(/zero-width/)
  expect(() => auditX6Overlap(data, [job(epoch, null)], epoch)).toThrow(/zero-width/)
})

it('rejects missing observations, duplicate job IDs and invalid timestamps', () => {
  const data = blocks()
  expect(() => auditX6Overlap(data.slice(1), [], epoch + 200_000)).toThrow()
  const first = data[0]!
  data[0] = { rows: first.rows.slice(1) }
  expect(() => auditX6Overlap(data, [], epoch + 200_000)).toThrow()
  const duplicate = job(epoch - 1, epoch)
  expect(() => auditX6Overlap(blocks(), [duplicate, duplicate], epoch + 200_000)).toThrow()
  expect(() =>
    auditX6Overlap(blocks(), [{ id: 'bad', startedAt: 'bad', endedAt: null }], epoch + 200_000),
  ).toThrow()
})

function slice(start: number, end: number): StopwatchSlice {
  const startedAtMonotonicMilliseconds = start - epoch
  const endedAtMonotonicMilliseconds = end - epoch
  return {
    startedAtMonotonicMilliseconds,
    endedAtMonotonicMilliseconds,
    startedAtNanoseconds: String(
      epochNanoseconds(epoch) + epochNanoseconds(startedAtMonotonicMilliseconds),
    ),
    endedAtNanoseconds: String(
      epochNanoseconds(epoch) + epochNanoseconds(endedAtMonotonicMilliseconds),
    ),
  }
}

function withSlices(
  data: readonly IntervalBlock[],
  modify: (row: ObservationInterval) => ObservationInterval,
): IntervalBlock[] {
  return data.map((block) => ({
    rows: block.rows.map(modify),
    clock: {
      timeOriginMilliseconds: epoch,
      timeOriginNanoseconds: String(epochNanoseconds(epoch)),
      anchors: [
        { beforeMonotonicMilliseconds: 0, afterMonotonicMilliseconds: 1, epochMilliseconds: epoch },
        {
          beforeMonotonicMilliseconds: 200_000,
          afterMonotonicMilliseconds: 200_001,
          epochMilliseconds: epoch + 200_000,
        },
      ],
    },
  }))
}

it('keeps gap-only jobs in the receipt without treating untimed gaps as exposure', () => {
  const original = blocks()
  const target = original[0]!.rows.find(
    (row) => row.operation === 'public-use-fresh' && row.inert === 0,
  )!
  const start = target.startedAtMilliseconds
  const data = withSlices(original, (row) =>
    row === target
      ? { ...row, slices: [slice(start, start + 0.25), slice(start + 3.75, start + 4)] }
      : row,
  )
  const actualJob = job(start + 1, start + 3)
  const result = auditX6Overlap(data, [actualJob], epoch + 200_000)
  expect(result.valid).toBe(true)
  expect(result.jobsDuringRun).toEqual([actualJob])
})

it('separates interleaved use and disposal slices even inside one common envelope', () => {
  const original = blocks()
  const use = original[0]!.rows.find(
    (row) => row.operation === 'public-use-fresh' && row.inert === 0,
  )!
  const dispose = original[0]!.rows.find(
    (row) => row.operation === 'public-dispose' && row.inert === 0,
  )!
  const start = use.startedAtMilliseconds
  const data = withSlices(original, (row) => {
    if (row === use) return { ...row, slices: [slice(start, start + 1)] }
    if (row === dispose)
      return {
        ...row,
        startedAtMilliseconds: start,
        endedAtMilliseconds: start + 4,
        slices: [slice(start + 3, start + 4)],
      }
    return row
  })
  const result = auditX6Overlap(data, [job(start, start + 1)], epoch + 200_000)
  expect(result.valid).toBe(false)
  expect(
    result.comparisons.some((row) => row.operation === 'public-use-fresh' && row.invalid),
  ).toBe(true)
  expect(result.comparisons.some((row) => row.operation === 'public-dispose' && row.invalid)).toBe(
    false,
  )
})

it('rejects missing clock mapping, zero-width slices and unresolved clock drift conservatively', () => {
  const original = blocks()
  const target = original[0]!.rows[0]!
  const start = target.startedAtMilliseconds
  const data = withSlices(original, (row) =>
    row === target ? { ...row, slices: [slice(start, start)] } : row,
  )
  expect(() => auditX6Overlap(data, [], epoch + 200_000)).toThrow(/zero-width/)
  const valid = withSlices(original, (row) =>
    row === target ? { ...row, slices: [slice(start, start + 1)] } : row,
  )
  valid[0] = { rows: valid[0]!.rows }
  expect(() => auditX6Overlap(valid, [], epoch + 200_000)).toThrow(/Clock mapping/)
  const drifted = withSlices(original, (row) => row)
  const clock = drifted[0]!.clock!
  drifted[0] = {
    rows: drifted[0]!.rows,
    clock: {
      ...clock,
      anchors: clock.anchors.map((anchor) => ({
        ...anchor,
        epochMilliseconds: anchor.epochMilliseconds + 2,
      })),
    },
  }
  expect(() => auditX6Overlap(drifted, [], epoch + 200_000)).toThrow(/clock alignment/)
})
