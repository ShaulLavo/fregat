import { createStringTextSnapshot, type TextReadSnapshot } from '@singapore-editor/core/document'
import { expect, it } from 'vitest'
import {
  documentSummaryPayload,
  documentSummaryPatchPayload,
  sequentialMinimapEdits,
  summarySource,
} from '../src/summary'

function measuredRead(text: string) {
  const source = createStringTextSnapshot(text)
  const ranges: Array<readonly [number, number]> = []
  let lineQueries = 0
  const read: TextReadSnapshot = {
    length: source.length,
    lineCount: source.lineCount,
    lineStart: (line) => {
      lineQueries++
      return source.lineStart(line)
    },
    lineRange: (line) => {
      lineQueries++
      return source.lineRange(line)
    },
    lineAt: (offset) => {
      lineQueries++
      return source.lineAt(offset)
    },
    readRange: (from, to) => {
      ranges.push([from, to])
      return source.readRange(from, to)
    },
    forEachTextChunk: () => expect.unreachable('Clipped projection streamed the whole document'),
  }
  return { read, ranges, lineQueries: () => lineQueries }
}

it('keeps UTF-16 offsets, CRLF line lengths and clipped source volume', () => {
  const source = measuredRead('ab😀\r\ncdefghijkl\n尾')
  expect(documentSummaryPayload(source.read, 4)).toEqual({
    textLength: 18,
    lineStarts: [0, 6, 17],
    lines: [
      { text: 'ab😀', length: 5 },
      { text: 'cdef', length: 10 },
      { text: '尾', length: 1 },
    ],
  })
  expect(source.ranges).toEqual([
    [0, 4],
    [6, 10],
    [17, 18],
  ])
})

it('reads only the prefix of a one-million-unit line', () => {
  const source = measuredRead('x'.repeat(1_000_000))
  expect(documentSummaryPayload(source.read, 16).lines).toEqual([
    { text: 'x'.repeat(16), length: 1_000_000 },
  ])
  expect(source.ranges).toEqual([[0, 16]])
})

it('projects a sparse edit without scanning the document line index', () => {
  const original = 'ab\n'.repeat(20_000)
  const offset = 30_001
  const before = measuredRead(original)
  const next = measuredRead(original.slice(0, offset) + 'X' + original.slice(offset))
  const payload = documentSummaryPatchPayload(
    next.read,
    summarySource(before.read),
    [{ from: offset, to: offset, text: 'X' }],
    4,
    { textLength: before.read.length, lineCount: before.read.lineCount },
  )
  expect(payload).toEqual({
    textLength: 60_001,
    startLine: 10_000,
    deleteCount: 1,
    lines: [{ text: 'aXb', length: 3 }],
  })
  expect(next.ranges).toEqual([[30_000, 30_003]])
  expect(before.lineQueries() + next.lineQueries()).toBeLessThan(16)
})

it('covers coalesced newline insertion and its undo through immutable baselines', () => {
  const before = measuredRead('a\n😀b\r\nz')
  const after = measuredRead('a\nx\ny\n😀b\r\nz')
  const patch = documentSummaryPatchPayload(
    after.read,
    summarySource(before.read),
    [{ from: 2, to: 2, text: 'x\ny\n' }],
    8,
    { textLength: before.read.length, lineCount: before.read.lineCount },
  )
  const initial = documentSummaryPayload(before.read, 8)
  const restored = [...initial.lines]
  restored.splice(patch.startLine, patch.deleteCount, ...patch.lines)
  expect(restored).toEqual(documentSummaryPayload(after.read, 8).lines)
  const undo = documentSummaryPatchPayload(
    before.read,
    summarySource(after.read),
    [{ from: 2, to: 6, text: '' }],
    8,
    { textLength: after.read.length, lineCount: after.read.lineCount },
  )
  restored.splice(undo.startLine, undo.deleteCount, ...undo.lines)
  expect(restored).toEqual(initial.lines)
})

it('covers a distant replacement after a large prefix insertion from canonical edits', () => {
  const before = measuredRead('abc\n'.repeat(20_000))
  const prefix = 'x'.repeat(60_000)
  const after = measuredRead(`a${prefix}bc\n${'abc\n'.repeat(14_999)}aYc\n${'abc\n'.repeat(4_999)}`)
  const canonical = [
    { from: 1, to: 1, text: prefix },
    { from: 60_001, to: 60_002, text: 'Y' },
  ]
  const patch = documentSummaryPatchPayload(
    after.read,
    summarySource(before.read),
    sequentialMinimapEdits(canonical),
    4,
    { textLength: before.read.length, lineCount: before.read.lineCount },
  )
  const lines = [...documentSummaryPayload(before.read, 4).lines]
  lines.splice(patch.startLine, patch.deleteCount, ...patch.lines)
  expect(lines[15_000]).toEqual({ text: 'aYc', length: 3 })
  expect(lines).toEqual(documentSummaryPayload(after.read, 4).lines)
})
