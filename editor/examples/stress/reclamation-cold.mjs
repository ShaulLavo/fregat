import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    child: { type: 'string' },
    units: { type: 'string', default: String(32 * 1024 * 1024) },
    repetitions: { type: 'string', default: '3' },
    output: { type: 'string' },
    scratch: { type: 'string', default: '/work/tmp' },
  },
})
const units = Number(values.units)
assert.ok(Number.isSafeInteger(units) && units > 16_384)
if (values.child) await measure()
else await compare()

function heap() {
  globalThis.gc()
  return process.memoryUsage().heapUsed
}

async function measure() {
  const api = await import(pathToFileURL(values.child).href)
  const text = 'x'.repeat(units)
  assert.equal(text.charCodeAt(units - 1), 120)
  const snapshot = api.createPieceTableSnapshot(text)
  const projection = new api.DisplayProjection({
    textSnapshot: api.createDocumentTextSnapshot(snapshot),
    foldMap: null,
    inlineMap: null,
    injectedTextRows: [],
    wrapColumn: null,
    tabSize: 4,
  })
  const baseline = heap()
  const started = performance.now()
  const line = projection.getLineText(0)
  const acquisitionMs = performance.now() - started
  const acquiredHeapBytes = heap() - baseline
  const classifyStarted = performance.now()
  assert.equal(line.measurements.containsRTL, false)
  assert.equal(line.measurements.columnAt(10, 4, 'estimated'), 10)
  const classificationMs = performance.now() - classifyStarted
  const classifiedHeapBytes = heap() - baseline
  assert.equal(line.measurements.codeUnitAt(units - 1), 120)
  process.stdout.write(
    JSON.stringify({
      node: process.version,
      units,
      acquisitionMs,
      acquiredHeapBytes,
      classificationMs,
      classifiedHeapBytes,
    }),
  )
}

async function compare() {
  assert.ok(typeof Bun !== 'undefined', 'Run with Bun; probes execute in Node with --expose-gc.')
  const repetitions = Number(values.repetitions)
  assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0)
  const scratch = mkdtempSync(`${values.scratch}/e006-cold-`)
  try {
    const rows = await runCandidates(scratch, repetitions)
    const output =
      JSON.stringify(
        {
          note: 'Real DisplayProjection.getLineText on a fresh unwrapped ASCII line. Eager reproduction changes only page acquisition to copyTextRange, retaining the same new handle-based index implementation. Each process forces GC before and after acquisition and after first RTL classification/column lookup. Classification is the same full-line measurement path first paint consumes, not a browser paint timing. String backing was flattened before the baseline. No edits or maintenance occur.',
          rows,
        },
        null,
        2,
      ) + '\n'
    if (values.output) writeFileSync(values.output, output)
    process.stdout.write(output)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function runCandidates(scratch, repetitions) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const entry = `${scratch}/entry.mjs`
  writeFileSync(
    entry,
    [
      `export { createPieceTableSnapshot } from ${JSON.stringify(root + 'packages/textbuffer/dist/index.js')}`,
      `export { createDocumentTextSnapshot } from ${JSON.stringify(root + 'packages/editor/src/documentTextSnapshot.ts')}`,
      `export { DisplayProjection } from ${JSON.stringify(root + 'packages/editor/src/virtualization/displayProjection.ts')}`,
    ].join('\n'),
  )
  const rows = []
  for (const kind of ['eager', 'borrowed']) {
    const candidate = await buildCandidate(entry, scratch, kind)
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      const result = spawnSync(
        'node',
        [
          '--expose-gc',
          fileURLToPath(import.meta.url),
          '--child',
          candidate,
          '--units',
          values.units,
        ],
        { encoding: 'utf8' },
      )
      assert.equal(result.status, 0, result.stderr || String(result.error))
      rows.push({ kind, repetition, ...JSON.parse(result.stdout) })
    }
  }
  return rows
}

async function buildCandidate(entry, scratch, kind) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: `${scratch}/${kind}`,
    target: 'node',
    format: 'esm',
    naming: 'candidate.mjs',
    plugins: [
      {
        name: 'cold-copy-comparison',
        setup(build) {
          if (kind !== 'eager') return
          build.onLoad({ filter: /documentTextSourceCache\.ts$/ }, ({ path }) => ({
            contents:
              "import { copyTextRange } from '@singapore-editor/textbuffer/internal/buffers'\n" +
              readFileSync(path, 'utf8').replace(
                'owner.page(text, start, end)',
                'copyTextRange(text, start, end)',
              ),
            loader: 'ts',
          }))
        },
      },
    ],
  })
  assert.ok(result.success, result.logs.map(String).join('\n'))
  return result.outputs[0].path
}
