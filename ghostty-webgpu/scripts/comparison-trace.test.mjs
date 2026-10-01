import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertDisplay,
  discardTraceWindow,
  displaySummary,
  prepareTraceOutput,
  summarizeRecords,
  tracePhase,
} from './comparison-trace.mjs'
import { EventEmitter } from 'node:events'

test('display qualification accepts skipped frames and requires a visible 60 Hz median', () => {
  const probe = displaySummary([...Array(110).fill(16.67), ...Array(9).fill(33.33), 150], {
    visibility: 'visible',
    focus: true,
  })
  assert.equal(assertDisplay(probe), 16.67)
  assert.equal(probe.frameCount, 120)
  assert.equal(probe.p95, 33.33)
  assert.equal(probe.max, 150)
  assert.throws(() => assertDisplay({ ...probe, visibility: 'hidden' }), /Mac display unavailable/)
  for (const periods of [
    [],
    Array(20).fill(0),
    Array(20).fill(1000),
    Array(20).fill(33.33),
    Array(20).fill(14.9),
    Array(20).fill(18.5),
  ]) {
    assert.throws(
      () => assertDisplay(displaySummary(periods, { visibility: 'visible' })),
      /Mac display unavailable/,
    )
  }
})

test('mounted workload cadence is retained after idle display qualification', () => {
  const idle = displaySummary(Array(120).fill(16.67), { visibility: 'visible' })
  const mounted = displaySummary(Array(120).fill(33.33), { visibility: 'visible' })
  assert.equal(assertDisplay(idle), 16.67)
  assert.equal(assertDisplay(mounted, { idle: false }), 33.33)
  assert.throws(() => assertDisplay(mounted), /Mac display unavailable/)
})

test('category shares use exclusive spans and preserve per-terminal counts', () => {
  const result = summarizeRecords({
    spans: [
      { category: 'snapshot', self: 9 },
      { category: 'damage', self: 1 },
    ],
    counters: [
      { terminal: 0, operation: 'frames', value: 1 },
      { terminal: 0, operation: 'bufferBytes', value: 80 },
      { terminal: 0, operation: 'bufferBytes', value: 160 },
      { terminal: 1, operation: 'frames', value: 2 },
    ],
  })
  assert.deepEqual(result.milliseconds, { snapshot: 9, damage: 1 })
  assert.deepEqual(result.shares, { snapshot: 90, damage: 10 })
  assert.deepEqual(result.byTerminal, { 0: { frames: 1, bufferBytes: 240 }, 1: { frames: 2 } })
})

test('frame counts match each terminal interval and ownership uses object identities', () => {
  const result = summarizeRecords({
    spans: [
      { terminal: 0, operation: 'drawFrame', start: 10, end: 12, category: 'js', self: 1 },
      { terminal: 1, operation: 'drawFrame', start: 13, end: 15, category: 'js', self: 1 },
    ],
    counters: [
      { terminal: 0, time: 9, operation: 'bufferBytes', value: 500 },
      { terminal: 0, time: 11, operation: 'bufferBytes', value: 80 },
      { terminal: 1, time: 11, operation: 'bufferBytes', value: 90 },
      { terminal: 1, time: 14, operation: 'submissions', value: 1 },
    ],
    ownership: [
      { terminal: 0, scheduler: 0, device: 1, queue: 2, pipelines: [3, 4] },
      { terminal: 1, scheduler: 5, device: 1, queue: 2, pipelines: [3, 4] },
    ],
  })
  assert.deepEqual(
    result.frames.map((frame) => frame.counts),
    [{ bufferBytes: 80 }, { submissions: 1 }],
  )
  assert.deepEqual(result.ownership, { scheduler: 2, device: 1, queue: 1, pipelines: 2 })
})

test('failed display qualification discards current and completed cases in a fresh output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ghostty-trace-cleanup-'))
  try {
    const output = join(root, 'window')
    await prepareTraceOutput(output)
    for (const name of [
      'finished.trace.json.gz',
      'current.trace.json.gz',
      'current.png',
      'comparison.json',
    ]) {
      await writeFile(join(output, name), 'owned')
    }
    await writeFile(join(output, 'qualification.json'), 'failed probe retained')
    await writeFile(join(root, 'previous-window.json'), 'retained')
    await assert.rejects(prepareTraceOutput(output), { code: 'EEXIST' })
    await discardTraceWindow(output)
    assert.deepEqual(await readdir(output), ['qualification.json'])
    assert.equal(
      await readFile(join(output, 'qualification.json'), 'utf8'),
      'failed probe retained',
    )
    assert.equal(await readFile(join(root, 'previous-window.json'), 'utf8'), 'retained')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a CPU qualification failure stops recording and drains the Chrome trace stream', async () => {
  const calls = []
  const session = new EventEmitter()
  let samples = 0
  session.send = async (name) => {
    calls.push(name)
    if (name === 'SystemInfo.getProcessInfo') {
      samples++
      return { processInfo: [{ id: samples, type: 'renderer', cpuTime: 0 }] }
    }
    if (name === 'Tracing.end') session.emit('Tracing.tracingComplete', { stream: 'trace' })
    if (name === 'IO.read') return { data: '{"traceEvents":[]}', eof: true }
    return {}
  }
  const page = {
    evaluate: async (callback) => {
      calls.push(callback.toString().includes('traceBegin') ? 'record-begin' : 'record-end')
      return { spans: [], counters: [], markers: [], ownership: [] }
    },
  }
  await assert.rejects(
    tracePhase({
      page,
      browserSession: session,
      traced: true,
      operation: async () => ({}),
      label: 'failure',
      output: tmpdir(),
    }),
    /process/i,
  )
  assert(calls.includes('record-end'))
  assert(calls.includes('Tracing.end'))
  assert(calls.includes('IO.read'))
  assert(calls.includes('IO.close'))
})
