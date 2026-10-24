import { performance } from 'node:perf_hooks'

import {
  createPieceTableSnapshot,
  insertIntoPieceTable,
  materializePieceTableFullText,
} from '@singapore-editor/textbuffer'

type Sample = {
  label: string
  insertionCount: number
  textLength: number
  pieceCount: number
  averageMs: number
  minBatchMs: number
  maxBatchMs: number
  firstMeasuredBatchMs: number
  lastMeasuredBatchMs: number
  growthRatio: number
}

const INSERTION_COUNT = 2_000
const INSERTION_TEXT = 'x'.repeat(1_024)
const BATCH_SIZE = 100
const WARMUP_BATCHES = 2
const MAX_GROWTH_RATIO = 4

const formatMs = (value: number): string => `${value.toFixed(4)}ms`

const batchAverage = (batches: readonly number[], start: number, count: number): number => {
  const selected = batches.slice(start, start + count)
  const total = selected.reduce((sum, value) => sum + value, 0)
  return total / selected.length
}

const measureAppendInsertions = (): Sample => {
  let snapshot = createPieceTableSnapshot('')
  const batchDurations: number[] = []
  const benchmarkStart = performance.now()

  for (let index = 0; index < INSERTION_COUNT; index += BATCH_SIZE) {
    const batchStart = performance.now()

    for (let batchIndex = 0; batchIndex < BATCH_SIZE; batchIndex++) {
      snapshot = insertIntoPieceTable(snapshot, snapshot.length, INSERTION_TEXT)
    }

    batchDurations.push(performance.now() - batchStart)
  }

  const text = materializePieceTableFullText(snapshot)
  const expectedLength = INSERTION_COUNT * INSERTION_TEXT.length
  if (text.length !== expectedLength) {
    throw new Error(`expected final length ${expectedLength}, got ${text.length}`)
  }

  const measuredBatches = batchDurations.slice(WARMUP_BATCHES)
  const firstMeasuredBatchMs = batchAverage(measuredBatches, 0, 3)
  const lastMeasuredBatchMs = batchAverage(measuredBatches, measuredBatches.length - 3, 3)
  const growthRatio = lastMeasuredBatchMs / firstMeasuredBatchMs

  return {
    label: 'append 2,000 x 1 KiB insertions',
    insertionCount: INSERTION_COUNT,
    textLength: text.length,
    pieceCount: snapshot.pieceCount,
    averageMs: (performance.now() - benchmarkStart) / INSERTION_COUNT,
    minBatchMs: Math.min(...measuredBatches),
    maxBatchMs: Math.max(...measuredBatches),
    firstMeasuredBatchMs,
    lastMeasuredBatchMs,
    growthRatio,
  }
}

const printSample = (sample: Sample): void => {
  console.log(`piece-table insertion benchmark: ${sample.label}`)
  console.log(`insertions: ${sample.insertionCount}`)
  console.log(`final text length: ${sample.textLength}`)
  console.log(`final piece count: ${sample.pieceCount}`)
  console.log(`average per insertion: ${formatMs(sample.averageMs)}`)
  console.log(`min measured batch: ${formatMs(sample.minBatchMs)}`)
  console.log(`max measured batch: ${formatMs(sample.maxBatchMs)}`)
  console.log(`first measured batch average: ${formatMs(sample.firstMeasuredBatchMs)}`)
  console.log(`last measured batch average: ${formatMs(sample.lastMeasuredBatchMs)}`)
  console.log(`growth ratio: ${sample.growthRatio.toFixed(2)}x`)
}

const assertAcceptableGrowth = (sample: Sample): void => {
  if (sample.growthRatio <= MAX_GROWTH_RATIO) return

  throw new Error(
    `insertion time grew ${sample.growthRatio.toFixed(2)}x; expected <= ${MAX_GROWTH_RATIO}x`,
  )
}

const sample = measureAppendInsertions()
printSample(sample)
assertAcceptableGrowth(sample)
