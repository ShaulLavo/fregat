import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const CHUNK_UNITS = 16 * 1024
const scenarios = ['tail', 'closed-full', 'closed-partial']
const { values } = parseArgs({
  options: {
    child: { type: 'boolean', default: false },
    scenario: { type: 'string', default: 'tail' },
    label: { type: 'string', default: 'candidate' },
    samples: { type: 'string', default: '3' },
    units: { type: 'string', default: String(16 * 1024 * 1024) },
    output: { type: 'string' },
  },
})
const units = Number(values.units)
const samples = Number(values.samples)
assert.ok(Number.isSafeInteger(units) && units >= CHUNK_UNITS * 2 && units % CHUNK_UNITS === 0)
assert.ok(Number.isSafeInteger(samples) && samples > 0)
assert.ok(scenarios.includes(values.scenario))

if (values.child) await sample()
else run()

async function sample() {
  const api = await import('../../packages/textbuffer/dist/index.js')
  const { reclaimPieceTableText } = await import('../../packages/textbuffer/dist/reclamation.js')
  global.gc()
  const baselineHeap = process.memoryUsage().heapUsed
  const fixture = buildFixture(api, reclaimPieceTableText)
  await nextTurn()
  global.gc()
  const retainedHeap = process.memoryUsage().heapUsed
  const visibleLength = fixture.snapshot.length
  const text = api.materializePieceTableFullText(fixture.snapshot)
  assert.equal(text, fixture.expected)
  process.stdout.write(
    JSON.stringify({
      scenario: values.scenario,
      inputUnits: fixture.inputUnits,
      visibleLength,
      valid: true,
      baselineHeap,
      retainedHeap,
      retainedHeapBytes: retainedHeap - baselineHeap,
      stagePeakHeapBytes: Math.max(...fixture.stageHeaps) - baselineHeap,
      ...fixture.timings,
    }),
  )
}

function buildFixture(api, reclaim) {
  const tail = values.scenario === 'tail'
  const keep = values.scenario === 'closed-partial' ? CHUNK_UNITS - 1 : CHUNK_UNITS
  const inputUnits = units + (tail ? 256 : 0)
  const text = 'x'.repeat(inputUnits)
  const stageHeaps = [process.memoryUsage().heapUsed]
  let snapshot = api.createPieceTableSnapshot('')
  const insertStart = performance.now()
  snapshot = api.insertIntoPieceTable(snapshot, 0, text)
  const insertMs = performance.now() - insertStart
  stageHeaps.push(process.memoryUsage().heapUsed)
  if (!tail) snapshot = api.insertIntoPieceTable(snapshot, snapshot.length, 'z')
  const deleteStart = performance.now()
  snapshot = api.deleteFromPieceTable(snapshot, 0, inputUnits - (tail ? 64 : keep))
  const deleteMs = performance.now() - deleteStart
  stageHeaps.push(process.memoryUsage().heapUsed)
  const reclaimStart = performance.now()
  snapshot = reclaim(snapshot)
  const reclaimMs = performance.now() - reclaimStart
  stageHeaps.push(process.memoryUsage().heapUsed)
  return {
    snapshot,
    inputUnits,
    expected: tail ? 'x'.repeat(64) : 'x'.repeat(keep) + 'z',
    stageHeaps,
    timings: { insertMs, deleteMs, reclaimMs, totalMs: insertMs + deleteMs + reclaimMs },
  }
}

function run() {
  const rows = []
  for (const scenario of scenarios) {
    for (let index = 0; index < samples; index++) {
      rows.push({ sample: index + 1, ...runSample(scenario) })
    }
  }
  const report = {
    label: values.label,
    node: process.version,
    note: 'Fresh Node process per sample. Heap after forced GC; peak sampled after input creation, insertion, deletion and reclamation, not continuous. Timings are cold operations. Reclamation drains all cooperative steps synchronously.',
    rows,
  }
  const output = JSON.stringify(report, null, 2) + '\n'
  if (values.output) writeFileSync(values.output, output)
  process.stdout.write(output)
}

function runSample(scenario) {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      fileURLToPath(import.meta.url),
      '--child',
      '--scenario',
      scenario,
      '--units',
      values.units,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr || String(result.error))
  return JSON.parse(result.stdout)
}
