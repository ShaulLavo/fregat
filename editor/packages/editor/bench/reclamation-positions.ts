import assert from 'node:assert/strict'
import { heapStats } from 'bun:jsc'
import { execFileSync } from 'node:child_process'
import {
  anchorAt,
  resolveAnchor,
  type RealAnchor,
  type ResolvedAnchor,
} from '@singapore-editor/textbuffer'
import { reverseIndexEntries } from '@singapore-editor/textbuffer/internal/reverseIndex'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/documentSession'
import { generateFixture } from '../../../examples/stress/src/fixtures'
import { storageExtent } from './reclamation'

// E006 position metadata: whether the current tree and its index stop growing
// with edit count once maintenance runs, against the same edits without it.
// Headless buffer and session with real maintenance; not keystroke-to-paint.

type Workload = 'paragraph' | 'backspace' | 'scattered' | 'append'
const SAVE_EVERY = 500
// A maintenance slice that takes a frame is a visible stall.
const SLICE_LIMIT_MS = 16

function heapUsed() {
  Bun.gc(true)
  return process.memoryUsage().heapUsed
}

// JSC's count of live bytes after a full collection. heapUsed also counts
// memory the collector has not returned, which drifts with allocation volume.
function liveHeap() {
  Bun.gc(true)
  return heapStats().heapSize
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Maintenance times its slices with performance.now. A sample runs it on this
// thread's CPU time instead, so other processes cannot stretch a slice.
const wallNow = performance.now.bind(performance)
function timeSlicesOnThisThread() {
  performance.now = () => {
    const usage = process.threadCpuUsage()
    return (usage.user + usage.system) / 1000
  }
}

function randomSource(seed: number) {
  let state = seed >>> 0
  return (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % limit
  }
}

type Buffer = ReturnType<typeof createEditorTextBuffer>
type Session = ReturnType<typeof createEditorBufferSession>

// A save forces a pass; waiting for it to settle stands in for a pause in typing.
async function settle(buffer: Buffer, maintained: boolean) {
  buffer.markClean()
  if (!maintained) return
  const completed = buffer.getStorageMaintenanceStats().completed
  for (let poll = 0; poll < 400; poll++) {
    await sleep(poll === 0 ? 320 : 10)
    if (buffer.getStorageMaintenanceStats().completed > completed) return
  }
  assert.fail(`maintenance did not settle: ${completed} passes before, none after 4 seconds`)
}

function paragraphCycle(session: Session, buffer: Buffer, cycle: number, held: RealAnchor[]) {
  const payload = `paragraph ${cycle} `.padEnd(1024, 'x')
  session.applyEdits([{ from: 7, to: 7, text: payload }])
  if (cycle % 50 === 0) {
    held.push(anchorAt(buffer.getSnapshot(), 9, 'left'), anchorAt(buffer.getSnapshot(), 9, 'right'))
  }
  session.applyEdits([{ from: 7, to: 7 + payload.length, text: '' }])
}

// Typed one unit at a time, then backspaced one unit at a time: a tombstone per unit.
function backspaceCycle(session: Session, buffer: Buffer, cycle: number, held: RealAnchor[]) {
  const at = ((cycle * 7919) % 64) * 16
  for (const unit of 'word') {
    const end = buffer.getSnapshot().length
    session.applyEdits([{ from: Math.min(at, end), to: Math.min(at, end), text: unit }])
  }
  if (cycle % 50 === 0) held.push(anchorAt(buffer.getSnapshot(), at + 2, 'right'))
  for (let unit = 4; unit > 0; unit--) {
    session.applyEdits([{ from: at + unit - 1, to: at + unit, text: '' }])
  }
}

// Appended text between deleted appends: each cycle's tombstones are blocked by a
// different visible piece, so the trailing run keeps a stand-in per cycle.
function appendCycle(session: Session, buffer: Buffer, cycle: number, held: RealAnchor[]) {
  const end = buffer.getSnapshot().length
  session.applyEdits([{ from: end, to: end, text: 'x' }])
  for (let twice = 0; twice < 2; twice++) {
    session.applyEdits([{ from: end + 1, to: end + 1, text: 'y' }])
    if (cycle % 50 === 0)
      held.push(anchorAt(buffer.getSnapshot(), end + 1, twice ? 'left' : 'right'))
    session.applyEdits([{ from: end + 1, to: end + 2, text: '' }])
  }
}

// Inserts, deletes and replacements anywhere, steered to keep the fixture's length.
function scatteredCycle(
  session: Session,
  buffer: Buffer,
  random: (limit: number) => number,
  cycle: number,
  held: RealAnchor[],
  target: number,
) {
  const length = buffer.getSnapshot().length
  const from = random(length + 1)
  const to = Math.min(length, from + 1 + random(20))
  const insert = length < target ? random(3) !== 0 : random(3) === 0
  const text = 'scattered text here '.slice(0, 1 + random(20))
  if (insert) session.applyEdits([{ from, to: from, text }])
  else if (random(4) === 0) session.applyEdits([{ from, to, text: 'swap' }])
  else session.applyEdits([{ from, to, text: '' }])
  if (cycle % 50 === 0) {
    const at = random(buffer.getSnapshot().length + 1)
    held.push(anchorAt(buffer.getSnapshot(), at, cycle % 100 ? 'left' : 'right'))
  }
}

async function measure(workload: Workload, cycles: number, maintained: boolean, seed: number) {
  const baselineHeap = heapUsed()
  const baselineLive = liveHeap()
  const text = generateFixture('ordinary', seed)
  const buffer = createEditorTextBuffer(text)
  const session = createEditorBufferSession(buffer)
  const unsubscribe = maintained ? buffer.subscribe(() => {}) : () => {}
  const random = randomSource(seed)
  const held: RealAnchor[] = []
  const passStarts: number[] = []
  const editStart = wallNow()
  for (let cycle = 0; cycle < cycles; cycle++) {
    if (workload === 'paragraph') paragraphCycle(session, buffer, cycle, held)
    else if (workload === 'backspace') backspaceCycle(session, buffer, cycle, held)
    else if (workload === 'append') appendCycle(session, buffer, cycle, held)
    else scatteredCycle(session, buffer, random, cycle, held, text.length)
    if (cycle % SAVE_EVERY !== SAVE_EVERY - 1) continue
    passStarts.push(buffer.getSnapshot().pieceCount)
    await settle(buffer, maintained)
  }
  const editMs = wallNow() - editStart
  const resolved: ResolvedAnchor[] = held.map((anchor) =>
    resolveAnchor(buffer.getSnapshot(), anchor),
  )
  const piecesBeforeRelease = buffer.getSnapshot().pieceCount
  await settle(buffer, maintained)
  const liveHeapWithHistory = liveHeap() - baselineLive
  buffer.clearHistory()
  await settle(buffer, maintained)
  const snapshot = buffer.getSnapshot()
  const storage = storageExtent(snapshot)
  assert.equal(storage.invariantIssues.length, 0)
  const stats = buffer.getStorageMaintenanceStats()
  const heapAfterRelease = heapUsed() - baselineHeap
  const liveHeapAfterRelease = liveHeap() - baselineLive
  unsubscribe()
  return {
    workload,
    cycles,
    maintained,
    seed,
    liveCodeUnits: snapshot.length,
    piecesBeforeRelease,
    piecesAtSaves: passStarts,
    piecesAfterRelease: snapshot.pieceCount,
    reverseEntries: reverseIndexEntries(snapshot.reverseIndex).length,
    bufferIds: storage.bufferIds,
    lineIndexCapacityBytes: storage.lineIndexCapacityBytes,
    storedCodeUnits: storage.storedCodeUnits,
    liveHeapWithHistory,
    heapAfterRelease,
    liveHeapAfterRelease,
    maintenance: {
      completed: stats.completed,
      tombstones: stats.tombstones,
      maxSliceMs: stats.maxSliceMs,
    },
    editMs,
    resolved,
  }
}

function isolatedRun(workload: Workload, cycles: number, maintained: boolean, seed: number) {
  const output = execFileSync(
    process.execPath,
    [import.meta.path, '--sample', workload, String(cycles), maintained ? '1' : '0', String(seed)],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return JSON.parse(output) as Awaited<ReturnType<typeof measure>>
}

async function runSample() {
  timeSlicesOnThisThread()
  const [workload, cycles, maintained, seed] = process.argv.slice(3)
  await measure(workload as Workload, 200, maintained === '1', Number(seed))
  console.log(
    JSON.stringify(
      await measure(workload as Workload, Number(cycles), maintained === '1', Number(seed)),
    ),
  )
}

function runSuite() {
  const seed = 60061
  const runs = []
  for (const workload of ['paragraph', 'backspace', 'scattered', 'append'] as const) {
    for (const cycles of [1000, 5000, 20000]) {
      const control = isolatedRun(workload, cycles, false, seed)
      const candidate = isolatedRun(workload, cycles, true, seed)
      // The deleted-anchor comparison against the unreclaimed control.
      assert.deepEqual(candidate.resolved, control.resolved, `${workload} ${cycles}`)
      assert.ok(
        candidate.maintenance.maxSliceMs < SLICE_LIMIT_MS,
        `${workload} ${cycles}: a ${candidate.maintenance.maxSliceMs.toFixed(1)} ms maintenance slice`,
      )
      const { resolved: controlResolved, ...controlRun } = control
      const { resolved: candidateResolved, ...candidateRun } = candidate
      runs.push({
        ...candidateRun,
        heldAnchors: candidateResolved.length,
        deletedHeldAnchors: candidateResolved.filter((item) => item.liveness === 'deleted').length,
        control: controlRun,
        anchorsMatchControl: controlResolved.length === candidateResolved.length,
      })
    }
  }
  console.log(
    JSON.stringify(
      {
        baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        runtime: `Bun ${Bun.version}`,
        measuredAt: new Date().toISOString(),
        note: `One subprocess per sample, after a 200-cycle warmup. A save every ${SAVE_EVERY} cycles forces a maintenance pass, and no slice may reach ${SLICE_LIMIT_MS} ms of this thread's CPU time; the control never subscribes, so maintenance never runs. Default 200 history states until the final release. heapAfterRelease is Bun heapUsed and liveHeapAfterRelease is JSC heapStats().heapSize, each after a forced GC and relative to the process baseline; both include runtime state beyond the buffer.`,
        runs,
      },
      null,
      2,
    ),
  )
}

if (process.argv[2] === '--sample') await runSample()
else runSuite()
