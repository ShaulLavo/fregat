import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import {
  corpus,
  fixtureText,
  rollingFixture,
  rollingInputs,
  rollingByteCount,
  settings,
} from '../bench/comparison-fixtures.ts'
import { expectedScreen, pacedBurst } from '../bench/comparison-protocol.ts'
import { frameMetricDeltas } from '../bench/comparison-metrics.ts'

const transpiler = new Bun.Transpiler({ loader: 'ts' })
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const entry = await readFile(new URL('../bench/comparison-entry.ts', import.meta.url), 'utf8')
const runner = await readFile(new URL('./comparison-runner.mjs', import.meta.url), 'utf8')
function functionSource(signature, nextSignature) {
  const start = entry.indexOf(signature)
  const end = entry.indexOf(nextSignature, start)
  assert(start >= 0 && end > start)
  return transpiler.transformSync(entry.slice(start, end))
}
const createBurst = new Function(
  'dependencies',
  `
  const { rollingFixture, rollingInputs, rollingByteCount, corpus, fixtureText,
    settings, encoder, drivers, current, logs, frame, performance, pacedBurst, frameMetricDeltas } = dependencies;
  ${functionSource('async function settle(', '\nfunction input(')}
  ${functionSource('function input(', '\nfunction configureNativeHistory(')}
  ${functionSource('async function writeAll(', '\nasync function correctness(')}
  ${functionSource('async function rollingBurst(', '\nasync function history(')}
  return burst;
`,
)

function burstHarness(path, logs) {
  const writes = [[], []]
  const events = []
  let time = 0
  const fixtureSettings = { ...settings, corpusBytes: 40, chunkBytes: 7 }
  const burst = createBurst({
    rollingFixture: (text) =>
      rollingFixture(text, fixtureSettings.corpusBytes, fixtureSettings.chunkBytes),
    rollingInputs,
    rollingByteCount,
    corpus,
    fixtureText,
    settings: fixtureSettings,
    encoder,
    current: { path },
    logs,
    pacedBurst,
    frameMetricDeltas,
    drivers: writes.map((received, index) => ({
      write: async (data) => {
        received.push(data)
        events.push(`write:${index}`)
      },
    })),
    frame: async () => {
      events.push('frame')
      return ++time
    },
    performance: { now: () => time },
  })
  return { burst, writes, events, fixture: rollingFixture(logs, 40, 7) }
}

test('rolling chunks end on complete UTF-8 codepoints and string/byte paths match', () => {
  for (const chunkBytes of [4, 5, 7, 4096]) {
    const fixture = rollingFixture('a日本語é🧪\n', 100, chunkBytes)
    const strings = rollingInputs(fixture, 'string')
    assert.equal(rollingInputs(fixture, 'bytes'), fixture.chunks)
    for (const [index, chunk] of fixture.chunks.entries()) {
      assert(chunk.length > 0 && chunk.length <= chunkBytes)
      assert.equal(decoder.decode(chunk), strings[index])
      assert.deepEqual(encoder.encode(strings[index]), chunk)
    }
    assert.deepEqual(Buffer.concat(fixture.chunks), Buffer.from(fixture.bytes))
    for (const frames of [0, 1, fixture.chunks.length, fixture.chunks.length + 3]) {
      const actual = Array.from(
        { length: frames },
        (_, index) => fixture.chunks[index % fixture.chunks.length],
      ).reduce((total, chunk) => total + chunk.length, 0)
      assert.equal(rollingByteCount(fixture, frames), actual)
    }
  }
})

test('real Git-history corpus advances between distinct complete UTF-8 chunks', async () => {
  const logs = await readFile(new URL('../bench/fixtures/git-history.txt', import.meta.url), 'utf8')
  const fixture = rollingFixture(logs)
  assert(fixture.bytes.length >= settings.corpusBytes)
  assert.notDeepEqual(fixture.chunks[0], fixture.chunks[1])
  assert.deepEqual(Buffer.concat(fixture.chunks), Buffer.from(fixture.bytes))
  for (const chunk of fixture.chunks) decoder.decode(chunk)
  assert.equal(
    decoder.decode(fixture.bytes),
    corpus(fixtureText('logs', logs), settings.corpusBytes),
  )
})

for (const path of ['bytes', 'string']) {
  test(`actual ${path} burst advances once per paced frame, wraps and resets after warmup`, async () => {
    const { burst, writes, events, fixture } = burstHarness(path, 'aé🧪 history\n')
    await burst('rolling-logs', 2)
    writes.forEach((received) => received.splice(0))
    events.splice(0)
    const frames = fixture.chunks.length + 2
    const result = await burst('rolling-logs', frames)
    const expected = rollingInputs(fixture, path)
    for (const received of writes) {
      assert.equal(received.length, frames + 1)
      assert.equal(typeof received[0], path === 'bytes' ? 'object' : 'string')
      assert.equal(
        path === 'bytes' ? decoder.decode(received[0]) : received[0],
        '\x1b[3J\x1b[2J\x1b[H',
      )
      for (let index = 0; index < frames; index++) {
        assert.deepEqual(received[index + 1], expected[index % expected.length])
        assert.equal(received[index + 1], writes[0][index + 1])
      }
    }
    assert.equal(events.filter((event) => event === 'frame').length, frames + 5)
    assert.equal(result.fixture, 'rolling-logs')
    assert.equal(result.chunkCount, expected.length)
    assert.equal(result.reset, 'corpus-start')
    assert.equal(result.completedCycles, Math.floor(frames / expected.length))
    assert.equal(result.nextChunk, frames % expected.length)
    assert.equal(result.bytes, rollingByteCount(fixture, frames) * writes.length)
    assert.deepEqual(result.intervals, Array(frames).fill(1))
  })
}

test('rolling parser uses the wrapped-log oracle', () => {
  assert.deepEqual(
    expectedScreen('rolling-logs', 'abcdef\r\n', 2, 3, 4),
    expectedScreen('logs', 'abcdef\r\n', 2, 3, 4),
  )
})

test('actual measured output and warmup select rolling logs independently of fixture probes', async () => {
  const start = runner.indexOf("    if (phases.includes('output')) {")
  const end = runner.indexOf('\n    assert.deepEqual(errors, [])', start)
  assert(start >= 0 && end > start)
  const runOutput = new Function(
    'dependencies',
    `
    return (async () => {
      const { phases, run, selectedOutputFixture, page, qualifiedWindow, measureCpu,
        browserSession, outputFrames, cpuOptions, manifest } = dependencies;
      ${runner.slice(start, end)}
    })();
  `,
  )
  const { burst, writes } = burstHarness('bytes', 'advancing history\n')
  const phases = []
  const run = {}
  await runOutput({
    phases: ['output'],
    run,
    selectedOutputFixture: 'rolling-logs',
    manifest: { fixtures: [{ name: 'rolling-logs' }] },
    outputFrames: 5,
    cpuOptions: {},
    browserSession: {},
    page: {
      evaluate: (callback, argument) =>
        runInNewContext(`(${callback})`, { window: { __compare: { burst } } })(argument),
    },
    qualifiedWindow: async (_run, label, operation) => {
      phases.push(label)
      return operation()
    },
    measureCpu: async (_session, operation) => ({ sample: await operation(), cpu: {} }),
  })
  assert.deepEqual(phases, ['output/rolling-logs'])
  assert.equal(run.phase, 'output/rolling-logs')
  assert.equal(run.output.fixture, 'rolling-logs')
  assert.equal(run.output.intervals.length, 5)
  assert.equal(writes[0].length, 10)
})
