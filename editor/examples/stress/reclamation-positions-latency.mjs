// The longest single step of the compaction job, on a trailing run that keeps a
// stand-in per cycle: append x, then append and delete y twice, compacting every
// 1,000 cycles. Each step is timed on the wall clock and in this thread's CPU
// time, which other processes cannot stretch. Three fresh Node processes per length.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
} from '../../packages/textbuffer/dist/index.js'
import { compactTombstones } from '../../packages/textbuffer/dist/compaction.js'

function cpuMs() {
  const usage = process.threadCpuUsage()
  return (usage.user + usage.system) / 1000
}

function sample(length) {
  let snapshot = createPieceTableSnapshot('')
  const steps = []
  let longestCpuMs = 0
  for (let cycle = 0; snapshot.length < length; cycle++) {
    snapshot = insertIntoPieceTable(snapshot, snapshot.length, 'x')
    for (let twice = 0; twice < 2; twice++) {
      snapshot = insertIntoPieceTable(snapshot, snapshot.length, 'y')
      snapshot = deleteFromPieceTable(snapshot, snapshot.length - 1, 1)
    }
    if (cycle % 1000 !== 999) continue
    const job = compactTombstones(snapshot)
    for (let done = false; !done;) {
      const start = performance.now()
      const cpuStart = cpuMs()
      done = job.next().done === true
      longestCpuMs = Math.max(longestCpuMs, cpuMs() - cpuStart)
      steps.push(performance.now() - start)
    }
  }
  steps.sort((left, right) => right - left)
  return {
    length,
    pieces: snapshot.pieceCount,
    steps: steps.length,
    longestMs: steps[0],
    longestCpuMs,
    p999Ms: steps[Math.floor(steps.length / 1000)],
  }
}

if (process.argv[2] === '--sample') {
  console.log(JSON.stringify(sample(Number(process.argv[3]))))
} else {
  const script = fileURLToPath(import.meta.url)
  const lengths = [4000, 8000, 16000]
  const results = lengths.map((length) => {
    const runs = [0, 1, 2].map(() =>
      JSON.parse(
        execFileSync(process.execPath, [script, '--sample', String(length)], { encoding: 'utf8' }),
      ),
    )
    return {
      length,
      longestMs: Math.min(...runs.map((run) => run.longestMs)),
      longestCpuMs: Math.min(...runs.map((run) => run.longestCpuMs)),
      runs,
    }
  })
  console.log(
    JSON.stringify(
      { runtime: `Node ${process.version}`, measuredAt: new Date().toISOString(), results },
      null,
      2,
    ),
  )
}
