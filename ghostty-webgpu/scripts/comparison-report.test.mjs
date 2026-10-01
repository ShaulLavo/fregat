import { PNG } from 'pngjs'
import { ink } from './comparison-pixels.mjs'
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

test('qualified parser measurements survive a later rendering failure', () => {
  const run = {
    variant: 'ghostty-web',
    path: 'bytes',
    count: 1,
    error: 'history failed',
    parseQualified: true,
    parse: { ascii: { bytes: 1_000_000, milliseconds: 100 } },
    latency: { write: [1, 2] },
  }
  const rows = summaries({ runs: [run] })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].metric, 'parse/ascii')
  assert.equal(rows[0].median, 10)
})

test('output memory keeps retained storage, WASM capacity, and RSS separate', () => {
  const snapshot = (usedSize, backingStorageSize, wasmBytes, rssBytes) => ({
    heap: { usedSize, backingStorageSize },
    wasmBytes,
    rssBytes,
  })
  const rows = summaries({
    runs: [
      {
        variant: 'ghostty-webgpu',
        path: 'bytes',
        count: 8,
        memory: {
          empty: snapshot(1_048_576, 0, 0, 10_485_760),
          initial: snapshot(2_097_152, 0, 1_048_576, 12_582_912),
          history: snapshot(3_145_728, 0, 2_097_152, 14_680_064),
        },
        output: {
          cpu: { percentOfOneCore: 0 },
          memory: snapshot(4_194_304, 1_048_576, 2_097_152, 16_777_216),
        },
      },
    ],
  })
  assert.equal(rows.find(({ metric }) => metric === 'memory/output/terminal').median, 0.5)
  assert.equal(rows.find(({ metric }) => metric === 'memory/output/wasm').median, 2)
  assert.equal(rows.find(({ metric }) => metric === 'memory/output/rss-delta').median, 6)
})

test('thin antialiased glyphs qualify without counting neutral or transparent ink', () => {
  const png = new PNG({ width: 5, height: 1 })
  png.data.set([0, 95, 0, 255, 100, 0, 0, 255, 255, 255, 255, 255, 80, 80, 80, 255, 0, 255, 0, 0])
  const colors = ink(PNG.sync.write(png).toString('base64'))
  assert.equal(colors.green, 1)
  assert.equal(colors.red, 1)
  assert.equal(colors.greenPeak, 95)
  assert.equal(colors.redPeak, 100)
})
