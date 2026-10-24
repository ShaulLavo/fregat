import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
} from '@singapore-editor/textbuffer'
import {
  createPieceTreeInspectionSession,
  formatPieceTree,
  validatePieceTreeInvariants,
} from '@singapore-editor/textbuffer/debug'

function measure<T>(operation: string, run: () => T) {
  Bun.gc(true)
  const heapBefore = process.memoryUsage().heapUsed
  const start = performance.now()
  const result = run()
  const ms = performance.now() - start
  const heapBeforeCollection = process.memoryUsage().heapUsed - heapBefore
  Bun.gc(true)
  const retainedHeapBytes = process.memoryUsage().heapUsed - heapBefore
  return { result, cost: { operation, ms, heapBeforeCollection, retainedHeapBytes } }
}

let snapshot = createPieceTableSnapshot('row\n'.repeat(1000000))
let seed = 123
const edits = measure('10000 inserts and 3334 deletes, inspection disabled', () => {
  for (let i = 0; i < 10000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const offset = seed % (snapshot.length + 1)
    snapshot = insertIntoPieceTable(snapshot, offset, `${i}\n`)
    if (i % 3 === 0) snapshot = deleteFromPieceTable(snapshot, offset, 1)
  }
})
const validation = measure('validate', () => validatePieceTreeInvariants(snapshot))
const session = createPieceTreeInspectionSession()
const records = measure('inspect records, text hidden', () => session.inspect(snapshot))
const after = deleteFromPieceTable(snapshot, 100, 20)
const comparison = measure('compare two roots, text hidden', () => session.compare(snapshot, after))
const formatted = measure('format, 200 rows', () => formatPieceTree(snapshot))
console.log(
  JSON.stringify(
    {
      runtime: Bun.version,
      fixture: {
        initialLines: 1000000,
        nodes: validation.result.counts.nodes,
        reverseEntries: validation.result.counts.reverseEntries,
        visibleLength: snapshot.length,
        edits: 13334,
        seed: 123,
      },
      issues: validation.result.issues,
      costs: [edits.cost, validation.cost, records.cost, comparison.cost, formatted.cost],
      output: {
        records: records.result.nodes.length,
        changes: comparison.result.changes.length,
        formattedCharacters: formatted.result.length,
      },
      memoryNote:
        'Heap deltas are GC-sensitive live-heap estimates, not total allocated bytes. Retained deltas may be negative when unrelated objects are collected.',
    },
    null,
    2,
  ),
)
