import type { TextEdit } from '@singapore-editor/core/document'
import { createError } from '@singapore-editor/core/logging/evlog'
import { resolveMinimapOptions } from '../src/options'
import { MinimapWorkerRenderer } from '../src/renderer'
import type {
  MinimapBaseStyles,
  MinimapDocumentPayload,
  MinimapDocumentSummaryPatch,
} from '../src/types'

type Sample = {
  readonly lines: number
  readonly textLength: number
  readonly iterations: number
  readonly averageEditMs: number
  readonly p95EditMs: number
  readonly worstEditMs: number
}

const LINE_COUNT = 100_000
const ITERATIONS = 50
const INSERTED_TEXT = '// MARK: minimap update\n'

const formatMs = (value: number): string => `${value.toFixed(4)}ms`

function createRenderer(): MinimapWorkerRenderer {
  const renderer = new MinimapWorkerRenderer()
  const canvas = { getContext: () => ({}) } as unknown as OffscreenCanvas
  renderer.init({
    mainCanvas: canvas,
    decorationsCanvas: canvas,
    options: resolveMinimapOptions(),
    styles: baseStyles(),
  })
  return renderer
}

function baseStyles(): MinimapBaseStyles {
  return {
    background: { r: 0, g: 0, b: 0, a: 255 },
    foreground: { r: 255, g: 255, b: 255, a: 255 },
    foregroundOpacity: 1,
    selection: { r: 10, g: 20, b: 30, a: 255 },
    minimapBackground: { r: 0, g: 0, b: 0, a: 255 },
    slider: 'rgba(255, 255, 255, 0.2)',
    sliderHover: 'rgba(255, 255, 255, 0.3)',
    sliderActive: 'rgba(255, 255, 255, 0.4)',
    fontFamily: 'monospace',
  }
}

function buildText(lines: number): string {
  const chunks: string[] = []

  for (let line = 0; line < lines; line += 1) {
    chunks.push(`const value${line} = ${line};\n`)
  }

  return chunks.join('')
}

function lineStarts(text: string): number[] {
  const starts = [0]

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue
    starts.push(index + 1)
  }

  return starts
}

function documentPayload(text: string): MinimapDocumentPayload {
  const starts = lineStarts(text)
  return {
    textLength: text.length,
    lineStarts: starts,
    lines: starts.map((start, index) => lineSummary(text, starts, start, index)),
    tokens: [],
    selections: [],
    decorations: [],
  }
}

function lineSummary(
  text: string,
  starts: readonly number[],
  start: number,
  index: number,
): MinimapDocumentPayload['lines'][number] {
  const nextStart = starts[index + 1]
  const end = nextStart === undefined ? text.length : Math.max(start, nextStart - 1)
  return {
    text: text.slice(start, end),
    length: end - start,
  }
}

function rendererDocument(renderer: MinimapWorkerRenderer): MinimapDocumentPayload {
  const state = (renderer as unknown as { state: { document: MinimapDocumentPayload } | null })
    .state
  benchmarkInvariant(state, 'Expected initialized renderer')
  return state.document
}

function measure(): Sample {
  const renderer = createRenderer()
  const text = buildText(LINE_COUNT)
  renderer.setDocument(documentPayload(text))

  const durations = measureEdits(renderer)
  const document = rendererDocument(renderer)
  renderer.dispose()

  return {
    lines: LINE_COUNT,
    textLength: document.textLength,
    iterations: ITERATIONS,
    averageEditMs: average(durations),
    p95EditMs: percentile(durations, 0.95),
    worstEditMs: Math.max(...durations),
  }
}

function measureEdits(renderer: MinimapWorkerRenderer): number[] {
  const durations: number[] = []

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const document = rendererDocument(renderer)
    const offset = Math.floor(document.textLength / 2)
    const edit = { from: offset, to: offset, text: INSERTED_TEXT }
    const summaryPatch = insertionSummaryPatch(document, edit)
    const start = performance.now()
    renderer.applyEdit(edit, { selections: [], summaryPatch })
    durations.push(performance.now() - start)
  }

  return durations
}

function insertionSummaryPatch(
  document: MinimapDocumentPayload,
  edit: TextEdit,
): MinimapDocumentSummaryPatch {
  benchmarkInvariant(edit.from === edit.to, 'Benchmark edit must be an insertion')
  const lineIndex = lineIndexForOffset(document.lineStarts, edit.from)
  const line = document.lines[lineIndex]
  benchmarkInvariant(line, 'Benchmark insertion must resolve to a document line')
  const lineStart = document.lineStarts[lineIndex] ?? 0
  const localOffset = edit.from - lineStart
  benchmarkInvariant(
    localOffset <= line.text.length,
    'Benchmark line summary must contain the insertion',
  )

  const lines = edit.text.split('\n')
  lines[0] = line.text.slice(0, localOffset) + lines[0]
  const last = lines.length - 1
  lines[last] += line.text.slice(localOffset)

  return {
    textLength: document.textLength + edit.text.length,
    startLine: lineIndex,
    deleteCount: 1,
    lines: lines.map((text) => ({ text, length: text.length })),
  }
}

function lineIndexForOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const start = lineStarts[middle] ?? 0
    const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY
    if (offset < start) {
      high = middle - 1
      continue
    }
    if (offset >= next) {
      low = middle + 1
      continue
    }
    return middle
  }

  return Math.max(0, lineStarts.length - 1)
}

function benchmarkInvariant(condition: unknown, message: string): asserts condition {
  if (condition) return

  throw createError({
    code: 'minimap.BENCHMARK_FIXTURE_INVALID',
    message,
    why: 'The update benchmark fixture no longer satisfies the renderer payload contract.',
    fix: 'Update the fixture before recording another minimap result.',
  })
}

function average(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = values.toSorted((left, right) => left - right)
  const index = Math.ceil(sorted.length * percentileValue) - 1
  return sorted[Math.max(0, index)] ?? 0
}

function printSample(sample: Sample): void {
  console.log('minimap update benchmark')
  console.log(`lines: ${sample.lines.toLocaleString()}`)
  console.log(`final text length: ${sample.textLength.toLocaleString()}`)
  console.log(`iterations: ${sample.iterations}`)
  console.log(`average edit update: ${formatMs(sample.averageEditMs)}`)
  console.log(`p95 edit update: ${formatMs(sample.p95EditMs)}`)
  console.log(`worst edit update: ${formatMs(sample.worstEditMs)}`)
}

printSample(measure())
