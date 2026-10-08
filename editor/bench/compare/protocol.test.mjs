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
  assert.throws(
    () => verifyControl(sample(-Number.MAX_VALUE), sample(Number.MAX_VALUE)),
    /detected Infinity ms/,
  )
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

test('resume rejects changed served editor assets with unchanged source provenance', async () => {
  const { readServedBuilds, verifyResume } = await import('./provenance.mjs')
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { resolve } = await import('node:path')
  const directory = await mkdtemp(resolve(tmpdir(), 'singapore-build-provenance-'))
  try {
    const ids = editors.flatMap((editor) =>
      ['core', 'typescript'].map((mode) => `${editor}-${mode}`),
    )
    for (const id of ids) {
      await mkdir(resolve(directory, id, 'assets'), { recursive: true })
      for (const file of ['index.html', 'entry.js', 'assets/worker.js', 'assets/style.css'])
        await writeFile(resolve(directory, id, file), `${id}: ${file}`)
    }
    const recorded = {
      git: 'unchanged-head',
      benchmarkSha256: 'unchanged-harness',
      rootLockSha256: 'unchanged-lock',
      versions: { singapore: '0.2.6' },
      builds: await readServedBuilds(directory),
      bundles: [{ id: 'minimal', files: [{ sha256: 'unchanged-minimal' }] }],
    }
    assert.doesNotThrow(() => verifyResume(recorded, structuredClone(recorded)))
    for (const file of [
      'singapore-typescript/assets/worker.js',
      'monaco-typescript/entry.js',
      'codemirror-typescript/index.html',
      'singapore-core/assets/style.css',
    ]) {
      const path = resolve(directory, file)
      const original = await readFile(path)
      await writeFile(path, 'changed product build from dirty source')
      const current = { ...recorded, builds: await readServedBuilds(directory) }
      assert.throws(() => verifyResume(recorded, current), /Resume differs in builds/)
      await writeFile(path, original)
    }
    const extra = resolve(directory, 'singapore-typescript/assets/new.wasm')
    await writeFile(extra, 'new lazy grammar')
    const added = { ...recorded, builds: await readServedBuilds(directory) }
    assert.throws(() => verifyResume(recorded, added), /Resume differs in builds/)
    await rm(extra)
    assert.throws(
      () => verifyResume({ ...recorded, builds: undefined }, recorded),
      /requires recorded/,
    )
    assert.throws(() => verifyResume({ ...recorded, builds: [] }, recorded), /requires recorded/)
    assert.throws(() => verifyResume(recorded, { ...recorded, bundles: [] }), /differs in bundles/)
    await rm(resolve(directory, 'singapore-typescript/entry.js'))
    await assert.rejects(readServedBuilds(directory), /Incomplete served build/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('positive control rejects missing, failed, unmatched and nonfinite observations', async () => {
  const { verifyControl } = await import('./verify-control.mjs')
  const { readFile } = await import('node:fs/promises')
  const { gunzipSync } = await import('node:zlib')
  const evidence = new URL('../../docs/performance/browser-compare-2026-10-08/', import.meta.url)
  const baseline = JSON.parse(gunzipSync(await readFile(new URL('pilot.json.gz', evidence))))
  const control = JSON.parse(gunzipSync(await readFile(new URL('control-120.json.gz', evidence))))
  assert.equal(verifyControl(baseline, control).length, 3)
  for (const samples of [
    [],
    baseline.samples.map((row) => ({ ...row, status: 'failed' })),
    baseline.samples.map((row) => ({ ...row, mib: 50 })),
    baseline.samples.filter((row) => row.editor !== 'singapore'),
  ])
    assert.throws(() => verifyControl({ ...baseline, samples }, control), /baseline observations/)
  const missingLocation = structuredClone(baseline)
  missingLocation.samples[0].typing.end.raw = []
  assert.throws(() => verifyControl(missingLocation, control), /baseline observations/)
  const extraFixture = structuredClone(control)
  extraFixture.samples.push({ ...extraFixture.samples[0], mib: 50 })
  assert.throws(() => verifyControl(baseline, extraFixture), /baseline observations.*50 MiB/)
  for (const value of [NaN, Infinity, undefined]) {
    const invalid = structuredClone(baseline)
    invalid.samples[0].typing.end.raw[0].mutationMs = value
    assert.throws(() => verifyControl(invalid, control), /Nonfinite baseline observations/)
    const invalidControl = structuredClone(control)
    invalidControl.samples[0].typing.middle.raw[0].mutationMs = value
    assert.throws(() => verifyControl(baseline, invalidControl), /Nonfinite control observations/)
  }
  assert.throws(() => verifyControl(baseline, { ...control, samples: [] }), /control observations/)
  const failedControl = {
    ...control,
    samples: control.samples.map((row) => ({ ...row, status: 'failed' })),
  }
  assert.throws(() => verifyControl(baseline, failedControl), /control observations/)
})
