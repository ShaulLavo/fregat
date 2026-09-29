import { describe, expect, test } from 'vitest'
import {
  anchorAfter,
  anchorBefore,
  createPieceTableSnapshot,
  createPieceTableWalker,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  offsetToPoint,
  pointToOffset,
  readPieceTableLine,
  readPieceTableTextRange,
  resolveAnchor,
  resolveAnchorLinear,
  type PieceTableSnapshot,
} from './index'
import {
  BUFFER_CHUNK_SIZE,
  bufferLength,
  bufferSpanAt,
  bufferStorageIdentity,
  bufferStoreExtent,
  copyTextRange,
  forEachBufferSpan,
} from './buffers'
import { reclaimPieceTableText, reclaimSnapshotStorage } from './reclamation'
import { validatePieceTreeInvariants } from './inspection'

function maintain(snapshots: PieceTableSnapshot[]) {
  const job = reclaimSnapshotStorage(snapshots)
  let step = job.next()
  while (!step.done) step = job.next()
  return step.value
}

function expectValid(snapshot: PieceTableSnapshot) {
  expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
}

function expectPositions(snapshot: PieceTableSnapshot, text: string) {
  let row = 0
  let column = 0
  for (let offset = 0; offset <= text.length; offset++) {
    expect(offsetToPoint(snapshot, offset)).toEqual({ row, column })
    expect(pointToOffset(snapshot, { row, column })).toBe(offset)
    if (text[offset] === '\n') {
      row++
      column = 0
    } else column++
  }
  expect(text.split('\n').map((_, at) => readPieceTableLine(snapshot, at))).toEqual(
    text.split('\n'),
  )
}

describe('sparse text reclamation', () => {
  test('reuses whole sparse spans and copies only the span trimmed by a later deletion', () => {
    const original = createPieceTableSnapshot('x'.repeat(200000))
    const first = reclaimPieceTableText(deleteFromPieceTable(original, 90000, 10))
    const before = bufferSpanAt(first.buffers, first.buffers.original, 0)
    const trimmed = bufferSpanAt(first.buffers, first.buffers.original, 180010)
    const second = reclaimPieceTableText(deleteFromPieceTable(first, 180000, 10))
    expect(bufferSpanAt(second.buffers, second.buffers.original, 0)).toBe(before)
    expect(bufferSpanAt(second.buffers, second.buffers.original, 180009).owner).not.toBe(
      trimmed.owner,
    )
    expect(bufferSpanAt(second.buffers, second.buffers.original, 180020).owner).not.toBe(
      trimmed.owner,
    )
    expect(materializePieceTableFullText(second)).toBe('x'.repeat(199980))
    expectValid(second)
  })

  test('shares an unchanged writable tail until either maintenance branch appends', () => {
    const original = createPieceTableSnapshot('x'.repeat(200000))
    const appended = insertIntoPieceTable(original, original.length, 'tail')
    const tail = anchorAfter(appended, original.length + 1)
    const before = bufferSpanAt(appended.buffers, tail.buffer, tail.offset)
    const deleted = deleteFromPieceTable(appended, 90000, 10)
    const compact = reclaimPieceTableText(deleted)
    expect(bufferSpanAt(compact.buffers, tail.buffer, tail.offset).owner).toBe(before.owner)
    const left = insertIntoPieceTable(deleted, deleted.length, 'LEFT')
    const right = insertIntoPieceTable(compact, compact.length, 'RITE')
    const leftSpan = bufferSpanAt(left.buffers, tail.buffer, tail.offset)
    const rightSpan = bufferSpanAt(right.buffers, tail.buffer, tail.offset)
    expect(leftSpan.owner).not.toBe(before.owner)
    expect(rightSpan.owner).not.toBe(before.owner)
    expect(leftSpan.owner).not.toBe(rightSpan.owner)
    expect(leftSpan.owner.page(leftSpan.text, 0, 8).slice(0, 8)).toBe('tailLEFT')
    expect(rightSpan.owner.page(rightSpan.text, 0, 8).slice(0, 8)).toBe('tailRITE')
    expect(materializePieceTableFullText(compact)).toBe('x'.repeat(199990) + 'tail')
  })

  test('reclaims an original-only document while preserving original coordinates and deleted biases', () => {
    const original = createPieceTableSnapshot('head\n' + 'removed\n'.repeat(3000) + 'tail\n')
    const left = anchorBefore(original, 100)
    const right = anchorAfter(original, 100)
    const deleted = deleteFromPieceTable(original, 5, 24000)
    const compact = reclaimPieceTableText(deleted)
    expect(compact).not.toBe(deleted)
    expect(compact.root).toBe(deleted.root)
    expect(compact.buffers.chunks.size).toBe(1)
    expect(bufferLength(compact.buffers, compact.buffers.original)).toBe(original.length)
    expect(materializePieceTableFullText(compact)).toBe('head\ntail\n')
    expect(bufferSpanAt(compact.buffers, compact.buffers.original, 24005).text).toBe('tail\n')
    expect(() => bufferSpanAt(compact.buffers, compact.buffers.original, 100)).toThrow('reclaimed')
    const next = insertIntoPieceTable(compact, 5, 'new\n')
    const sibling = insertIntoPieceTable(compact, 5, 'other\n')
    expect(resolveAnchor(next, left)).toEqual({ offset: 5, liveness: 'deleted' })
    expect(resolveAnchor(next, right)).toEqual({ offset: 9, liveness: 'deleted' })
    expect(resolveAnchorLinear(next, right)).toEqual(resolveAnchor(next, right))
    expect(materializePieceTableFullText(original)).toHaveLength(24010)
    expect(materializePieceTableFullText(sibling)).toBe('head\nother\ntail\n')
    expectPositions(next, 'head\nnew\ntail\n')
    for (const snapshot of [compact, next, sibling]) expectValid(snapshot)
  })

  test('retains original text required by a protected baseline, then releases it', () => {
    const original = createPieceTableSnapshot('prefix' + 'x'.repeat(40000) + 'suffix')
    const current = deleteFromPieceTable(original, 6, 40000)
    expect(maintain([original, current]).codeUnits).toBe(0)
    const oldLog = bufferStorageIdentity(original.buffers)
    expect(maintain([current]).codeUnits).toBe(40000)
    expect(bufferStorageIdentity(current.buffers)).not.toBe(oldLog)
    expect(materializePieceTableFullText(original)).toBe('prefix' + 'x'.repeat(40000) + 'suffix')
    expect(materializePieceTableFullText(current)).toBe('prefixsuffix')
    expect(maintain([current]).codeUnits).toBe(0)
    expectValid(current)
  })

  test('retires the entire original while later appends and old empty-original semantics remain valid', () => {
    const original = createPieceTableSnapshot('original\n')
    const anchor = anchorAfter(original, 3)
    const compact = reclaimPieceTableText(deleteFromPieceTable(original, 0, original.length))
    expect(compact.buffers.chunks.get(compact.buffers.original)).toBeUndefined()
    expect(resolveAnchor(compact, anchor)).toEqual({ offset: 0, liveness: 'deleted' })
    const next = insertIntoPieceTable(compact, 0, 'new\n')
    expect(resolveAnchor(next, anchor)).toEqual({ offset: 4, liveness: 'deleted' })
    expect(materializePieceTableFullText(next)).toBe('new\n')
    const empty = createPieceTableSnapshot('')
    const emptyAnchor = anchorAfter(empty, 0)
    expect(resolveAnchor(insertIntoPieceTable(empty, 0, 'x'), emptyAnchor)).toEqual({
      offset: 1,
      liveness: 'live',
    })
    expectValid(compact)
    expectValid(next)
  })

  test('walks and seeks across physical pages inside one logical piece, preserving UTF-16', () => {
    const prefix =
      'a'.repeat(BUFFER_CHUNK_SIZE - 1) + '😀' + '\ud800' + 'b'.repeat(20000) + '\udfff\n'
    const removed = 'gone\n'.repeat(1000)
    const original = createPieceTableSnapshot(prefix + removed + 'end\n')
    const current = deleteFromPieceTable(original, prefix.length, removed.length)
    const oldWalker = createPieceTableWalker(current)
    maintain([current])
    const expected = prefix + 'end\n'
    const walker = createPieceTableWalker(current)
    const units: number[] = []
    while (!walker.exhausted()) units.push(walker.next())
    expect(units).toEqual(
      Array.from({ length: expected.length }, (_, at) => expected.charCodeAt(at)),
    )
    walker.seek(BUFFER_CHUNK_SIZE - 1)
    expect(walker.codePoint()).toBe(0x1f600)
    walker.skip(2)
    expect(walker.charCode()).toBe(0xd800)
    walker.seek(30000)
    expect(walker.chunk()?.text).toBe(expected.slice(30000, BUFFER_CHUNK_SIZE * 2))
    const chunks: string[] = []
    walker.seek(0)
    while (!walker.exhausted()) {
      chunks.push(walker.chunk()!.text)
      walker.nextChunk()
    }
    expect(chunks.join('')).toBe(expected)
    expect(readPieceTableTextRange(current, 15000, 34000)).toBe(expected.slice(15000, 34000))
    const oldChunks: string[] = []
    while (!oldWalker.exhausted()) {
      oldChunks.push(oldWalker.chunk()!.text)
      oldWalker.nextChunk()
    }
    expect(oldChunks.join('')).toBe(expected)
    expectValid(current)
  })

  test('preserves newline ordinals across deleted holes, subsequent cuts and repeated reclamation', () => {
    const original = createPieceTableSnapshot('0\n1\n2\n3\n4\n5\n6\n')
    let compact = reclaimPieceTableText(deleteFromPieceTable(original, 4, 6))
    expectPositions(compact, '0\n1\n5\n6\n')
    compact = reclaimPieceTableText(deleteFromPieceTable(compact, 2, 2))
    expectPositions(compact, '0\n5\n6\n')
    const next = insertIntoPieceTable(compact, 4, 'insert\n')
    expectPositions(next, '0\n5\ninsert\n6\n')
    expectValid(next)
    for (const index of compact.buffers.lineIndexes.values()) expect('text' in index).toBe(false)
  })

  test('retains the union of partial append spans required by two historical snapshots', () => {
    const inserted = insertIntoPieceTable(
      createPieceTableSnapshot(''),
      0,
      'A'.repeat(BUFFER_CHUNK_SIZE),
    )
    const first = insertIntoPieceTable(
      deleteFromPieceTable(inserted, 16, BUFFER_CHUNK_SIZE - 16),
      16,
      '!',
    )
    const second = deleteFromPieceTable(first, 0, 8)
    const id = inserted.root!.piece.buffer
    const result = maintain([first, second])
    expect(result.codeUnits).toBe(BUFFER_CHUNK_SIZE - 16)
    expect(materializePieceTableFullText(first)).toBe('A'.repeat(16) + '!')
    expect(materializePieceTableFullText(second)).toBe('A'.repeat(8) + '!')
    expect(materializePieceTableFullText(inserted)).toBe('A'.repeat(BUFFER_CHUNK_SIZE))
    const spans: string[] = []
    forEachBufferSpan(first.buffers, id, 0, 16, (text, from, to) =>
      spans.push(text.slice(from, to)),
    )
    expect(spans.join('')).toBe('A'.repeat(16))
    expectValid(first)
    expectValid(second)
  })

  test('divergent append tails have different owners while maintenance keeps an unchanged tail', () => {
    const base = insertIntoPieceTable(
      createPieceTableSnapshot('head' + 'x'.repeat(30000)),
      0,
      'tail',
    )
    const id = (base.buffers.nextBufferSequence - 1) as typeof base.buffers.original
    const owner = bufferSpanAt(base.buffers, id, 0).owner
    const left = insertIntoPieceTable(base, 4, 'A')
    const right = insertIntoPieceTable(base, 4, 'B')
    const a = bufferSpanAt(left.buffers, id, 0)
    const b = bufferSpanAt(right.buffers, id, 0)
    expect(a.owner).toBe(owner)
    expect(a.owner).not.toBe(b.owner)
    expect(a.text).toBe('tailA')
    expect(b.text).toBe('tailB')
    const compact = reclaimPieceTableText(deleteFromPieceTable(left, 9, 30000))
    const reclaimedOwner = bufferSpanAt(compact.buffers, id, 0).owner
    expect(reclaimedOwner).toBe(a.owner)
    expectValid(compact)
  })

  test('retained storage diagnostics include sparse survivors and respect historical tail extents', () => {
    const original = createPieceTableSnapshot('a' + 'x'.repeat(30000) + 'z')
    const compact = reclaimPieceTableText(deleteFromPieceTable(original, 1, 30000))
    expect(bufferStoreExtent(compact.buffers)).toMatchObject({
      retainedChunkCount: 1,
      retainedCodeUnits: 2,
    })
    const first = insertIntoPieceTable(compact, 1, 'one')
    const second = insertIntoPieceTable(first, 2, 'two')
    expect(bufferStoreExtent(first.buffers)).toMatchObject({
      retainedChunkCount: 2,
      retainedCodeUnits: 5,
    })
    expect(bufferStoreExtent(second.buffers)).toMatchObject({
      retainedChunkCount: 2,
      retainedCodeUnits: 8,
    })
    const retired = reclaimPieceTableText(deleteFromPieceTable(compact, 0, 2))
    expect(bufferStoreExtent(retired.buffers)).toMatchObject({
      retainedChunkCount: 0,
      retainedCodeUnits: 0,
    })
  })

  test('large pastes preserve Unicode across a partial fill and a tiny retained writable tail', () => {
    const original = insertIntoPieceTable(createPieceTableSnapshot(''), 0, 'seed')
    const pastedText =
      'a'.repeat(BUFFER_CHUNK_SIZE - 5) +
      '😀' +
      'b'.repeat(BUFFER_CHUNK_SIZE * 2) +
      '\ud800x\udfff\nTAIL'
    const pasted = insertIntoPieceTable(original, 0, pastedText)
    expect(materializePieceTableFullText(pasted)).toBe(pastedText + 'seed')
    expectValid(pasted)
    const compact = reclaimPieceTableText(deleteFromPieceTable(pasted, 0, pastedText.length - 4))
    expect(materializePieceTableFullText(compact)).toBe('TAILseed')
    const next = insertIntoPieceTable(compact, 4, '!')
    expect(materializePieceTableFullText(next)).toBe('TAIL!seed')
    expectValid(compact)
    expectValid(next)
  })

  test('copies borrowed whole survivors once and keeps detached closed sources across later maintenance', () => {
    const pasted = insertIntoPieceTable(
      createPieceTableSnapshot(''),
      0,
      'a'.repeat(BUFFER_CHUNK_SIZE * 3 + 8),
    )
    const survivor = anchorAfter(pasted, BUFFER_CHUNK_SIZE + 1)
    const before = bufferSpanAt(pasted.buffers, survivor.buffer, survivor.offset)
    const first = reclaimPieceTableText(deleteFromPieceTable(pasted, 0, BUFFER_CHUNK_SIZE))
    const detached = bufferSpanAt(first.buffers, survivor.buffer, survivor.offset)
    expect(detached.owner).not.toBe(before.owner)
    const second = reclaimPieceTableText(
      deleteFromPieceTable(first, BUFFER_CHUNK_SIZE, BUFFER_CHUNK_SIZE),
    )
    expect(bufferSpanAt(second.buffers, survivor.buffer, survivor.offset).owner).toBe(
      detached.owner,
    )
    expect(materializePieceTableFullText(second)).toBe('a'.repeat(BUFFER_CHUNK_SIZE + 8))
    expectValid(second)
  })

  test.each([
    { mode: 'extend', borrowed: true },
    { mode: 'extend', borrowed: false },
    { mode: 'fill', borrowed: true },
    { mode: 'fill', borrowed: false },
  ])('whole-input $mode preserves borrowing=$borrowed across forks', ({ mode, borrowed }) => {
    const pasted = insertIntoPieceTable(
      createPieceTableSnapshot(''),
      0,
      'a'.repeat(BUFFER_CHUNK_SIZE * 3 + 8),
    )
    const tail = anchorAfter(pasted, pasted.length - 1)
    const base = borrowed
      ? pasted
      : reclaimPieceTableText(deleteFromPieceTable(pasted, 0, BUFFER_CHUNK_SIZE))
    const room = BUFFER_CHUNK_SIZE - 8
    const insertAt = mode === 'extend' ? base.length : 0
    const trunk = insertIntoPieceTable(base, insertAt, 'f'.repeat(room))
    const fork = insertIntoPieceTable(base, insertAt, 'g'.repeat(room))
    for (const branch of [trunk, fork]) {
      const closed = insertIntoPieceTable(branch, branch.length, '!')
      const before = bufferSpanAt(closed.buffers, tail.buffer, tail.offset).owner
      const text = materializePieceTableFullText(closed)
      const from = mode === 'extend' ? 0 : room
      const compact = reclaimPieceTableText(deleteFromPieceTable(closed, from, BUFFER_CHUNK_SIZE))
      const after = bufferSpanAt(compact.buffers, tail.buffer, tail.offset).owner
      if (borrowed) expect(after).not.toBe(before)
      else expect(after).toBe(before)
      expect(materializePieceTableFullText(compact)).toBe(
        text.slice(0, from) + text.slice(from + BUFFER_CHUNK_SIZE),
      )
      expectValid(compact)
    }
    expect(materializePieceTableFullText(base)).toBe(
      'a'.repeat(BUFFER_CHUNK_SIZE * (borrowed ? 3 : 2) + 8),
    )
  })

  test('keeps a whole dense source built from complete inputs when another chunk retires', () => {
    let pasted = createPieceTableSnapshot('')
    for (let index = 0; index < 3; index++)
      pasted = insertIntoPieceTable(pasted, pasted.length, 'a'.repeat(BUFFER_CHUNK_SIZE))
    pasted = insertIntoPieceTable(pasted, pasted.length, '!')
    const survivor = anchorAfter(pasted, BUFFER_CHUNK_SIZE + 1)
    const owner = bufferSpanAt(pasted.buffers, survivor.buffer, survivor.offset).owner
    const compact = reclaimPieceTableText(deleteFromPieceTable(pasted, 0, BUFFER_CHUNK_SIZE))
    expect(bufferSpanAt(compact.buffers, survivor.buffer, survivor.offset).owner).toBe(owner)
    expect(materializePieceTableFullText(compact)).toBe('a'.repeat(BUFFER_CHUNK_SIZE * 2) + '!')
    expectValid(compact)
  })

  test('a split insertion marks an existing filled chunk as borrowing and detaches its whole source', () => {
    const seed = insertIntoPieceTable(
      createPieceTableSnapshot(''),
      0,
      's'.repeat(BUFFER_CHUNK_SIZE - 8),
    )
    const anchor = anchorAfter(seed, 1)
    const pasted = insertIntoPieceTable(seed, 0, 'x'.repeat(BUFFER_CHUNK_SIZE + 16))
    const before = bufferSpanAt(pasted.buffers, anchor.buffer, anchor.offset).owner
    const compact = reclaimPieceTableText(deleteFromPieceTable(pasted, 8, BUFFER_CHUNK_SIZE))
    expect(bufferSpanAt(compact.buffers, anchor.buffer, anchor.offset).owner).not.toBe(before)
    expect(materializePieceTableFullText(compact)).toBe(
      'x'.repeat(16) + 's'.repeat(BUFFER_CHUNK_SIZE - 8),
    )
    expectValid(compact)
  })

  test('copies isolated surrogates and arbitrary UTF-16 units without replacement', () => {
    const text = '\ud800\udfff\ud800a\udfff\u0000\uffff'
    expect(copyTextRange(text, 1, text.length - 1)).toBe(text.slice(1, -1))
  })
})
