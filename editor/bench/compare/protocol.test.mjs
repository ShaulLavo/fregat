import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixture.mjs'
import {
  fixtureIdentity,
  order,
  summarize,
  scrollCosts,
  scrollTraceName,
  editors,
} from './protocol.mjs'

test('fixtures are exact MiB, ASCII and deterministic', () => {
  for (const mib of [1, 10]) {
    const text = fixture(mib)
    assert.equal(Buffer.byteLength(text), mib * 1024 * 1024)
    assert.equal(fixtureIdentity(mib).sha256, fixtureIdentity(mib).sha256)
    assert.ok(text.startsWith('export const value: number'))
  }
})
test('rotation gives every editor each run position', () => {
  for (let position = 0; position < 3; position++)
    assert.deepEqual([0, 1, 2].map((rep) => order(rep)[position]).sort(), [...editors].sort())
})
test('percentiles use nearest rank and preserve slow samples', () => {
  assert.deepEqual(summarize([4, 1, 2, 100]), { n: 4, p50: 2, p95: 100, max: 100 })
})
test('representative trace names preserve editor and fixture size', () => {
  const names = editors.flatMap((editor) => [1, 10].map((mib) => scrollTraceName(editor, mib)))
  assert.equal(new Set(names).size, 6)
  assert.equal(scrollTraceName('singapore', 1), 'singapore-1-scroll.trace.json.gz')
  assert.equal(scrollTraceName('singapore', 10), 'singapore-10-scroll.trace.json.gz')
})
test('scroll costs union script and rendering spans, clip frames, and filter threads', () => {
  const event = (name, ts, dur, tid = 1) => ({ name, ts, dur, ph: 'X', pid: 1, tid })
  const events = [
    event('Paint', 10000, 2000),
    event('Layout', 11000, 3000),
    event('FunctionCall', 13000, 3000),
    event('Paint', 19000, 5000),
    event('Paint', 25000, 5000),
    event('Layout', 0, 20000, 2),
  ]
  assert.deepEqual(scrollCosts(events, [0, 20000], { pid: 1, tid: 1 }).samplesMs, [7])
})

test('summary retains failures and verification rejects duplicates', async () => {
  const { summary, verify } = await import('./summarize.mjs')
  const failed = {
    config: { selected: [50], repetitions: 1 },
    bundles: [],
    samples: editors.map((editor) => ({
      editor,
      mib: 50,
      repetition: 0,
      status: 'timeout',
      errors: ['deadline'],
    })),
  }
  assert.equal(summary(failed).rows[0].successful, 0)
  assert.equal(summary(failed).rows[0].failures[0].status, 'timeout')
  assert.equal(verify(failed), '3 samples retained; 0 usable')
  failed.samples[1] = failed.samples[0]
  assert.throws(() => verify(failed), /Duplicate sample identities/)
})

test('verification requires trusted rendered input and scroll evidence', async () => {
  const { verify } = await import('./summarize.mjs')
  const result = {
    config: { selected: [1], repetitions: 1, keys: 1, frames: 10 },
    samples: editors.map((editor) => ({
      editor,
      mib: 1,
      repetition: 0,
      status: 'ok',
      open: {
        geometry: {
          width: 1280,
          height: 720,
          scrollViewport: { width: 1265, height: 720 },
          renderedRows: 50,
          visibleStyle: { fontFamily: 'monospace', fontSize: '14px', lineHeight: '20px' },
        },
      },
      typing: Object.fromEntries(
        ['end', 'middle'].map((where) => [
          where,
          {
            raw: [{ trusted: true, rendered: true, inputToFrameMs: 20 }],
          },
        ]),
      ),
      scroll: { rendering: { ms: { n: 10 } } },
    })),
  }
  assert.equal(verify(result), '3 samples retained; 3 usable')
  result.samples[0].open.geometry.visibleStyle.fontSize = '16px'
  assert.throws(() => verify(result), /differs from the protocol/)
  result.samples[0].open.geometry.visibleStyle.fontSize = '14px'
  const key = result.samples[0].typing.end.raw[0]
  key.trusted = false
  assert.throws(() => verify(result), /Invalid input evidence/)
  key.trusted = true
  key.rendered = false
  assert.throws(() => verify(result), /Invalid input evidence/)
  key.rendered = true
  result.samples[0].scroll.rendering.ms.n = 0
  assert.throws(() => verify(result), /Missing scroll frames/)
})

test('geometry check rejects the missing editor stylesheet observation', async () => {
  const { verifyGeometry } = await import('./protocol.mjs')
  const geometry = {
    width: 1280,
    height: 720,
    scrollViewport: { width: 1265, height: 720 },
    renderedRows: 50,
    visibleStyle: { fontFamily: 'Times New Roman', fontSize: '16px', lineHeight: 'normal' },
  }
  assert.throws(() => verifyGeometry({ geometry }), /differs from the protocol/)
  geometry.visibleStyle = { fontFamily: 'monospace', fontSize: '14px', lineHeight: '20px' }
  assert.doesNotThrow(() => verifyGeometry({ geometry }))
})

test('positive control exceeds a frame wait and detects injected handler work', async () => {
  const { verifyControl } = await import('./verify-control.mjs')
  const sample = (mutationMs) => ({
    config: { delayMs: 120 },
    samples: editors.map((editor) => ({
      editor,
      mib: 1,
      status: 'ok',
      typing: Object.fromEntries(
        ['end', 'middle'].map((where) => [where, { raw: [{ mutationMs }] }]),
      ),
    })),
  })
  const baseline = sample(16)
  const control = sample(121)
  assert.ok(verifyControl(baseline, control).every((row) => row.deltaMs === 105))
  baseline.samples.push(...sample(1000).samples.map((row) => ({ ...row, mib: 10 })))
  assert.ok(verifyControl(baseline, control).every((row) => row.deltaMs === 105))
  control.config.delayMs = 30
  assert.throws(() => verifyControl(baseline, control), /at least 100 ms/)
  control.config.delayMs = 120
  control.samples[0].typing.end.raw[0].mutationMs = 40
  control.samples[0].typing.middle.raw[0].mutationMs = 40
  assert.throws(() => verifyControl(baseline, control), /detected 24 ms/)
})

test('a genuine large-file failure remains a measured outcome', async () => {
  const { summary, verify } = await import('./summarize.mjs')
  const result = {
    config: { selected: [10], repetitions: 1 },
    bundles: [],
    samples: editors.map((editor) => ({
      editor,
      mib: 10,
      repetition: 0,
      status: 'failed',
      errors: ['keyboard.press: Target crashed'],
    })),
  }
  assert.equal(verify(result), '3 samples retained; 0 usable')
  assert.equal(summary(result).rows[0].attempted, 1)
  assert.equal(summary(result).rows[0].successful, 0)
  result.samples[0].errors = []
  assert.throws(() => verify(result), /no retained error/)
  result.samples[0].status = 'unreported'
  assert.throws(() => verify(result), /Unknown sample outcome/)
})

test('geometry rejects an unconstrained scroll viewport and unbounded row pool', async () => {
  const { verifyGeometry } = await import('./protocol.mjs')
  const geometry = {
    width: 1280,
    height: 720,
    visibleStyle: { fontFamily: 'monospace', fontSize: '14px', lineHeight: '20px' },
    scrollViewport: { width: 1280, height: 3624 },
    renderedRows: 180,
  }
  assert.throws(() => verifyGeometry({ geometry }), /differs from the protocol/)
  geometry.scrollViewport.height = 720
  geometry.renderedRows = 10000
  assert.throws(() => verifyGeometry({ geometry }), /differs from the protocol/)
  geometry.renderedRows = 50
  assert.doesNotThrow(() => verifyGeometry({ geometry }))
})
