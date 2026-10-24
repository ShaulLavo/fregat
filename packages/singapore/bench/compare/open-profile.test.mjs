import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOpenProfile, installOpenProbe } from './open-profile.mjs'
import { compareOpenProfiles } from './summarize-open.mjs'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

const mark = (name, ts) => ({ name: `compare-open-${name}`, ts, pid: 1, tid: 1, ph: 'I' })
const task = (name, ts, dur, tid = 1) => ({ name, ts, dur, pid: 1, tid, ph: 'X' })

test('open work unions nested spans, clips the clock and separates rendering from workers', () => {
  const profile = summarizeOpenProfile(
    [
      mark('start', 10000),
      mark('mounted', 12000),
      mark('settled', 20000),
      task('FunctionCall', 0, 12000),
      task('FunctionCall', 12000, 2000),
      task('Layout', 13000, 3000),
      task('Paint', 19000, 5000),
      task('FunctionCall', 10000, 10000, 2),
    ],
    { messages: [], diagnostics: [] },
  )
  assert.equal(profile.completed, true)
  assert.equal(profile.mainWorkMs, 7)
  assert.equal(profile.mainRenderingMs, 4)
  assert.equal(profile.marksMs['compare-open-mounted'], 2)
  assert.equal(profile.mainTaskCount, 0)
  assert.equal(profile.largestMainTaskMs, null)
})

test('largest main task includes complete overlapping tasks and excludes worker tasks', () => {
  const profile = summarizeOpenProfile(
    [
      mark('start', 1000),
      mark('settled', 5000),
      task('ThreadControllerImpl::RunTask', 0, 2000),
      task('RunTask', 2000, 4000),
      task('RunTask', 0, 10000, 2),
    ],
    { messages: [], diagnostics: [] },
  )
  assert.equal(profile.mainTaskCount, 2)
  assert.equal(profile.largestMainTaskMs, 4)
})

test('worker round trips match worker identity and preserve incomplete requests', () => {
  const profile = summarizeOpenProfile([mark('start', 0), mark('capture-end', 30000000)], {
    messages: [
      { direction: 'sent', worker: 1, id: 1, at: 1, type: 'parse' },
      { direction: 'sent', worker: 2, id: 1, at: 2, type: 'registerLanguage' },
      { direction: 'sent', worker: 3, at: 3 },
      { direction: 'received', worker: 3, at: 4 },
      {
        direction: 'received',
        worker: 2,
        id: 1,
        at: 12,
        timings: [{ name: 'load', durationMs: 8 }],
      },
    ],
    diagnostics: [],
  })
  assert.equal(profile.completed, false)
  assert.equal(profile.requests[0].roundTripMs, null)
  assert.equal(profile.requests[1].roundTripMs, 10)
  assert.equal(profile.requests[2].roundTripMs, null)
  assert.deepEqual(profile.requests[1].timings, [{ name: 'load', durationMs: 8 }])
  assert.equal(profile.marksMs['compare-open-capture-end'], 30000)
})

test('missing clock boundaries fail instead of reporting zero work', () => {
  assert.throws(() => summarizeOpenProfile([], { messages: [] }), /open-start/)
  assert.throws(() => summarizeOpenProfile([mark('start', 0)], { messages: [] }), /open-end/)
})

test('probe preserves worker send arguments and retains timing metadata without document text', () => {
  const previous = {
    Worker: globalThis.Worker,
    diagnostics: globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__,
    probe: globalThis.__compareOpenProbe,
  }
  class WorkerControl extends EventTarget {
    postMessage(...args) {
      this.sent = args
    }
  }
  globalThis.Worker = WorkerControl
  try {
    installOpenProbe()
    const worker = new Worker('fixture')
    const request = { id: 1, payload: { type: 'parse', text: 'private text' } }
    const transfer = []
    worker.postMessage(request, transfer)
    assert.deepEqual(worker.sent, [request, transfer])
    const response = new Event('message')
    response.data = {
      id: 1,
      ok: true,
      result: { timings: [{ name: 'parseRoot', durationMs: 123 }], text: 'private text' },
    }
    worker.dispatchEvent(response)
    const probe = globalThis.__compareOpenProbe
    assert.equal(probe.messages.length, 2)
    assert.equal(probe.messages[1].timings[0].durationMs, 123)
    assert.equal(JSON.stringify(probe).includes('private text'), false)
  } finally {
    globalThis.Worker = previous.Worker
    globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = previous.diagnostics
    globalThis.__compareOpenProbe = previous.probe
  }
})

test('diagnostic profiles stay out of the comparison ranking', async () => {
  const { summary, verify } = await import('./summarize.mjs')
  const result = { config: { profileOpen: true } }
  assert.throws(() => verify(result), /summarize-open/)
  assert.throws(() => summary(result), /summarize-open/)
})

test('profile verification preserves failed opens and rejects invented parse evidence', async () => {
  const { verifyOpenProfiles, openProfileSummary } = await import('./summarize-open.mjs')
  const { editors } = await import('./protocol.mjs')
  const result = {
    config: { profileOpen: true, openOnly: true, selected: [200], repetitions: 1 },
    samples: editors.map((editor) => ({
      editor,
      mib: 200,
      repetition: 0,
      status: 'failed',
      errors: ['deadline'],
      openProfile: {
        trace: `${editor}-200-0-open.trace.json.gz`,
        mainWorkMs: 10,
        marksMs: {},
        requests: [],
      },
    })),
  }
  assert.equal(verifyOpenProfiles(result), '3 open profiles retained; 0 completed')
  assert.equal(openProfileSummary(result).groups[0].highlightedMs, null)
  const row = result.samples[0]
  row.status = 'ok'
  row.open = {
    highlightedFrameMs: 100,
    geometry: {
      width: 1280,
      height: 720,
      scrollViewport: { width: 1265, height: 720 },
      renderedRows: 50,
      visibleStyle: { fontFamily: 'monospace', fontSize: '14px', lineHeight: '20px' },
    },
  }
  row.openProfile.completed = true
  assert.throws(() => verifyOpenProfiles(result), /no worker parse measurement/)
  row.openProfile.requests = [
    { resultMode: 'parseOnly', timings: [{ name: 'treeSitter.parseRoot', durationMs: 80 }] },
  ]
  assert.equal(verifyOpenProfiles(result), '3 open profiles retained; 1 completed')
  result.samples[1] = row
  assert.throws(() => verifyOpenProfiles(result), /duplicate profile matrix/)
})

test('provisional profiles require a measured bounded bootstrap query', async () => {
  const { verifyOpenProfiles, openProfileRows } = await import('./summarize-open.mjs')
  const { editors } = await import('./protocol.mjs')
  const result = {
    config: { profileOpen: true, openOnly: true, selected: [200], repetitions: 1 },
    samples: editors.map((editor) => ({
      editor,
      mib: 200,
      repetition: 0,
      status: 'failed',
      errors: ['deadline'],
      openProfile: { trace: 'trace.json.gz', mainWorkMs: 1, marksMs: {}, requests: [] },
    })),
  }
  const row = result.samples[0]
  row.status = 'ok'
  row.open = {
    highlightedFrameMs: 100,
    geometry: {
      width: 1280,
      height: 720,
      scrollViewport: { width: 1265, height: 720 },
      renderedRows: 50,
      visibleStyle: { fontFamily: 'monospace', fontSize: '14px', lineHeight: '20px' },
    },
  }
  row.openProfile.completed = true
  row.openProfile.requests = [{ resultMode: 'bootstrap' }]
  assert.throws(() => verifyOpenProfiles(result), /no worker parse measurement/)
  row.openProfile.requests.push({
    type: 'queryRange',
    analysis: { kind: 'partial' },
    statistics: { tokens: 40, bootstrapUnits: 4096 },
    timings: [{ name: 'treeSitter.bootstrapRoot', durationMs: 3 }],
  })
  assert.equal(verifyOpenProfiles(result), '3 open profiles retained; 1 completed')
  assert.equal(openProfileRows(result)[0].bootstrapRootMs, 3)
  assert.equal(openProfileRows(result)[0].bootstrapUnits, 4096)

  result.config.fullDocument = true
  row.openProfile.requests = [
    {
      resultMode: 'full',
      returnedResult: true,
      analysis: { kind: 'full' },
      statistics: { rangeStart: 0, rangeEnd: 200 * 1024 * 1024, tokens: 100, layers: 1 },
      timings: [{ name: 'treeSitter.parseRoot', durationMs: 80 }],
    },
  ]
  assert.throws(() => verifyOpenProfiles(result), /root tree must cover/)
  row.outputProof = {
    tokenCount: 100,
    tokenSha256: 'a'.repeat(64),
    stylesSha256: 'b'.repeat(64),
    structuralSha256: 'c'.repeat(64),
    coverage: [{ kind: 'root', start: 0, end: 200 * 1024 * 1024, ranges: [] }],
    lastToken: [200 * 1024 * 1024 - 1, 200 * 1024 * 1024, 0],
    missingLanguages: [],
    queryCalls: 1,
    matchLimitExceeded: false,
  }
  assert.equal(verifyOpenProfiles(result), '3 open profiles retained; 1 completed')
  assert.equal(openProfileRows(result)[0].parseRootMs, 80)
  assert.equal(openProfileRows(result)[0].queryTokens, 100)
  row.openProfile.requests[0].degraded = [{ kind: 'timeout' }]
  assert.throws(() => verifyOpenProfiles(result), /degraded phases/)
})

test('profile rows keep the request timeline separate from nested worker phases', async () => {
  const { openProfileRows } = await import('./summarize-open.mjs')
  const { editors } = await import('./protocol.mjs')
  const result = {
    config: { profileOpen: true, openOnly: true, selected: [10], repetitions: 1 },
    samples: editors.map((editor) => ({
      editor,
      mib: 10,
      repetition: 0,
      status: 'failed',
      errors: ['deadline'],
      openProfile: {
        trace: `${editor}-10-0-open.trace.json.gz`,
        mainWorkMs: 10,
        startedAtMs: 100,
        marksMs: { 'compare-open-visible': 200 },
        diagnostics: [
          { name: 'editor.syntax.structural.apply', durationMs: 2 },
          { name: 'editor.syntax.structural.apply', durationMs: 99 },
        ],
        requests: [
          { sourceCommand: 'reset', at: 110, roundTripMs: 20, sourceCodeUnits: 10485760 },
          {
            resultMode: 'parseOnly',
            at: 140,
            roundTripMs: 100,
            timings: [{ name: 'treeSitter.parseRoot', durationMs: 90 }],
          },
          {
            type: 'queryRange',
            at: 245,
            roundTripMs: 10,
            timings: [{ name: 'treeSitter.structuralWalk', durationMs: 6 }],
            statistics: { tokens: 100, transferredTokenBytes: 1200 },
          },
        ],
      },
    })),
  }
  const [row] = openProfileRows(result)
  assert.equal(row.sourceStartMs, 10)
  assert.equal(row.parseStartMs, 40)
  assert.equal(row.parseRoundTripMs, 100)
  assert.equal(row.parseRootMs, 90)
  assert.equal(row.queryStartMs, 145)
  assert.equal(row.structuralWalkMs, 6)
  assert.equal(row.structuralApplyMs, 2)
  assert.equal(row.queryTokenBytes, 1200)
  result.samples[0].openProfile.requests.push(
    {
      resultMode: 'full',
      returnedResult: true,
      timings: [
        { name: 'treeSitter.parse', durationMs: 50 },
        { name: 'treeSitter.query', durationMs: 80 },
      ],
      statistics: { tokens: 100 },
    },
    {
      resultMode: 'full',
      returnedResult: true,
      timings: [
        { name: 'treeSitter.parse', durationMs: 60 },
        { name: 'treeSitter.query', durationMs: 90 },
      ],
      statistics: { tokens: 200 },
    },
  )
  const [retried] = openProfileRows(result)
  assert.equal(retried.fullAttempts, 2)
  assert.equal(retried.fullWorkerWorkMs, 280)
  assert.equal(retried.queryTokens, 200)
})

test('diagnostic comparison retains failed groups and rejects changed measurement contracts', async () => {
  const path = new URL(
    '../../docs/performance/singapore-open-2026-10-08/baseline/experiment.json.gz',
    import.meta.url,
  )
  const before = JSON.parse(gunzipSync(await readFile(path)))
  const after = structuredClone(before)
  const comparison = compareOpenProfiles(before, after)
  const successful = comparison.groups.find(
    (group) => group.editor === 'singapore' && group.mib === 10,
  )
  const failed = comparison.groups.find(
    (group) => group.editor === 'singapore' && group.mib === 200,
  )
  assert.equal(successful.medians.highlightedMs.delta, 0)
  assert.equal(failed.afterCompleted, 0)
  assert.equal(failed.medians.highlightedMs.delta, null)
  for (const key of ['config', 'machine', 'browser', 'versions', 'fixtures']) {
    const changed = { ...after, [key]: 'changed' }
    assert.throws(() => compareOpenProfiles(before, changed), /differs in/)
  }
  const changed = structuredClone(after)
  changed.bundles.find((bundle) => bundle.id === 'monaco-typescript').files[0].sha256 = 'changed'
  assert.throws(() => compareOpenProfiles(before, changed), /competitor bundles/)
})

test('retention inspection fences every observed worker with distinct request IDs', async () => {
  const originalWorker = globalThis.Worker
  const previousProbe = globalThis.__compareOpenProbe
  const diagnostics = globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__
  const ids = []
  class WorkerControl extends EventTarget {
    postMessage(request) {
      assert.deepEqual(request.payload, { type: 'idleFence', includeRetention: true })
      ids.push(request.id)
      queueMicrotask(() => {
        const event = new Event('message')
        event.data = { id: request.id, ok: true, result: { retention: { documentCount: 1 } } }
        this.dispatchEvent(event)
      })
    }
  }
  try {
    globalThis.Worker = WorkerControl
    installOpenProbe()
    new Worker('first')
    new Worker('second')
    const retention = await globalThis.__compareOpenProbe.inspectRetention()
    assert.deepEqual(retention, [
      { worker: 1, documentCount: 1 },
      { worker: 2, documentCount: 1 },
    ])
    assert.equal(new Set(ids).size, 2)
    assert.ok(ids.every((id) => id < 0))
  } finally {
    globalThis.Worker = originalWorker
    globalThis.__compareOpenProbe = previousProbe
    globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = diagnostics
  }
})

test('worker replies retain only the latest full payload with a monotonic counter', () => {
  const originalWorker = globalThis.Worker
  const previousProbe = globalThis.__compareOpenProbe
  const diagnostics = globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__
  try {
    globalThis.Worker = class extends EventTarget {}
    installOpenProbe()
    const worker = new Worker()
    const replies = [1, 2, 3].map((id) => ({ tokensPacked: { starts: new Uint32Array([id]) } }))
    for (const result of replies) {
      const event = new Event('message')
      event.data = { result }
      worker.dispatchEvent(event)
    }
    assert.deepEqual(globalThis.__compareOpenProbe.outputs, [replies[2]])
    assert.equal(globalThis.__compareOpenProbe.outputCount, 3)
    assert.ok(globalThis.__compareOpenProbe.messages.every((message) => !message.tokensPacked))
  } finally {
    globalThis.Worker = originalWorker
    globalThis.__compareOpenProbe = previousProbe
    globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = diagnostics
  }
})
