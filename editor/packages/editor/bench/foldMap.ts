import { performance } from 'node:perf_hooks'

import {
  createPieceTableSnapshot,
  insertIntoPieceTable,
  type PieceTableSnapshot,
  type Point,
} from '../src/public/document'
import {
  bufferPointToFoldPoint,
  createFoldMap,
  type FoldMap,
  type FoldPoint,
  foldPointToBufferPoint,
} from '../src/foldMap'
import type { FoldRange } from '../src/syntax'

type Sample = {
  readonly lines: number
  readonly folds: number
  readonly points: number
  readonly iterations: number
  readonly warmupIterations: number
  readonly createMs: number
  readonly averageRoundTripMs: number
  readonly p95RoundTripMs: number
  readonly worstRoundTripMs: number
}

const LINE_COUNT = 100_000
const FOLD_COUNT = 100
const FOLD_HEIGHT = 20
const POINT_COUNT = 100
const WARMUP_ITERATIONS = 100
const ITERATIONS = 1_000
const MAX_AVERAGE_ROUND_TRIP_MS = 0.5

const formatMs = (value: number): string => `${value.toFixed(4)}ms`

const buildDocument = (): {
  readonly snapshot: PieceTableSnapshot
  readonly lineOffsets: readonly number[]
} => {
  let snapshot = createPieceTableSnapshot('')
  const lineOffsets = [0]
  let offset = 0

  for (let line = 0; line < LINE_COUNT; line++) {
    const text = `line-${line}\n`
    snapshot = insertIntoPieceTable(snapshot, snapshot.length, text)
    offset += text.length
    lineOffsets.push(offset)
  }

  return { snapshot, lineOffsets }
}

const buildFolds = (offsets: readonly number[]): FoldRange[] => {
  const folds: FoldRange[] = []
  const stride = Math.floor(LINE_COUNT / FOLD_COUNT)

  for (let index = 0; index < FOLD_COUNT; index++) {
    const startLine = index * stride
    const endLine = Math.min(startLine + FOLD_HEIGHT, LINE_COUNT - 1)
    folds.push(fold(offsets, startLine, endLine))
  }

  return folds
}

const fold = (offsets: readonly number[], startLine: number, endLine: number): FoldRange => ({
  startIndex: offsets[startLine] ?? 0,
  endIndex: offsets[endLine] ?? offsets.at(-1) ?? 0,
  startLine,
  endLine,
  type: 'benchmark',
  languageId: 'typescript',
})

const buildPoints = (): Point[] => {
  const points: Point[] = []
  const stride = Math.floor(LINE_COUNT / POINT_COUNT)

  for (let index = 0; index < POINT_COUNT; index++) {
    points.push({ row: index * stride, column: 0 })
  }

  return points
}

const createBenchmarkMap = (
  snapshot: PieceTableSnapshot,
  folds: readonly FoldRange[],
): { readonly map: FoldMap; readonly createMs: number } => {
  const start = performance.now()
  const map = createFoldMap(snapshot, folds)

  return {
    map,
    createMs: performance.now() - start,
  }
}

const measureRoundTrips = (map: FoldMap, points: readonly Point[]): number[] => {
  const durations: number[] = []

  for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration++) {
    measureRoundTrip(map, points)
  }

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    durations.push(measureRoundTrip(map, points))
  }

  return durations
}

const measureRoundTrip = (map: FoldMap, points: readonly Point[]): number => {
  const folded: FoldPoint[] = []
  const start = performance.now()

  for (const point of points) {
    folded.push(bufferPointToFoldPoint(map, point))
  }

  for (const point of folded) {
    foldPointToBufferPoint(map, point)
  }

  return performance.now() - start
}

const average = (values: readonly number[]): number => {
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

const percentile = (values: readonly number[], percentileValue: number): number => {
  const sorted = values.toSorted((left, right) => left - right)
  const index = Math.ceil(sorted.length * percentileValue) - 1
  return sorted[Math.max(0, index)] ?? 0
}

const measure = (): Sample => {
  const { snapshot, lineOffsets } = buildDocument()
  const folds = buildFolds(lineOffsets)
  const points = buildPoints()
  const { map, createMs } = createBenchmarkMap(snapshot, folds)
  const durations = measureRoundTrips(map, points)

  return {
    lines: LINE_COUNT,
    folds: map.ranges.length,
    points: points.length,
    iterations: ITERATIONS,
    warmupIterations: WARMUP_ITERATIONS,
    createMs,
    averageRoundTripMs: average(durations),
    p95RoundTripMs: percentile(durations, 0.95),
    worstRoundTripMs: Math.max(...durations),
  }
}

const printSample = (sample: Sample): void => {
  console.log('fold-map benchmark')
  console.log(`lines: ${sample.lines.toLocaleString()}`)
  console.log(`folds: ${sample.folds}`)
  console.log(`points per round trip: ${sample.points}`)
  console.log(`warmup iterations: ${sample.warmupIterations}`)
  console.log(`iterations: ${sample.iterations}`)
  console.log(`create map: ${formatMs(sample.createMs)}`)
  console.log(`average round trip: ${formatMs(sample.averageRoundTripMs)}`)
  console.log(`p95 round trip: ${formatMs(sample.p95RoundTripMs)}`)
  console.log(`worst round trip: ${formatMs(sample.worstRoundTripMs)}`)
}

const assertAcceptableRoundTrip = (sample: Sample): void => {
  if (sample.averageRoundTripMs <= MAX_AVERAGE_ROUND_TRIP_MS) return

  throw new Error(
    `average FoldMap round trip ${formatMs(sample.averageRoundTripMs)} exceeded ${formatMs(
      MAX_AVERAGE_ROUND_TRIP_MS,
    )}`,
  )
}

const sample = measure()
printSample(sample)
assertAcceptableRoundTrip(sample)
