// What position metadata still costs per insertion once tombstones are compacted,
// against the same edits with text reclamation only. V8 heap after two forced
// collections, one fresh process per sample. Run with `node --expose-gc`.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
} from '../../packages/textbuffer/dist/index.js'
import { compactPieceTableTombstones } from '../../packages/textbuffer/dist/compaction.js'
import { reclaimPieceTableText } from '../../packages/textbuffer/dist/reclamation.js'

const PASS_EVERY = 2000

function live() {
  globalThis.gc()
  globalThis.gc()
  return process.memoryUsage().heapUsed
}

// Fifty spots in the original text each get an insert that is deleted again.
function sample(cycles, compacted) {
  let snapshot = createPieceTableSnapshot('prefix suffix '.repeat(300))
  const baseline = live()
  const pass = () => {
    if (compacted) compactPieceTableTombstones(snapshot)
    snapshot = reclaimPieceTableText(snapshot)
  }
  for (let cycle = 0; cycle < cycles; cycle++) {
    const at = 7 + (cycle % 50) * 13
    const text = `p${cycle} `
    snapshot = deleteFromPieceTable(insertIntoPieceTable(snapshot, at, text), at, text.length)
    if (cycle % PASS_EVERY === PASS_EVERY - 1) pass()
  }
  pass()
  return {
    cycles,
    compacted,
    pieces: snapshot.pieceCount,
    ids: snapshot.buffers.nextBufferSequence,
    bytes: live() - baseline,
  }
}

function isolated(cycles, compacted) {
  const script = fileURLToPath(import.meta.url)
  const args = ['--expose-gc', script, '--sample', String(cycles), compacted ? '1' : '0']
  return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }))
}

function bytesPerId(runs, compacted) {
  const mean = (cycles) => {
    const matching = runs.filter((run) => run.cycles === cycles && run.compacted === compacted)
    return {
      bytes: matching.reduce((sum, run) => sum + run.bytes, 0) / matching.length,
      ids: matching[0].ids,
    }
  }
  const small = mean(20000)
  const large = mean(100000)
  return (large.bytes - small.bytes) / (large.ids - small.ids)
}

if (process.argv[2] === '--sample') {
  console.log(JSON.stringify(sample(Number(process.argv[3]), process.argv[4] === '1')))
} else {
  const runs = []
  for (let round = 0; round < 3; round++) {
    for (const compacted of [true, false]) {
      for (const cycles of [20000, 100000]) runs.push(isolated(cycles, compacted))
    }
  }
  console.log(
    JSON.stringify(
      {
        runtime: `Node ${process.version}`,
        measuredAt: new Date().toISOString(),
        note: `Text reclamation runs every ${PASS_EVERY} cycles in both; compaction only where compacted. Bytes are V8 heapUsed after two forced collections, relative to the fresh snapshot. The slope between 20,000 and 100,000 cycles is the cost of one more insertion.`,
        bytesPerInsertion: {
          compacted: bytesPerId(runs, true),
          control: bytesPerId(runs, false),
        },
        runs,
      },
      null,
      2,
    ),
  )
}
