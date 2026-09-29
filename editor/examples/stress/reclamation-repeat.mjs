import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
} from '../../packages/textbuffer/dist/index.js'
import { bufferSpanAt } from '../../packages/textbuffer/dist/buffers.js'
import { reclaimPieceTableText } from '../../packages/textbuffer/dist/reclamation.js'
import { createTreeSitterSourceDescriptor } from '../../packages/tree-sitter/dist/treeSitter/source.js'

const units = 50 * 1024 * 1024
const original = createPieceTableSnapshot('x'.repeat(units))
const appended = insertIntoPieceTable(original, units, 'tail')
const first = reclaimPieceTableText(deleteFromPieceTable(appended, units / 2, 10))
const prefix = bufferSpanAt(first.buffers, first.buffers.original, 0)
const before = createTreeSitterSourceDescriptor(first)
const sentChunkLengths = new Map(before.chunks.map((chunk) => [chunk.chunkId, chunk.text.length]))
const deleted = deleteFromPieceTable(first, units - 100, 10)
const started = performance.now()
const second = reclaimPieceTableText(deleted)
const reclaimMs = performance.now() - started
const descriptorStarted = performance.now()
const after = createTreeSitterSourceDescriptor(second, { sentChunkLengths })
const descriptorMs = performance.now() - descriptorStarted
const resentUnits = after.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
assert.equal(bufferSpanAt(second.buffers, second.buffers.original, 0), prefix)
assert.equal(after.pieces.at(-1).chunkId, before.pieces.at(-1).chunkId)
assert.ok(resentUnits < 16384)
assert.equal(second.length, units - 20 + 4)
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      units,
      deletedUnits: 10,
      resentUnits,
      newWorkerChunks: after.chunks.length,
      reusedPrefixSpan: true,
      reusedTailId: true,
      reclaimMs,
      descriptorMs,
    },
    null,
    2,
  ),
)
