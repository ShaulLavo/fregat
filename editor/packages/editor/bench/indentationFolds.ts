import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createError } from '../src/logging/evlog.ts'
import { generateFallbackFixture } from '../../../examples/stress/src/fallbackFixture.ts'
import { fallbackFoldRanges } from '../test/oracles/foldRanges.ts'
import { IndentationFoldIndex } from '../src/editor/indentationFoldIndex.ts'
import { createDocumentSession } from '../src/documentSession.ts'
import { createTextEditBatch } from '../src/textEditBatch.ts'

const outputPath = benchmarkOutputPath(process.argv)
const text = generateFallbackFixture('short-lines', 60061)
const session = createDocumentSession(text)
const snapshot = session.getTextSnapshot()
const baseline = []
const unchanged = []
for (let sample = 0; sample < 7; sample += 1) {
  const start = performance.now()
  const folds = fallbackFoldRanges({ text, languageId: null, tabSize: 4 })
  const duration = performance.now() - start
  if (sample >= 2)
    baseline.push({
      durationMs: duration,
      folds: folds.length,
      codeUnitsRead: text.length,
      rowsRead: snapshot.lineCount,
    })
}
for (let sample = 0; sample < 5; sample += 1) {
  const start = performance.now()
  const folds = fallbackFoldRanges({ text, languageId: null, tabSize: 4 })
  unchanged.push({ durationMs: performance.now() - start, folds: folds.length })
}
const cold = []
let current: IndentationFoldIndex
for (let sample = 0; sample < 5; sample += 1) {
  const start = performance.now()
  current = new IndentationFoldIndex({ snapshot, languageId: null, tabSize: 4 })
  let slices = 0
  while (!current.ready) {
    current.step({ maxRows: 1024, maxCodeUnits: 32768 })
    slices += 1
  }
  cold.push({ wallMs: performance.now() - start, slices, ...current.diagnostics })
}
const reuse = []
for (let sample = 0; sample < 20; sample += 1) {
  const before = session.getTextSnapshot()
  const offset = before.lineStart(2) + 4
  const change = session.applyEdits([{ from: offset, to: offset, text: 'x' }])
  const batch = createTextEditBatch(before, change.textSnapshot, change.edits)
  const start = performance.now()
  current = new IndentationFoldIndex({
    snapshot: change.textSnapshot,
    languageId: null,
    tabSize: 4,
    previous: current!,
    batch,
  })
  current.step({ maxRows: 1024, maxCodeUnits: 32768 })
  reuse.push({ wallMs: performance.now() - start, ready: current.ready, ...current.diagnostics })
}
const expected = fallbackFoldRanges({
  text: session.materializeFullText(),
  languageId: null,
  tabSize: 4,
})
const start = performance.now()
const folds = current!.all()
const command = { durationMs: performance.now() - start, foldCount: folds.length }
if (JSON.stringify(folds) !== JSON.stringify(expected))
  throw createError({
    message: 'Indexed folds differ from frozen oracle',
    code: 'E034_ORACLE_MISMATCH',
    status: 500,
    why: 'The candidate returned different fold geometry.',
    fix: 'Compare the indexed ranges with the frozen scanner before accepting benchmark results.',
  })
const output = {
  oracleParity: true,
  fixture: 'short-lines',
  seed: 60061,
  languageId: null,
  tabSize: 4,
  rows: snapshot.lineCount,
  codeUnits: text.length,
  baseline,
  unchanged,
  cold,
  reuse,
  explicitEnumeration: command,
}
await mkdir(dirname(outputPath), { recursive: true })
await Bun.write(outputPath, JSON.stringify(output, null, 2) + '\n')
const summary = (rows: readonly { durationMs: number }[]) => ({
  min: Math.min(...rows.map((v) => v.durationMs)),
  median: rows.map((v) => v.durationMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  max: Math.max(...rows.map((v) => v.durationMs)),
})
console.log(
  JSON.stringify({
    rows: output.rows,
    codeUnits: output.codeUnits,
    baseline: summary(baseline),
    unchanged: summary(unchanged),
    coldCpu: summary(cold),
    coldWall: summary(cold.map((v) => ({ durationMs: v.wallMs }))),
    maximumSlice: Math.max(...cold.map((v) => v.maxSliceMs)),
    reuseCpu: summary(reuse),
    reuseWall: summary(reuse.map((v) => ({ durationMs: v.wallMs }))),
    reuseRows: reuse.map((v) => v.rowsRead),
    reusePropagation: reuse.map((v) => v.propagationRows),
    explicitEnumeration: command,
  }),
)

function benchmarkOutputPath(args: readonly string[]): string {
  const index = args.indexOf('--output')
  if (index < 0) return '/work/tmp/editor-e034/index-benchmark.json'
  const path = args[index + 1]
  if (path && !path.startsWith('--')) return path
  throw createError({
    message: 'Missing benchmark output path',
    code: 'E034_OUTPUT_PATH_REQUIRED',
    status: 400,
    why: '--output requires a following file path.',
    fix: 'Pass --output /work/tmp/editor-e034/index-benchmark.json.',
  })
}
