import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot, insertIntoPieceTable } from '../src/public/document'
import { createFoldMap } from '../src/foldMap'
import { DisplayProjection } from '../src/virtualization/displayProjection'
import type { DisplayProjectionInput } from '../src/virtualization/displayProjectionTypes'
import { captureSourceReads, counterDelta } from './projectionDiagnostics'

const LINE_COUNTS = [10_000, 50_000, 100_000, 500_000] as const
const WINDOW_ROWS = 52

function buildText(lines: number): string {
  return Array.from(
    { length: lines },
    (_, index) => `line\t${index} ${'x'.repeat(index % 80)}`,
  ).join('\n')
}

function foldMapFor(
  input: DisplayProjectionInput,
  pieceSnapshot: Parameters<typeof createFoldMap>[0],
) {
  const snapshot = input.textSnapshot
  const folds = []
  for (let row = 10; row + 4 < snapshot.lineCount; row += 250) {
    folds.push({
      startIndex: snapshot.lineStart(row),
      endIndex: snapshot.lineStart(row + 4),
      startLine: row,
      endLine: row + 4,
      type: 'bench-fold',
    })
  }
  return createFoldMap(pieceSnapshot, folds)
}

function measure(name: string, input: DisplayProjectionInput): void {
  const source = captureSourceReads()
  const start = performance.now()
  input.textSnapshot.lineStart(input.textSnapshot.lineCount - 1)
  const sourceIndexMs = performance.now() - start
  const indexCounters = { ...source.counters }
  const createStart = performance.now()
  const projection = new DisplayProjection(input)
  const buildMs = performance.now() - createStart
  const buildSource = counterDelta(source.counters, indexCounters)
  const beforeWindow = { ...source.counters }
  const firstStart = performance.now()
  projection.materializeWindow(0, WINDOW_ROWS)
  const firstWindowMs = performance.now() - firstStart
  const firstCounters = counterDelta(source.counters, beforeWindow)
  const scrollStart = performance.now()
  let checksum = 0
  for (let index = 0; index < 100; index += 1) {
    const row = Math.floor(((projection.rowCount - WINDOW_ROWS) * index) / 99)
    projection.materializeWindow(row, row + WINDOW_ROWS)
    checksum += projection.rowForOffset(projection.getRowMetrics(row)?.startOffset ?? 0, 'before')
  }
  const scrollingMs = performance.now() - scrollStart
  assert.ok(checksum >= 0)
  assert.ok(projection.diagnostics.cachedRows <= 256)
  assert.ok(projection.diagnostics.cachedTextBytes <= 1_048_576)
  if (name === 'plain') assert.equal(firstCounters.sourceIndexBytesRead, 0)
  console.log(
    JSON.stringify({
      name,
      lines: input.textSnapshot.lineCount,
      rows: projection.rowCount,
      sourceIndexMs,
      buildMs,
      firstWindowMs,
      scrollingMs,
      coldIndex: indexCounters,
      buildSource,
      firstWindow: firstCounters,
      projection: projection.diagnostics,
    }),
  )
  projection.dispose()
  source.dispose()
}

/** A stand-in glyph table: widths vary by code point, as a proportional face's do. */
const ADVANCES = Float32Array.from({ length: 0x10000 }, (_, code) => 4 + (code % 7))
const PROPORTIONAL_ADVANCE = {
  width: 80 * 7,
  advance: (codePoint: number) => ADVANCES[codePoint & 0xffff]!,
}

for (const lines of LINE_COUNTS) {
  const pieceSnapshot = createPieceTableSnapshot(buildText(lines))
  const input: DisplayProjectionInput = {
    textSnapshot: createDocumentTextSnapshot(pieceSnapshot),
    foldMap: null,
    inlineMap: null,
    injectedTextRows: [],
    wrapColumn: null,
    tabSize: 4,
  }
  measure('plain', input)
  measure('folds + wraps', { ...input, foldMap: foldMapFor(input, pieceSnapshot), wrapColumn: 80 })
  measure('folds + word wraps', {
    ...input,
    foldMap: foldMapFor(input, pieceSnapshot),
    wrapColumn: 80,
    wrapBreak: 'word',
  })
  measure('folds + proportional wraps', {
    ...input,
    foldMap: foldMapFor(input, pieceSnapshot),
    wrapColumn: 80,
    wrapAdvance: PROPORTIONAL_ADVANCE,
  })
  const projection = new DisplayProjection(input)
  const after = createDocumentTextSnapshot(insertIntoPieceTable(pieceSnapshot, 0, 'new\n'))
  const counters = captureSourceReads()
  const started = performance.now()
  projection.update({
    before: input.textSnapshot,
    after,
    edits: [{ from: 0, to: 0, text: 'new\n' }],
  })
  const durationMs = performance.now() - started
  assert.equal(counters.counters.sourceBytesRead, 0)
  assert.equal(counters.counters.sourceIndexBytesRead, 0)
  assert.ok(projection.diagnostics.indexEntriesTouched < 100)
  console.log(
    JSON.stringify({
      name: 'top-newline-edit',
      lines,
      durationMs,
      source: counters.counters,
      projection: projection.diagnostics,
    }),
  )
  projection.dispose()
  counters.dispose()
}
