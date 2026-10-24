import assert from 'node:assert/strict'
import {
  createPieceTableSnapshot,
  insertIntoPieceTable,
  lineRange,
  materializePieceTableFullText,
  readPieceTableLine,
} from '@singapore-editor/textbuffer'
import { validatePieceTreeInvariants } from '@singapore-editor/textbuffer/debug'
import { setTextBufferDiagnosticSink } from '@singapore-editor/textbuffer/diagnostics'
import { getBufferText } from '@singapore-editor/textbuffer/internal/buffers'

const original = createPieceTableSnapshot('abc\n😀')
const changed = insertIntoPieceTable(original, 1, 'X')
assert.equal(materializePieceTableFullText(original), 'abc\n😀')
assert.equal(materializePieceTableFullText(changed), 'aXbc\n😀')
assert.deepEqual(lineRange(changed, 0), { start: 0, end: 4 })
assert.equal(readPieceTableLine(changed, 1), '😀')
assert.equal(getBufferText(original.buffers, original.buffers.original), 'abc\n😀')
assert.equal(typeof validatePieceTreeInvariants, 'function')
assert.equal(typeof setTextBufferDiagnosticSink, 'function')
console.log('Published ESM entry points and persistent snapshot smoke test passed')
