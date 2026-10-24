import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { generateFixture } from '../../../examples/stress/src/fixtures'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot, insertIntoPieceTable } from '../src/public/document'
import { captureSourceReads, counterDelta } from './projectionDiagnostics'
import { Window } from 'happy-dom'

import type { VirtualizedFoldMarker } from '../src/public/rendering'
import { VirtualizedTextView } from '../src/virtualization'

type Sample = {
  readonly name: string
  readonly durationMs: number
  readonly mountedRows: number
  readonly mountedCharacters: number
  readonly contentWidth: number
  readonly projection: ReturnType<VirtualizedTextView['getProjectionDiagnostics']>
}

const LARGE_LINE_COUNT = 100_000
const LONG_LINE_LENGTH = 50_000
const ROW_HEIGHT = 20
const VIEWPORT_HEIGHT = 400
const VIEWPORT_WIDTH = 800
const LONG_LINE_CHUNK_SIZE = 2_048
const MAX_MOUNTED_ROWS = 64
const MAX_MOUNTED_LONG_LINE_CHARACTERS = LONG_LINE_CHUNK_SIZE * 2

class BenchmarkHighlight extends Set<Range> {}

const formatMs = (value: number): string => `${value.toFixed(3)}ms`

function installDom(): Document {
  const window = new Window({
    url: 'http://localhost/',
  })
  const global = globalThis as typeof globalThis & {
    document: Document
    window: Window
    HTMLElement: typeof HTMLElement
    HTMLDivElement: typeof HTMLDivElement
    HTMLSpanElement: typeof HTMLSpanElement
    HTMLTextAreaElement: typeof HTMLTextAreaElement
    Node: typeof Node
    Text: typeof Text
    Range: typeof Range
    Highlight: typeof BenchmarkHighlight
  }

  global.window = window
  global.document = window.document
  global.HTMLElement = window.HTMLElement
  global.HTMLDivElement = window.HTMLDivElement
  global.HTMLSpanElement = window.HTMLSpanElement
  global.HTMLTextAreaElement = window.HTMLTextAreaElement
  global.Node = window.Node
  global.Text = window.Text
  global.Range = window.Range
  global.Highlight = BenchmarkHighlight
  return window.document
}

function createView(document: Document): VirtualizedTextView {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const view = new VirtualizedTextView(container, {
    rowHeight: ROW_HEIGHT,
    textMetrics: { rowHeight: ROW_HEIGHT, characterWidth: 8 },
    overscan: 12,
    longLineChunkSize: LONG_LINE_CHUNK_SIZE,
    longLineChunkThreshold: LONG_LINE_CHUNK_SIZE,
    horizontalOverscanColumns: 0,
  })

  mockViewport(view.scrollElement, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
  return view
}

function mockViewport(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
}

function buildLargeDocument(): string {
  return Array.from({ length: LARGE_LINE_COUNT }, (_, index) => `line-${index}`).join('\n')
}

function measureLargeDocument(view: VirtualizedTextView): Sample {
  const text = buildLargeDocument()
  const start = performance.now()
  view.setText(text)
  view.setScrollMetrics(0, VIEWPORT_HEIGHT)
  view.setScrollMetrics(500_000, VIEWPORT_HEIGHT)
  view.setScrollMetrics(1_500_000, VIEWPORT_HEIGHT)

  return sample('large-document', view, start)
}

function measureLargeFoldMarkerScroll(view: VirtualizedTextView): Sample {
  view.setText(buildLargeDocument())
  view.setFoldMarkers(buildLargeFoldMarkers())

  const start = performance.now()
  view.setScrollMetrics(0, VIEWPORT_HEIGHT)
  view.setScrollMetrics(500_000, VIEWPORT_HEIGHT)
  view.setScrollMetrics(1_500_000, VIEWPORT_HEIGHT)

  return sample('large-fold-marker-scroll', view, start)
}

function measureLongLine(view: VirtualizedTextView): Sample {
  const text = 'x'.repeat(LONG_LINE_LENGTH)
  const start = performance.now()
  view.setText(text)
  view.setScrollMetrics(0, VIEWPORT_HEIGHT)

  for (const column of [0, 5_000, 10_000, 25_000, 49_000]) {
    view.scrollElement.scrollLeft = column * view.getState().metrics.characterWidth
    view.setScrollMetrics(0, VIEWPORT_HEIGHT)
  }

  return sample('long-line', view, start)
}

function sample(name: string, view: VirtualizedTextView, start: number): Sample {
  const state = view.getState()
  return {
    name,
    durationMs: performance.now() - start,
    mountedRows: state.mountedRows.length,
    mountedCharacters: mountedCharacters(state.mountedRows),
    contentWidth: state.contentWidth,
    projection: view.getProjectionDiagnostics(),
  }
}

function mountedCharacters(
  rows: readonly { readonly chunks: readonly { readonly text: { readonly length: number } }[] }[],
): number {
  let count = 0
  for (const row of rows) {
    for (const chunk of row.chunks) count += chunk.text.length
  }

  return count
}

function printSample(sample: Sample): void {
  console.log(`${sample.name} virtualization benchmark`)
  console.log(`duration: ${formatMs(sample.durationMs)}`)
  console.log(`mounted rows: ${sample.mountedRows}`)
  console.log(`mounted characters: ${sample.mountedCharacters}`)
  console.log(`content width: ${sample.contentWidth.toLocaleString()}px`)
  console.log(JSON.stringify({ projection: sample.projection }))
}

function assertVirtualization(sample: Sample): void {
  assert.ok(sample.projection.cachedRows <= 256)
  assert.ok(sample.projection.cachedTextBytes <= 1_048_576)
  const isLargeRowSample =
    sample.name === 'large-document' || sample.name === 'large-fold-marker-scroll'
  if (isLargeRowSample && sample.mountedRows > MAX_MOUNTED_ROWS) {
    throw new Error(`mounted ${sample.mountedRows} rows; expected <= ${MAX_MOUNTED_ROWS}`)
  }

  if (sample.name === 'long-line' && sample.mountedCharacters > MAX_MOUNTED_LONG_LINE_CHARACTERS) {
    throw new Error(
      `mounted ${sample.mountedCharacters} long-line characters; expected <= ${MAX_MOUNTED_LONG_LINE_CHARACTERS}`,
    )
  }
}

function buildLargeFoldMarkers(): VirtualizedFoldMarker[] {
  const markers: VirtualizedFoldMarker[] = []
  for (let row = 0; row < LARGE_LINE_COUNT - 1; row += 2) {
    markers.push({
      key: `fold-${row}`,
      startOffset: row,
      endOffset: row + 1,
      startRow: row,
      endRow: row + 1,
      collapsed: false,
    })
  }

  return markers
}

const document = installDom()
const largeView = createView(document)
const largeSample = measureLargeDocument(largeView)
printSample(largeSample)
assertVirtualization(largeSample)
largeView.dispose()

const largeFoldMarkerView = createView(document)
const largeFoldMarkerSample = measureLargeFoldMarkerScroll(largeFoldMarkerView)
printSample(largeFoldMarkerSample)
assertVirtualization(largeFoldMarkerSample)
largeFoldMarkerView.dispose()

const longLineView = createView(document)
const longLineSample = measureLongLine(longLineView)
printSample(longLineSample)
assertVirtualization(longLineSample)
longLineView.dispose()

function firstLines(text: string, lines: number): string {
  let offset = -1
  for (let row = 0; row < lines; row += 1) {
    offset = text.indexOf('\n', offset + 1)
    if (offset === -1) return text
  }
  return text.slice(0, offset)
}

function measureProjectionView(lines: number, text: string): void {
  const pieceSnapshot = createPieceTableSnapshot(text)
  const snapshot = createDocumentTextSnapshot(pieceSnapshot)
  const source = captureSourceReads()
  const view = createView(document)
  const measure = (name: string, run: () => void): void => {
    const before = { ...source.counters }
    const start = performance.now()
    run()
    const durationMs = performance.now() - start
    const counters = counterDelta(source.counters, before)
    const projection = view.getProjectionDiagnostics()
    assert.ok(projection.cachedRows <= 256)
    assert.ok(projection.cachedTextBytes <= 1_048_576)
    console.log(
      JSON.stringify({
        name,
        lines,
        durationMs,
        source: counters,
        projection,
        mountedRows: view.getState().mountedRows.length,
      }),
    )
  }
  measure('cold-open-first-window', () => {
    view.setText(snapshot)
    view.setScrollMetrics(0, 800, 800)
  })
  measure('warm-distant-windows', () => {
    for (const row of [0, Math.floor(lines / 2), lines - 40, 0])
      view.setScrollMetrics(row * ROW_HEIGHT, 800, 800)
  })
  const after = createDocumentTextSnapshot(insertIntoPieceTable(pieceSnapshot, 0, 'x\n'))
  measure('top-newline-edit', () => view.applyEdit({ from: 0, to: 0, text: 'x\n' }, after))
  measure('end-reveal', () => view.revealOffset(after.length))
  measure('wrap-enable', () => view.setWrapEnabled(true))
  measure('wrap-resize', () => view.setScrollMetrics(0, 800, 128))
  view.dispose()
  assert.equal(view.getProjectionDiagnostics().cachedRows, 0)
  assert.equal(view.getProjectionDiagnostics().cachedTextBytes, 0)
  source.dispose()
}

const stressText = generateFixture('short-lines')
measureProjectionView(100_000, firstLines(stressText, 100_000))
measureProjectionView(500_000, stressText)

function measureHighlightOverlay(maskRanges: number): void {
  const host = document.createElement('div')
  document.body.append(host)
  const view = new VirtualizedTextView(host, {
    rowHeight: ROW_HEIGHT,
    textMetrics: { rowHeight: ROW_HEIGHT, characterWidth: 8 },
    highlightRegistry: new Map<string, Highlight>(),
  })
  const text = Array.from({ length: 200 }, () => 'const value = someFunction(argument);').join('\n')
  const tokens = Array.from({ length: 200 }, (_, row) => ({
    start: row * 38,
    end: row * 38 + 37,
    style: { color: '#ff8800' },
  }))
  view.setText(text)
  view.setScrollMetrics(0, VIEWPORT_HEIGHT, VIEWPORT_WIDTH)
  view.setTokens(tokens)
  if (maskRanges === 1)
    view.setRangeHighlight('overlay-bench', [{ start: 0, end: 76 }], { overlay: { dim: 0.5 } })
  // One short unused name per row, the shape a file full of unused-symbol diagnostics produces.
  if (maskRanges > 1)
    view.setRangeHighlight(
      'overlay-bench',
      Array.from({ length: maskRanges }, (_, row) => ({ start: row * 38 + 6, end: row * 38 + 11 })),
      { overlay: { dim: 0.5 } },
    )
  const samples: number[] = []
  for (let iteration = 0; iteration < 120; iteration++) {
    const next = (iteration % 2 ? 'c' : 'C') + text.slice(1)
    const start = performance.now()
    view.applyEdit({ from: 0, to: 1, text: next[0]! }, next)
    view.setTokens(tokens)
    if (iteration >= 20) samples.push(performance.now() - start)
  }
  samples.sort((left, right) => left - right)
  console.log(
    JSON.stringify({
      name: 'highlight-overlay-edit',
      maskRanges,
      medianMs: samples[50],
      p95Ms: samples[95],
    }),
  )
  view.dispose()
  host.remove()
}

measureHighlightOverlay(0)
measureHighlightOverlay(1)
measureHighlightOverlay(200)
