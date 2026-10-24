import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { cpus } from 'node:os'
import { Window } from 'happy-dom'
import { generateFixture } from '../../../examples/stress/src/fixtures.ts'

const { values } = parseArgs({
  options: { 'core-directory': { type: 'string' }, output: { type: 'string' } },
})
if (!values['core-directory'] || !values.output)
  throw new TypeError('Pass --core-directory frozen-eager-package and --output result.json')
const sourceModule = (path) =>
  import(pathToFileURL(resolve(values['core-directory'], 'src', path)).href)
const { createDocumentTextSnapshot } = await sourceModule('documentTextSnapshot.ts')
const { createPieceTableSnapshot, insertIntoPieceTable } = await sourceModule('public/document.ts')
const { VirtualizedTextView } = await sourceModule('virtualization/virtualizedTextView.ts')

const window = new Window({ url: 'http://localhost/' })
for (const name of [
  'document',
  'HTMLElement',
  'HTMLDivElement',
  'HTMLSpanElement',
  'HTMLTextAreaElement',
  'Node',
  'Text',
  'Range',
])
  globalThis[name] = window[name]
globalThis.window = window
globalThis.Highlight = class extends Set {}
const samples = []
function counts() {
  return { sourceReadBytes: 0, rangeReadCalls: 0, fullReadCalls: 0, lineStartScanBytes: 0 }
}
function instrument(snapshot, counters) {
  const read = snapshot.readRange.bind(snapshot)
  snapshot.readRange = (start, end) => {
    counters.rangeReadCalls++
    counters.sourceReadBytes += (end - start) * 2
    if (start === 0 && end === snapshot.length) counters.fullReadCalls++
    return read(start, end)
  }
  const chunks = snapshot.forEachTextChunk.bind(snapshot)
  snapshot.forEachTextChunk = (visit) =>
    chunks((text, start, end) => {
      counters.lineStartScanBytes += (end - start) * 2
      visit(text, start, end)
    })
  const full = snapshot.materializeFullText.bind(snapshot)
  snapshot.materializeFullText = () => {
    counters.fullReadCalls++
    counters.sourceReadBytes += snapshot.length * 2
    return full()
  }
  return snapshot
}
function inspect(view) {
  const rows = view.view.model.rows
  let textBytes = 0
  for (const row of rows) textBytes += row.text.length * 2
  const state = view.getState()
  return {
    retainedRows: rows.length,
    retainedRowTextBytes: textBytes,
    lineStartEntries: view.view.lineStarts.length,
    mountedRows: state.mountedRows.length,
  }
}
function sample(name, lines, run, view, counter, extras = {}) {
  const before = { ...counter }
  const previousRows = view.view.model.rows
  const previousIdentities = new Set(previousRows)
  const start = performance.now()
  run()
  const durationMs = performance.now() - start
  const delta = Object.fromEntries(
    Object.keys(counter).map((key) => [key, counter[key] - before[key]]),
  )
  const rows = view.view.model.rows
  let rowsChanged = 0
  for (let index = 0; index < rows.length; index++)
    if (!previousIdentities.has(rows[index])) rowsChanged++
  const suffixRowObjectsReplaced = countSuffixReplacements(name, rows, previousRows)
  samples.push({
    name,
    lines,
    durationMs,
    ...delta,
    ...inspect(view),
    replacementRowObjects: rowsChanged,
    suffixRowObjectsReplaced,
    ...extras,
  })
}
function countSuffixReplacements(name, rows, previousRows) {
  if (name !== 'top-newline-edit') return 0
  let count = 0
  for (let index = 2; index < rows.length; index++) {
    if (rows[index] !== previousRows[index - 1]) count++
  }
  return count
}
const huge = generateFixture('short-lines')
for (const lines of [100_000, 500_000]) {
  const text =
    lines === 500_000
      ? huge
      : huge.slice(0, huge.indexOf('\n', huge.split('\n', lines).join('\n').length))
  const snapshot = createPieceTableSnapshot(text)
  const counter = counts()
  const source = instrument(createDocumentTextSnapshot(snapshot), counter)
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (event) => {
    if (event.name === 'editor.line_starts.scan') counter.lineStartScanBytes += source.length * 2
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const view = new VirtualizedTextView(container, {
    rowHeight: 20,
    textMetrics: { rowHeight: 20, characterWidth: 8 },
    overscan: 12,
  })
  Object.defineProperties(view.scrollElement, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 800 },
  })
  sample(
    'cold-open-first-window',
    lines,
    () => {
      view.setText(text, source)
      view.setScrollMetrics(0, 800, 800)
    },
    view,
    counter,
    { inputUtf16Bytes: text.length * 2 },
  )
  sample(
    'warm-distant-windows',
    lines,
    () => {
      for (const row of [0, lines / 2, lines - 40, 0]) view.setScrollMetrics(row * 20, 800, 800)
    },
    view,
    counter,
  )
  const before = snapshot
  const after = insertIntoPieceTable(before, 0, 'x\n')
  const next = instrument(createDocumentTextSnapshot(after), counter)
  sample(
    'top-newline-edit',
    lines,
    () => view.applyEdit({ from: 0, to: 0, text: 'x\n' }, next),
    view,
    counter,
  )
  sample('end-reveal', lines, () => view.revealOffset(after.length), view, counter)
  sample('wrap-enable', lines, () => view.setWrapEnabled(true), view, counter)
  Object.defineProperty(view.scrollElement, 'clientWidth', { configurable: true, value: 128 })
  sample('wrap-resize', lines, () => view.setScrollMetrics(0, 800, 128), view, counter)
  view.dispose()
}
const result = {
  capturedAt: new Date().toISOString(),
  baselineCommit: 'ff1dfeda9e52b308f57915da7372f7ac6e5f04f9',
  runtime: Bun.version,
  cpu: cpus()[0]?.model,
  unit: 'UTF-16 payload bytes; excludes JS object headers and deduplicated source buffers',
  samples,
}
writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
