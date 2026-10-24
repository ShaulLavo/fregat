import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot.ts'
import { IndentationFoldIndex } from '../src/editor/indentationFoldIndex.ts'
import { createError } from '../src/logging/evlog.ts'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'

const depth = benchmarkDepth(process.argv)
const outputPath = optionValue(process.argv, '--output')
const text =
  '// region\n'.repeat(depth) +
  'body\n' +
  '// endregion\n'.repeat(depth) +
  '// region\nbody\n// endregion\n'
const index = new IndentationFoldIndex({
  snapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text)),
  languageId: null,
  tabSize: 4,
})
const budget = { maxRows: 128, maxCodeUnits: 32768, maxBlocks: 128, maxStackSteps: 128 }
const position = index['position'].bind(index)
let positionCalls = 0
index['position'] = (reference) => {
  positionCalls += 1
  return position(reference)
}
let slices = 0
let stackOnlySlices = 0
let maximumStackSteps = 0
let maximumStackSliceMs = 0
let maximumPositions = {
  positionCalls: 0,
  durationMs: 0,
  rowsRead: 0,
  propagationRows: 0,
  metadataSteps: 0,
  stackSteps: 0,
}

while (!index.ready) {
  positionCalls = 0
  const before = index.diagnostics
  const started = performance.now()
  index.step(budget)
  const durationMs = performance.now() - started
  const after = index.diagnostics
  const stackSteps = after.stackSteps - before.stackSteps
  const propagationRows = after.propagationRows - before.propagationRows
  if (stackSteps > 0) {
    maximumStackSteps = Math.max(maximumStackSteps, stackSteps)
    maximumStackSliceMs = Math.max(maximumStackSliceMs, durationMs)
    if (propagationRows === 0) stackOnlySlices += 1
  }
  if (positionCalls > maximumPositions.positionCalls) {
    maximumPositions = {
      positionCalls,
      durationMs,
      rowsRead: after.rowsRead - before.rowsRead,
      propagationRows,
      metadataSteps: after.metadataSteps - before.metadataSteps,
      stackSteps,
    }
  }
  slices += 1
}
index['position'] = position

if (index.count !== depth + 1 || maximumStackSteps > budget.maxStackSteps)
  throw createError({
    message: 'Deep indentation fold benchmark failed',
    code: 'E034_STACK_WORK_FAILED',
    status: 500,
    why: 'Fold discovery lost a region or exceeded the stack-work budget.',
    fix: 'Check resumable ancestor cleanup and checkpoint comparisons before accepting results.',
  })

const result = {
  fixture: 'nested-regions-followed-by-disjoint-region',
  depth,
  rows: index.snapshot.lineCount,
  codeUnits: text.length,
  budget,
  slices,
  foldCount: index.count,
  maximumPositions,
  maximumStackSteps,
  maximumStackSliceMs,
  stackOnlySlices,
  diagnostics: index.diagnostics,
}
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true })
  await Bun.write(outputPath, JSON.stringify(result, null, 2) + '\n')
}
console.log(JSON.stringify(result))

function benchmarkDepth(args: readonly string[]): number {
  const value = optionValue(args, '--depth')
  if (value === undefined) return 250000
  const depth = Number(value)
  if (Number.isSafeInteger(depth) && depth > 0) return depth
  throw createError({
    message: 'Invalid region nesting depth',
    code: 'E034_STACK_DEPTH_INVALID',
    status: 400,
    why: '--depth requires a positive integer.',
    fix: 'Pass --depth 250000 for the 500,005-line fixture.',
  })
}

function optionValue(args: readonly string[], option: string): string | undefined {
  const index = args.indexOf(option)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value && !value.startsWith('--')) return value
  throw createError({
    message: `Missing ${option} value`,
    code: 'E034_STACK_OPTION_REQUIRED',
    status: 400,
    why: `${option} requires a following value.`,
    fix: 'Pass --depth 250000 and optionally --output followed by a JSON file path.',
  })
}
