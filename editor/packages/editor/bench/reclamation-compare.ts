import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  anchorAfter,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  readPieceTableTextRange,
  resolveAnchor,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import { generateFixture } from '../../../examples/stress/src/fixtures'
import { storageExtent } from './reclamation'

type Mode = 'control' | 'reclaim'
type Reclaim = (snapshot: PieceTableSnapshot) => PieceTableSnapshot

function payloadFor(cycle: number) {
  return `😀e\u0301\n${cycle.toString().padStart(8, '0')}${'x'.repeat(1011)}`
}

function heap() {
  Bun.gc(true)
  return process.memoryUsage().heapUsed
}

function distribution(samples: number[]) {
  samples.sort((a, b) => a - b)
  return {
    samples: samples.length,
    p50Ms: samples[Math.floor(samples.length * 0.5)] ?? 0,
    p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 0,
    maxMs: samples.at(-1) ?? 0,
  }
}

function churn(seed: number, cycles: number, reclaim: Reclaim) {
  const text = generateFixture('ordinary', seed)
  let snapshot = createPieceTableSnapshot(text)
  const pinned: PieceTableSnapshot[] = []
  const editTimes: number[] = []
  const maintenanceTimes: number[] = []
  const readTimes: number[] = []
  let anchor = anchorAfter(snapshot, 7)
  for (let cycle = 0; cycle < cycles; cycle++) {
    const payload = payloadFor(cycle)
    const start = performance.now()
    snapshot = insertIntoPieceTable(snapshot, 7, payload)
    const insertedAt = performance.now()
    if (cycle === 0) anchor = anchorAfter(snapshot, 10)
    if (cycle % 100 === 0) pinned.push(snapshot)
    const deleteAt = performance.now()
    snapshot = deleteFromPieceTable(snapshot, 7, payload.length)
    editTimes.push(insertedAt - start + performance.now() - deleteAt)
    const readAt = performance.now()
    const read = readPieceTableTextRange(snapshot, 0, 80)
    readTimes.push(performance.now() - readAt)
    assert.equal(read, text.slice(0, 80))
    if ((cycle + 1) % 250 !== 0) continue
    const maintenanceAt = performance.now()
    snapshot = reclaim(snapshot)
    maintenanceTimes.push(performance.now() - maintenanceAt)
  }
  assert.equal(materializePieceTableFullText(snapshot), text)
  assert.deepEqual(resolveAnchor(snapshot, anchor), { offset: 7, liveness: 'deleted' })
  for (const [index, old] of pinned.entries()) {
    assert.equal(
      materializePieceTableFullText(old),
      text.slice(0, 7) + payloadFor(index * 100) + text.slice(7),
    )
  }
  return { snapshot, pinned, editTimes, maintenanceTimes, readTimes }
}

async function sample(mode: Mode, seed: number, cycles: number) {
  const reclaim: Reclaim =
    mode === 'reclaim'
      ? (await import('@singapore-editor/textbuffer/internal/reclamation')).reclaimPieceTableText
      : (snapshot) => snapshot
  churn(seed, 100, reclaim)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const beforeHeap = heap()
  const run = churn(seed, cycles, reclaim)
  const heapWithPins = heap() - beforeHeap
  const pinnedRoots = run.pinned.length
  run.pinned.length = 0
  const heapAfterRelease = heap() - beforeHeap
  const extent = storageExtent(run.snapshot)
  assert.deepEqual(extent.invariantIssues, [])
  return {
    mode,
    seed,
    cycles,
    pinnedRoots,
    heapWithPins,
    heapAfterRelease,
    extent,
    editPair: distribution(run.editTimes),
    rangeRead: distribution(run.readTimes),
    maintenance: distribution(run.maintenanceTimes),
  }
}

function isolatedSample(mode: Mode, seed: number, cycles: number): unknown {
  const output = execFileSync(
    process.execPath,
    [import.meta.path, '--sample', mode, String(seed), String(cycles)],
    { encoding: 'utf8' },
  )
  return JSON.parse(output)
}

function suite(reference: boolean) {
  const runs = []
  for (const seed of [60061, 60062, 60063]) {
    for (const cycles of [1000, 5000, 10000]) {
      runs.push(isolatedSample('control', seed, cycles))
      if (!reference) runs.push(isolatedSample('reclaim', seed, cycles))
    }
  }
  return {
    runtime: `Bun ${Bun.version}`,
    measuredAt: new Date().toISOString(),
    baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    reference,
    note: 'One isolated process per sample. Raw piece-table edits and reads, not editor input/paint. Reclaim every 250 cycles. GC-sensitive heap deltas include timing arrays. Chunk extents count code units, not physical bytes.',
    runs,
  }
}

if (process.argv[2] !== '--sample') {
  console.log(JSON.stringify(suite(process.argv[2] === '--reference'), null, 2))
} else {
  const mode = process.argv[3]
  const seed = Number(process.argv[4])
  const cycles = Number(process.argv[5])
  assert.ok(mode === 'control' || mode === 'reclaim')
  assert.ok(Number.isSafeInteger(seed) && Number.isSafeInteger(cycles) && cycles > 0)
  console.log(JSON.stringify(await sample(mode, seed, cycles)))
}
