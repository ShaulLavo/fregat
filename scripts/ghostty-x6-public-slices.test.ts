import { expect, test } from 'vitest'
import {
  epochNanoseconds,
  type IntervalBlock,
  type ObservationInterval,
  type StopwatchSlice,
} from './ghostty-x6-public-overlap.ts'
import { verifyX6Slices } from './ghostty-x6-public-slices.ts'

function block(operation = 'public-use-fresh'): IntervalBlock {
  const slices: StopwatchSlice[] = Array.from(
    { length: operation === 'public-use-fresh' ? 2_000 : 1 },
    (_, index) => ({
      startedAtMonotonicMilliseconds: index * 3,
      endedAtMonotonicMilliseconds: index * 3 + 1,
      startedAtNanoseconds: String(epochNanoseconds(index * 3)),
      endedAtNanoseconds: String(epochNanoseconds(index * 3 + 1)),
    }),
  )
  return {
    clock: {
      timeOriginMilliseconds: 0,
      timeOriginNanoseconds: '0',
      anchors: [
        { beforeMonotonicMilliseconds: 0, afterMonotonicMilliseconds: 1, epochMilliseconds: 0 },
        {
          beforeMonotonicMilliseconds: 6_000,
          afterMonotonicMilliseconds: 6_001,
          epochMilliseconds: 6_000,
        },
      ],
    },
    rows: [
      {
        operation,
        inert: 0,
        repetition: 0,
        milliseconds: slices.length,
        operations: 2_000,
        startedAtMilliseconds: 0,
        endedAtMilliseconds: 6_000,
        slices,
      },
    ],
  }
}

function row(data: IntervalBlock, patch: Partial<ObservationInterval>): IntervalBlock {
  return { ...data, rows: [{ ...data.rows[0]!, ...patch }] }
}

test('requires every lifecycle slice and the exact original stopwatch sum', () => {
  const data = block()
  expect(() => verifyX6Slices(data)).not.toThrow()
  expect(() => verifyX6Slices(row(data, { slices: data.rows[0]!.slices!.slice(1) }))).toThrow()
  expect(() => verifyX6Slices(row(data, { milliseconds: 1_999 }))).toThrow()
  expect(() => verifyX6Slices(row(data, { operations: 1_999 }))).toThrow()
})

test('requires one actual contiguous slice for nonlifecycle observations', () => {
  const data = block('public-write')
  expect(() => verifyX6Slices(data)).not.toThrow()
  expect(() => verifyX6Slices(row(data, { slices: undefined }))).toThrow()
  expect(() =>
    verifyX6Slices(row(data, { slices: [...data.rows[0]!.slices!, ...data.rows[0]!.slices!] })),
  ).toThrow()
})

test('rejects unresolved or altered endpoints and missing clock anchors', () => {
  const data = block('public-write')
  const slice = data.rows[0]!.slices![0]!
  expect(() =>
    verifyX6Slices(row(data, { slices: [{ ...slice, endedAtNanoseconds: '0' }] })),
  ).toThrow()
  expect(() => verifyX6Slices({ rows: data.rows })).toThrow()
  expect(() => verifyX6Slices({ ...data, clock: { ...data.clock!, anchors: [] } })).toThrow()
})
