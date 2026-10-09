import assert from 'node:assert/strict'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPieceTableSnapshot, CharIdAllocator } from '@singapore-editor/textbuffer'
import { ConfirmedWindow, TextbufferEngine } from '../dist/index.js'

const lines = 100_000
const text = 'export const value = 1234567890;\n'.repeat(lines)
const original = createPieceTableSnapshot(text, {
  normalized: true,
  charIds: { bunch: 'initial', counter: 0 },
})
const percentile = (values, quantile) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length * quantile)]

function workload(authors, retained) {
  const base = new TextbufferEngine(original)
  const prefix = []
  const allocator = new CharIdAllocator('history')
  const previousEdits = retained === 100 ? 0 : retained
  for (let seq = 1; seq <= previousEdits; seq++) {
    const envelope = base.author(
      { offset: 0, deleteCount: 0, text: 'h' },
      {
        document: 'bench',
        epoch: '1',
        id: { actor: 'history', seq },
        lamport: seq,
        deps: seq > 1 ? [prefix.at(-1).id] : [],
        allocate: (left, count) => allocator.generateAfter(left, count),
      },
    )
    base.apply(envelope)
    prefix.push(envelope)
  }
  const batch = []
  const snapshot = base.snapshot()
  for (let i = 0; i < 100; i++) {
    const actor = `author-${i % authors}`
    const engine = new TextbufferEngine()
    engine.restore(snapshot)
    const ids = new CharIdAllocator(`insertion-${i}`)
    batch.push(
      engine.author(
        { offset: Math.floor((text.length * (i + 1)) / 101), deleteCount: 1, text: 'r' },
        {
          document: 'bench',
          epoch: '1',
          id: { actor, seq: Math.floor(i / authors) + 1 },
          lamport: prefix.length + 1,
          deps: prefix.length ? [prefix.at(-1).id] : [],
          allocate: (left, count) => ids.generateAfter(left, count),
        },
      ),
    )
  }
  for (const edit of batch) base.apply(edit)
  assert.equal(base.text().length, text.length + prefix.length)
  const counts = Array.from(
    { length: authors },
    (_, author) => batch.filter((edit) => edit.id.actor === `author-${author}`).length,
  )
  const expectedPairs = (100 * 99 - counts.reduce((sum, count) => sum + count * (count - 1), 0)) / 2
  return { history: [...prefix, ...batch], batch: batch.map((edit) => edit.id), expectedPairs }
}

function measure(input) {
  let incremental
  const prefix = input.history.slice(0, -100)
  const batch = input.history.slice(-100)
  const modes = {
    'build-and-query': () => new ConfirmedWindow(input.history).pairs(input.batch),
    'append-and-query': () => {
      incremental.append(batch)
      return incremental.pairs(input.batch)
    },
  }
  const samples = Object.fromEntries(Object.keys(modes).map((label) => [label, []]))
  let pairCount
  for (let sample = -20; sample < 51; sample++) {
    for (const label of [
      'build-and-query',
      'append-and-query',
      'append-and-query',
      'build-and-query',
    ]) {
      if (label === 'append-and-query') incremental = new ConfirmedWindow(prefix)
      const before = performance.now()
      const pairs = modes[label]()
      const elapsed = performance.now() - before
      pairCount = pairs.length
      assert.equal(pairCount, input.expectedPairs)
      assert.ok(pairs.every(([left, right]) => left.envelope.id.actor !== right.envelope.id.actor))
      if (sample >= 0) samples[label].push(elapsed)
    }
  }
  return Object.entries(samples).map(([label, values]) => ({
    label,
    pairCount,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    samplesMs: values,
  }))
}

function measureComparison(input, BaselineWindow) {
  const prefix = input.history.slice(0, -100)
  const batch = input.history.slice(-100)
  const modes = {
    baseline: BaselineWindow,
    current: ConfirmedWindow,
  }
  const samples = { baseline: [], current: [] }
  const querySamples = { baseline: [], current: [] }
  const expected = new BaselineWindow(input.history)
  const expectedPairs = expected.pairs(input.batch)
  for (let sample = -20; sample < 51; sample++) {
    for (const label of ['baseline', 'current', 'current', 'baseline']) {
      const window = new modes[label](prefix)
      const before = performance.now()
      window.append(batch)
      const appended = performance.now()
      const pairs = window.pairs(input.batch)
      const queried = performance.now()
      assert.equal(pairs.length, input.expectedPairs)
      if (sample === 50) {
        assert.deepEqual(window.edits, expected.edits)
        assert.deepEqual(pairs, expectedPairs)
      }
      if (sample < 0) continue
      samples[label].push(appended - before)
      querySamples[label].push(queried - appended)
    }
  }
  return Object.entries(samples).map(([label, values]) => ({
    label,
    pairCount: input.expectedPairs,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    queryMedianMs: percentile(querySamples[label], 0.5),
    combinedMedianMs: percentile(
      values.map((value, i) => value + querySamples[label][i]),
      0.5,
    ),
    combinedP95Ms: percentile(
      values.map((value, i) => value + querySamples[label][i]),
      0.95,
    ),
    samplesMs: values,
    querySamplesMs: querySamples[label],
  }))
}

const compareArgument = process.argv.indexOf('--compare')
const baseline =
  compareArgument === -1
    ? null
    : await import(pathToFileURL(resolve(process.argv[compareArgument + 1])).href)
const results = []
for (const authors of [2, 4, 8]) {
  for (const retained of [100, 8192]) {
    const input = workload(authors, retained)
    const measurements = baseline
      ? measureComparison(input, baseline.ConfirmedWindow)
      : measure(input)
    results.push(...measurements.map((result) => ({ authors, retained, ...result })))
  }
}
console.log(
  JSON.stringify(
    {
      qualification: 'experiment, shared machine',
      environment: { node: process.version, cpu: os.cpus()[0]?.model, platform: process.platform },
      method: baseline
        ? '100k-line TypeScript document. 100 independent confirmed replacements per batch, spread across 2/4/8 authors. Retained history is 100 or 8192 edits. 102 samples per mode after 40 warmups, in A/B/B/A order (A uses the baseline ConfirmedWindow module supplied through --compare, B uses the current build). Each prefix index is prepared outside timing. Append and exact pair output are timed separately. Real TextbufferEngine author/apply and validation outside timers. Final samples compare all retained edits and exact pairs against a fresh baseline window. Excludes parsing, merge-unit mapping and version reconstruction. No detector budget claim.'
        : '100k-line TypeScript document. 100 independent confirmed replacements per batch, spread across 2/4/8 authors. Retained history is 100 or 8192 edits. 102 samples per mode after 40 warmups, in A/B/B/A order (A builds the full index, B appends the confirmed batch to a prefix index prepared outside the timer). Real TextbufferEngine author/apply and validation outside timers. Build-and-query includes canonical ordering, copying, causal indexing, footprint extraction and exact pair output. Append-and-query includes adding the new edits, evicting the canonical suffix, updating causal intervals and emitting pairs. Excludes parsing, merge-unit mapping and version reconstruction. No detector budget claim.',
      lines,
      characters: text.length,
      results,
    },
    null,
    2,
  ),
)
