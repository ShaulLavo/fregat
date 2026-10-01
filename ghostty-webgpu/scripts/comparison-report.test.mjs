import { test } from 'node:test'
import assert from 'node:assert/strict'
import { droppedFrames, markdown, order, quantile, summaries } from './comparison-report.mjs'

test('median averages the middle pair and p95 uses nearest rank', () => {
  assert.equal(quantile([4, 1, 3, 2], 0.5), 2.5)
  assert.equal(
    quantile(
      Array.from({ length: 20 }, (_, index) => index + 1),
      0.95,
    ),
    19,
  )
  assert.throws(() => quantile([], 0.5))
  assert.throws(() => quantile([NaN], 0.5))
})

test('library order reverses and rotates without dropping variants', () => {
  const variants = ['native', 'webgl', 'dom', 'legacy']
  assert.deepEqual(order(variants, 0), variants)
  assert.deepEqual(order(variants, 1), ['legacy', 'dom', 'webgl', 'native'])
  assert.deepEqual(order(variants, 2), ['webgl', 'dom', 'legacy', 'native'])
})

test('dropped-frame inference respects the measured display period', () => {
  assert.equal(droppedFrames([8.3, 16.6, 24.9], 8.3), 3)
  assert.equal(droppedFrames([16.6, 33.2, 49.8], 16.6), 3)
  assert.throws(() => droppedFrames([1], 0))
})

test('results take medians across repetitions and preserve negative memory noise', () => {
  const runs = [1, 3, 2].map((value) => ({
    variant: 'ghostty-webgpu',
    path: 'bytes',
    count: 1,
    parse: { ascii: { bytes: value * 1_000_000, milliseconds: 1000 } },
    latency: { write: [value, value + 1] },
    memory: {
      empty: { heap: { usedSize: 20, backingStorageSize: 0 } },
      initial: { heap: { usedSize: 10, backingStorageSize: 0 }, wasmBytes: 65536 },
      history: { heap: { usedSize: 30, backingStorageSize: 0 }, wasmBytes: 65536 },
    },
  }))
  runs.push({
    variant: 'ghostty-webgpu',
    path: 'bytes',
    count: 1,
    error: 'failed',
    parse: { ascii: { bytes: 999999999, milliseconds: 1 } },
  })
  const rows = summaries({ runs })
  assert.equal(rows.find(({ metric }) => metric === 'parse/ascii').median, 2)
  assert.equal(rows.find(({ metric }) => metric === 'write/p50').median, 2.5)
  assert.equal(rows.find(({ metric }) => metric === 'memory/terminal').median, -10 / 1048576)
  assert.equal(rows.find(({ metric }) => metric === 'parse/ascii').repetitions, 3)
})

test('software smoke never produces a results document', () => {
  assert.throws(() => markdown({ smoke: true, hardware: false }))
})
