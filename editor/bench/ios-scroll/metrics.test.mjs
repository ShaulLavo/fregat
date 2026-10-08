import { test } from 'node:test'
import assert from 'node:assert/strict'
import { geometrySample, summarize } from './metrics.mjs'

test('native document rows have zero lag at fractional scroll offsets', () => {
  const result = geometrySample({
    firstIndex: 40,
    lastIndex: 80,
    firstTop: -140.5,
    lastBottom: 679.5,
    viewportTop: 60,
    viewportHeight: 400,
    scrollTop: 1000.5,
    rowHeight: 20,
  })
  assert.equal(result.lagPx, 0)
  assert.equal(result.blankPx, 0)
})
test('stale sticky paint and a missing lower window are detected', () => {
  const result = geometrySample({
    firstIndex: 40,
    lastIndex: 60,
    firstTop: 60,
    lastBottom: 260,
    viewportTop: 60,
    viewportHeight: 400,
    scrollTop: 1000,
    rowHeight: 20,
  })
  assert.equal(result.lagPx, -200)
  assert.equal(result.blankPx, 200)
})
test('unsupported metrics stay null and quiet frames do not skew moving summaries', () => {
  const result = summarize({
    events: [],
    longTasksSupported: false,
    longTasks: [],
    frames: [
      { moving: false, dt: 1000, lagPx: 100, blankPx: 300, measurementCostMs: 1 },
      { moving: true, dt: 16, lagPx: null, blankPx: null, measurementCostMs: 2 },
    ],
  })
  assert.equal(result.frameIntervalP95Ms, 16)
  assert.equal(result.absoluteLagP95Px, null)
  assert.equal(result.longTasks, null)
  assert.equal(result.blankFrames, null)
})
