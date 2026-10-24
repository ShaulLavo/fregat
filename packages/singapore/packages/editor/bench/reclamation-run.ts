import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  anchorAfter,
  materializePieceTableFullText,
  readPieceTableTextRange,
  resolveAnchor,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '../src/documentSession'
import { generateFixture } from '../../../examples/stress/src/fixtures'
import { anchorRemovalProbe, branchIdentityProbe, storageExtent } from './reclamation'

function heapUsed() {
  Bun.gc(true)
  return process.memoryUsage().heapUsed
}

function distribution(samples: number[]) {
  samples.sort((a, b) => a - b)
  return {
    samples: samples.length,
    p50Ms: samples[Math.floor(samples.length * 0.5)],
    p95Ms: samples[Math.floor(samples.length * 0.95)],
    maxMs: samples.at(-1),
  }
}

function measureChurn(cycles: number, retainedHistoryStates: number, seed: number) {
  const baselineHeap = heapUsed()
  const text = generateFixture('ordinary', seed)
  const buffer = createEditorTextBuffer(text, { retainedHistoryStates })
  const views = [0, 1, 2].map((id) => createEditorViewSession(buffer, `retention-${id}`))
  const session = createEditorBufferSession(buffer, views[0])
  const payload = '😀e\u0301\n' + 'x'.repeat(1019)
  const at = 7
  const pinned: PieceTableSnapshot[] = []
  const edits: number[] = []
  const reads: number[] = []
  session.applyEdits([{ from: at, to: at, text: payload }])
  const anchor = anchorAfter(buffer.getSnapshot(), at + 3)
  pinned.push(buffer.getSnapshot())
  session.applyEdits([{ from: at, to: at + payload.length, text: '' }])
  for (let cycle = 0; cycle < cycles; cycle++) {
    const start = performance.now()
    session.applyEdits([{ from: at, to: at, text: payload }])
    session.applyEdits([{ from: at, to: at + payload.length, text: '' }])
    edits.push(performance.now() - start)
    const readStart = performance.now()
    assert.equal(readPieceTableTextRange(buffer.getSnapshot(), 0, 80), text.slice(0, 80))
    reads.push(performance.now() - readStart)
    if (cycle % 100 === 0) pinned.push(buffer.getSnapshot())
  }
  assert.equal(buffer.materializeFullText(), text)
  assert.equal(
    materializePieceTableFullText(pinned[0]!),
    text.slice(0, at) + payload + text.slice(at),
  )
  assert.deepEqual(resolveAnchor(buffer.getSnapshot(), anchor), { offset: at, liveness: 'deleted' })
  for (const snapshot of pinned) assert.equal(storageExtent(snapshot).invariantIssues.length, 0)
  const pinnedRoots = pinned.length
  const heapWithPins = heapUsed() - baselineHeap
  pinned.length = 0
  const heapAfterRelease = heapUsed() - baselineHeap
  const beforeClear = buffer.getHistoryGraph().nodes.length
  buffer.clearHistory()
  buffer.markClean()
  const heapAfterHistoryClear = heapUsed() - baselineHeap
  const storage = storageExtent(buffer.getSnapshot())
  assert.equal(storage.invariantIssues.length, 0)
  assert.equal(buffer.isDirty(), false)
  assert.equal(views.length, 3)
  return {
    cycles,
    seed,
    payloadCodeUnits: payload.length,
    retainedHistoryStates,
    historyNodesBeforeClear: beforeClear,
    historyNodesAfterClear: buffer.getHistoryGraph().nodes.length,
    pinnedRoots,
    heapWithPins,
    heapAfterRelease,
    heapAfterHistoryClear,
    storageAfterReleaseAndHistoryClear: storage,
    editPair: distribution(edits),
    read80Units: distribution(reads),
  }
}

function isolatedRun(cycles: number, history: number, seed: number): unknown {
  const output = execFileSync(
    process.execPath,
    [import.meta.path, '--sample', String(cycles), String(history), String(seed)],
    { encoding: 'utf8' },
  )
  return JSON.parse(output)
}

async function runSample() {
  const [cycles, history, seed] = process.argv.slice(3).map(Number)
  assert.ok(Number.isInteger(cycles) && cycles > 0)
  assert.ok(Number.isInteger(history) && history >= 0)
  assert.ok(Number.isInteger(seed))
  measureChurn(100, 0, seed)
  await new Promise((resolve) => setTimeout(resolve, 0))
  console.log(JSON.stringify(measureChurn(cycles, history, seed)))
}

function runSuite() {
  const runs = []
  for (const seed of [60061, 60062, 60063]) {
    for (const cycles of [100, 1000, 5000]) runs.push(isolatedRun(cycles, 200, seed))
  }
  runs.push(isolatedRun(5000, 0, 60061))
  console.log(
    JSON.stringify(
      {
        baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        runtime: `Bun ${Bun.version}`,
        measuredAt: new Date().toISOString(),
        note: 'One subprocess per sample, after warmup. Headless buffer/session operations, not keystroke-to-paint. Heap deltas are GC-sensitive. Extent counts deduplicate shared chunks; UTF-16 units are not physical heap bytes. Three view sessions, no mounted renderer.',
        runs,
        anchorRemoval: anchorRemovalProbe(),
        branchIdentity: branchIdentityProbe(),
      },
      null,
      2,
    ),
  )
}

if (process.argv[2] === '--sample') await runSample()
else runSuite()
