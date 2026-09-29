import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    child: { type: 'string' },
    pages: { type: 'string', default: '256,4096,16384' },
    edits: { type: 'string', default: '100' },
    repetitions: { type: 'string', default: '3' },
    output: { type: 'string' },
    scratch: { type: 'string', default: '/work/tmp' },
  },
})
const edits = Number(values.edits)
assert.ok(Number.isSafeInteger(edits) && edits > 0)

if (values.child) await measure()
else await compare()

async function measure() {
  const api = await import(pathToFileURL(values.child).href)
  let snapshot = api.createPieceTableSnapshot('x'.repeat(1024 * 1024))
  const initial = measurements(api, snapshot)
  initial.columnAt(initial.length, 4, 'estimated')
  const samples = []
  for (let edit = 0; edit < edits + 20; edit++) {
    snapshot = api.insertIntoPieceTable(snapshot, 100 + edit, 'a')
    const start = performance.now()
    const current = measurements(api, snapshot)
    assert.equal(current.isSimple, true)
    assert.equal(current.containsRTL, false)
    assert.equal(current.columnAt(current.length, 4, 'estimated'), current.length)
    const elapsed = performance.now() - start
    if (edit >= 20) samples.push(elapsed)
  }
  samples.sort((a, b) => a - b)
  process.stdout.write(
    JSON.stringify({
      node: process.version,
      initialRanges: initial.ranges.length,
      finalRanges: measurements(api, snapshot).ranges.length,
      edits,
      medianMs: samples[Math.floor(samples.length / 2)],
      p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
    }),
  )
}

function measurements(api, snapshot) {
  return api.measureTextSnapshotRange(api.createDocumentTextSnapshot(snapshot), 0, snapshot.length)
}

async function compare() {
  assert.ok(typeof Bun !== 'undefined', 'Run the comparison with Bun; samples run in Node.')
  const pages = values.pages.split(',').map(Number)
  const repetitions = Number(values.repetitions)
  assert.ok(pages.every((size) => Number.isSafeInteger(size) && size > 0))
  assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0)
  const scratch = mkdtempSync(`${values.scratch}/e006-measurements-`)
  try {
    await runCandidates(scratch, pages, repetitions)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function runCandidates(scratch, pages, repetitions) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const entry = `${scratch}/entry.mjs`
  writeFileSync(
    entry,
    [
      `export { createPieceTableSnapshot, insertIntoPieceTable } from ${JSON.stringify(root + 'packages/textbuffer/dist/index.js')}`,
      `export { createDocumentTextSnapshot, measureTextSnapshotRange } from ${JSON.stringify(root + 'packages/editor/src/documentTextSnapshot.ts')}`,
    ].join('\n'),
  )
  const rows = []
  for (const pageUnits of pages) {
    const candidate = await buildCandidate(entry, scratch, pageUnits)
    rows.push(...runSamples(candidate, pageUnits, repetitions))
  }
  const output =
    JSON.stringify(
      {
        note: 'Real textbuffer and measurement classes, with only the source-page constant replaced in isolated bundles. Each Node process warms a 1Mi-unit line and 20 edits, then times full-line measurement construction, classification and columnAt after each edit. Source indexes are reused; each edit creates a new snapshot wrapper. Private range counts are observed only by this probe.',
        rows,
      },
      null,
      2,
    ) + '\n'
  if (values.output) writeFileSync(values.output, output)
  process.stdout.write(output)
}

async function buildCandidate(entry, scratch, pageUnits) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: `${scratch}/${pageUnits}`,
    target: 'node',
    format: 'esm',
    naming: 'candidate.mjs',
    plugins: [
      {
        name: 'measurement-page-size',
        setup(build) {
          build.onLoad({ filter: /documentTextSourceCache\.ts$/ }, ({ path }) => ({
            contents: readFileSync(path, 'utf8').replace(
              /const SOURCE_PAGE_LENGTH = [^\n]+/,
              `const SOURCE_PAGE_LENGTH = ${pageUnits}`,
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

function runSamples(candidate, pageUnits, repetitions) {
  const rows = []
  for (let sample = 1; sample <= repetitions; sample++) {
    const result = spawnSync(
      'node',
      [fileURLToPath(import.meta.url), '--child', candidate, '--edits', values.edits],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr || String(result.error))
    rows.push({ pageUnits, sample, ...JSON.parse(result.stdout) })
  }
  return rows
}
