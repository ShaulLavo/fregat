import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { Window } from 'happy-dom'
import { inspectProjections, installProjections } from './editBatchProjections.mjs'
import {
  defaultSeed,
  generateFixture,
  generatorVersion,
} from '../../../examples/stress/src/fixtures.ts'

const { values } = parseArgs({
  options: {
    'core-directory': { type: 'string', default: resolve(import.meta.dirname, '..') },
    output: { type: 'string' },
    repetitions: { type: 'string', default: '30' },
    warmups: { type: 'string', default: '5' },
    'require-incremental': { type: 'boolean', default: false },
  },
})
assert.ok(values.output, 'Pass --output result.json')
const repetitions = Number(values.repetitions)
const warmups = Number(values.warmups)
assert.ok(Number.isInteger(repetitions) && repetitions > 0)
assert.ok(Number.isInteger(warmups) && warmups >= 0)
const coreDirectory = resolve(values['core-directory'])
const sourceSha256 = sourceHash(join(coreDirectory, 'src'))
const sourceModule = (path) => import(pathToFileURL(resolve(coreDirectory, 'src', path)).href)
const window = installDom()
const { Editor } = await sourceModule('editor.ts')
const { VirtualizedTextView } = await sourceModule('virtualization/virtualizedTextView.ts')
const { DisplayProjection } = await sourceModule('virtualization/displayProjection.ts')
const { createDocumentTextSnapshot } = await sourceModule('documentTextSnapshot.ts')
const { createPieceTableSnapshot } = await sourceModule('public/document.ts')
const { setHighlightRegistry } = await sourceModule('public/testing.ts')
setHighlightRegistry(new Map())
let active = null
instrumentSnapshot(Object.getPrototypeOf(createDocumentTextSnapshot(createPieceTableSnapshot(''))))
instrumentView()
const resetProjection = DisplayProjection.prototype.reset
DisplayProjection.prototype.reset = function (...args) {
  if (active) active.projectionResetCalls += 1
  return resetProjection.apply(this, args)
}

function installDom() {
  const host = new Window({ url: 'http://localhost/' })
  for (const key of [
    'document',
    'navigator',
    'HTMLElement',
    'HTMLDivElement',
    'HTMLSpanElement',
    'HTMLTextAreaElement',
    'Node',
    'Text',
    'Range',
    'Event',
    'CustomEvent',
    'InputEvent',
    'MutationObserver',
    'ResizeObserver',
    'CSS',
  ])
    Object.defineProperty(globalThis, key, { configurable: true, value: host[key] })
  globalThis.window = host
  globalThis.Highlight = class extends Set {}
  globalThis.getComputedStyle = host.getComputedStyle.bind(host)
  globalThis.requestAnimationFrame = host.requestAnimationFrame.bind(host)
  globalThis.cancelAnimationFrame = host.cancelAnimationFrame.bind(host)
  return host
}

function instrumentSnapshot(prototype) {
  const readRange = prototype.readRange
  prototype.readRange = function (start, end) {
    if (active) recordRange(active, start, end, this.length)
    return readRange.call(this, start, end)
  }
  const materializeFullText = prototype.materializeFullText
  prototype.materializeFullText = function () {
    if (active) active.materializeFullTextCalls += 1
    return materializeFullText.call(this)
  }
}

function recordRange(counters, start, end, length) {
  counters.rangeReadCalls += 1
  counters.maxRangeUtf16Length = Math.max(counters.maxRangeUtf16Length, end - start)
  if (start < length / 3 && end > (length * 2) / 3) counters.unchangedGapReads += 1
  if (counters.ranges.length < 12) counters.ranges.push({ start, end, length })
}

function instrumentView() {
  for (const name of ['setText', 'applyEdit', 'applyEditBatch']) {
    const original = VirtualizedTextView.prototype[name]
    if (typeof original !== 'function') continue
    VirtualizedTextView.prototype[name] = function (...args) {
      if (active) active.viewCalls[name] = (active.viewCalls[name] ?? 0) + 1
      return original.apply(this, args)
    }
  }
}

function emptyCounters() {
  return {
    sourceBytesRead: 0,
    sourceIndexBytesRead: 0,
    fullTextReads: 0,
    fullTextBytesRead: 0,
    materializedStrings: 0,
    materializeFullTextCalls: 0,
    projectionResetCalls: 0,
    rangeReadCalls: 0,
    maxRangeUtf16Length: 0,
    unchangedGapReads: 0,
    viewCalls: {},
    ranges: [],
    committedEvents: 0,
    viewUpdatedEvents: 0,
  }
}

function recordDiagnostic(event) {
  if (!active) return
  if (event.name === 'editor.document.committed') active.committedEvents += 1
  if (event.name === 'editor.view.updated') active.viewUpdatedEvents += 1
  if (event.name === 'textSnapshot.sourceIndex')
    active.sourceIndexBytesRead += event.detail.sourceBytesRead
  if (event.name !== 'textSnapshot.read') return
  active.sourceBytesRead += event.detail.sourceBytesRead
  active.fullTextReads += event.detail.fullTextReads
  active.materializedStrings += event.detail.materializedStrings
  if (event.detail.fullTextReads) active.fullTextBytesRead += event.detail.sourceBytesRead
}

function mountEditor() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new Editor(container, {
    textMetrics: { rowHeight: 20, characterWidth: 8 },
    wordWrap: false,
  })
  const view = editor.view
  assert.ok(view instanceof VirtualizedTextView)
  Object.defineProperties(view.scrollElement, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 800 },
  })
  view.setScrollMetrics(0, 800, 800)
  return { editor, view, container }
}

function editsFor(text, kind) {
  const first = { from: 0, to: 0, text: 'prefix\n' }
  if (kind === 'single-edit') return [first]
  return [first, { from: text.length, to: text.length, text: '\nsuffix' }]
}

function projectionWork(view, before) {
  const projection = view.view.model.projection
  const after = view.getProjectionDiagnostics()
  const work = {}
  for (const key of [
    'sourceBytesRead',
    'materializedRows',
    'materializedTextBytes',
    'indexEntriesTouched',
    'summaryLinesMeasured',
  ]) {
    work[key] = after[key] - (projection === before.projection ? before.counters[key] : 0)
  }
  return { instanceReplaced: projection !== before.projection, work, retained: after }
}

function verifyResult(editor, view, expected) {
  assert.equal(editor.materializeFullText(), expected)
  const state = view.getState()
  assert.ok(state.mountedRows.length > 0, 'The view must be visible')
  for (const row of state.mountedRows) verifyMountedRow(row, expected)
  assert.equal(view.view.model.textSnapshot.length, expected.length)
  return { mountedRows: state.mountedRows.length, scrollTop: state.scrollTop }
}

function verifyMountedRow(row, expected) {
  for (const chunk of row.chunks) {
    const text = chunk.text.slice(0, chunk.text.length)
    assert.equal(text, expected.slice(chunk.startOffset, chunk.endOffset))
    verifyMountedParts(chunk, row.startOffset, expected)
  }
}

function verifyMountedParts(chunk, rowStart, expected) {
  for (const part of chunk.parts) {
    if (part.kind !== 'text') continue
    assert.equal(
      part.node.textContent,
      expected.slice(rowStart + part.localStart, rowStart + part.localEnd),
    )
  }
}

function measure(editor, view, text, kind, diagnostic, decorated) {
  editor.openDocument({ documentId: 'e032.txt', text })
  view.setScrollMetrics(0, 800, 800)
  const initial = decorated ? installProjections(editor) : null
  const edits = editsFor(text, kind)
  const expected = `prefix\n${text}${kind === 'single-edit' ? '' : '\nsuffix'}`
  const before = {
    projection: view.view.model.projection,
    counters: view.getProjectionDiagnostics(),
  }
  const counters = diagnostic ? emptyCounters() : null
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = diagnostic ? recordDiagnostic : undefined
  active = counters
  const start = performance.now()
  editor.edit(edits)
  const durationMs = performance.now() - start
  active = null
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = undefined
  const projection = projectionWork(view, before)
  const correctness = {
    ...verifyResult(editor, view, expected),
    projections: inspectProjections(editor, initial),
  }
  return { durationMs, counters, projection, correctness }
}

function percentile(samples, proportion) {
  const sorted = samples.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1)]
}

function runGroup(fixture, kind, text, decorated = false) {
  const { editor, view, container } = mountEditor()
  for (let index = 0; index < warmups; index++) measure(editor, view, text, kind, false, decorated)
  const samples = []
  for (let index = 0; index < repetitions; index++)
    samples.push(measure(editor, view, text, kind, false, decorated).durationMs)
  const diagnostic = measure(editor, view, text, kind, true, decorated)
  if (values['require-incremental']) requireIncremental(diagnostic)
  editor.dispose()
  container.remove()
  const result = {
    fixture,
    kind,
    decorated,
    utf16Length: text.length,
    fixtureSha256: createHash('sha256').update(text).digest('hex'),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    samples,
    diagnostic,
  }
  console.log(
    JSON.stringify({
      fixture,
      kind,
      decorated,
      p50Ms: result.p50Ms,
      p95Ms: result.p95Ms,
      counters: diagnostic.counters,
      projection: diagnostic.projection,
    }),
  )
  return result
}

function requireIncremental(sample) {
  assert.equal(sample.counters.materializeFullTextCalls, 0)
  assert.equal(sample.counters.fullTextReads, 0)
  assert.equal(sample.counters.unchangedGapReads, 0)
  assert.equal(sample.counters.viewCalls.setText ?? 0, 0)
  assert.equal(sample.counters.projectionResetCalls, 0)
  assert.equal(sample.projection.instanceReplaced, false)
  assert.equal(sample.counters.viewUpdatedEvents, 1)
  assert.ok(sample.counters.sourceBytesRead <= 16_384, 'Sparse edits must not scan retained text')
  assert.ok(sample.counters.maxRangeUtf16Length <= 4_096, 'Reads must remain range bounded')
  assert.ok(sample.projection.work.indexEntriesTouched <= 64, 'Projection work must stay local')
  assert.ok(sample.projection.retained.cachedRows <= 64, 'Only the mounted window should be cached')
  if (!sample.correctness.projections) return
  assert.equal(sample.correctness.projections.tokensCorrect, true)
  assert.equal(sample.correctness.projections.foldCorrect, true)
}

function sourceHash(directory) {
  const hash = createHash('sha256')
  visitSources(directory, hash)
  return hash.digest('hex')
}

function visitSources(directory, hash) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visitSources(path, hash)
    if (entry.isFile()) hash.update(path.slice(coreDirectory.length)).update(readFileSync(path))
  }
}

const groups = []
for (const fixture of ['ordinary', 'long-line', 'short-lines']) {
  const text = generateFixture(fixture)
  groups.push(runGroup(fixture, 'single-edit', text), runGroup(fixture, 'sparse-batch', text))
  if (fixture !== 'long-line')
    groups.push(
      runGroup(fixture, 'single-edit', text, true),
      runGroup(fixture, 'sparse-batch', text, true),
    )
}
assert.equal(sourceHash(join(coreDirectory, 'src')), sourceSha256, 'Sources changed during capture')
const result = {
  capturedAt: new Date().toISOString(),
  coreDirectory,
  sourceSha256,
  runtime: `Bun ${Bun.version}`,
  cpu: cpus()[0]?.model,
  generatorVersion,
  seed: defaultSeed,
  repetitions,
  warmups,
  configuration: {
    environment: 'happy-dom',
    viewport: { width: 800, height: 800 },
    rowHeight: 20,
    characterWidth: 8,
    wrap: false,
    syntax: false,
    plugins: [],
    timingsHaveDiagnostics: false,
  },
  measurement:
    'Synchronous Editor.edit through session commit, projection and mounted DOM reconciliation; excludes deferred consumers and browser layout/paint. Diagnostic run is separate. UTF-16 bytes count requested payloads including repeats.',
  retainedHeap: {
    supported: false,
    reason:
      'happy-dom host and runtime heap include fixture generation, source snapshots, cancelled deferred work, and GC scheduling; retained row/cache/index counters are reported instead.',
  },
  groups,
}
writeFileSync(resolve(values.output), JSON.stringify(result, null, 2) + '\n')
await window.happyDOM.close()
