import { describe, expect, it } from 'vitest'
import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  insertIntoPieceTable,
  deleteFromPieceTable,
  materializePieceTableFullText,
  retainPieceTableSnapshot,
  anchorAt,
  resolveAnchor,
} from './pieceTable'
import {
  CharIdAllocator,
  applyCharIdEdit,
  charIdAt,
  charIdAfter,
  charIdSpansInRange,
  deleteByCharId,
  insertByCharId,
  locateCharId,
  setCharIdVisibility,
} from './charIds'
import type { CharId } from './identityRuns'
import { compactPieceTableTombstones } from './compaction'
import { reclaimPieceTableText, reclaimSnapshotStorage } from './reclamation'
import { validatePieceTreeInvariants } from './inspection'
import { BUFFER_CHUNK_SIZE } from './buffers'
import { retainCharIdPayloads } from './payloadRetention'
import { ReclaimedTextError } from './textSpans'

const id = (counter: number, bunch = 'seed:0'): CharId => ({ bunch, counter })
const make = (text = 'abcd', transient = false) =>
  createPieceTableSnapshot(text, { normalized: true, charIds: id(0), transient })
const text = materializePieceTableFullText
const ids = (snapshot: ReturnType<typeof make>) =>
  Array.from({ length: snapshot.length }, (_, offset) => charIdAt(snapshot, offset))
const valid = (snapshot: ReturnType<typeof make>) =>
  expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])

it('reserves consecutive IDs outside snapshot rollback state', () => {
  const allocator = new CharIdAllocator('actor')
  const first = allocator.generateAfter('start', 2)
  expect(first).toEqual({ bunch: 'actor:0', counter: 0 })
  expect(allocator.generateAfter({ ...first, counter: 1 }, 3)).toEqual({
    bunch: 'actor:0',
    counter: 2,
  })
  expect(allocator.generateAfter(first, 1)).toEqual({ bunch: 'actor:1', counter: 0 })
  expect(allocator.generateAfter(id(0), 1)).toEqual({ bunch: 'actor:2', counter: 0 })
  expect(() => allocator.generateAfter('start', 0)).toThrow(RangeError)
})

it('maps UTF-16 characters through both indexes and the existing reverse index', () => {
  const original = make('a😀\nb')
  expect(ids(original)).toEqual([id(0), id(1), id(2), id(3), id(4)])
  const changed = insertByCharId(original, {
    start: id(0, 'peer:0'),
    text: 'XY',
    at: { after: id(1) },
  })
  expect(text(changed)).toBe('a\ud83dXY\ude00\nb')
  const location = locateCharId(changed, id(2))!
  expect(location.unit).toBe(2)
  expect(location.offset).toBe(4)
  expect(location.liveness).toBe('live')
  expect(charIdAt(changed, 2)).toEqual(id(0, 'peer:0'))
  expect(charIdAt(changed, changed.length)).toBeNull()
  expect(locateCharId(original, id(0, 'peer:0'))).toBeNull()
  valid(changed)
})

it('rejects surrogate-splitting selections at authoring but applies remote IDs exactly', () => {
  const original = make('a😀b')
  expect(() => charIdSpansInRange(original, 1, 2)).toThrow(RangeError)
  expect(() => charIdSpansInRange(original, 2, 2)).toThrow(RangeError)
  expect(charIdSpansInRange(original, 1, 3)).toEqual([{ start: id(1), count: 2 }])
  const changed = deleteByCharId(original, [{ start: id(1), count: 1 }])
  expect(text(changed)).toBe('a\ude00b')
  expect(locateCharId(changed, id(2))!.liveness).toBe('live')
  valid(changed)
})

it('replays the same authored insertion on a restored snapshot without allocating IDs', () => {
  const allocator = new CharIdAllocator('actor')
  const original = make()
  const authored = {
    start: allocator.generateAfter(id(0), 2),
    text: 'XY',
    at: { after: id(0) } as const,
  }
  const first = insertByCharId(original, authored)
  allocator.generateAfter({ ...authored.start, counter: 1 }, 1)
  const replay = insertByCharId(original, authored)
  expect(text(first)).toBe(text(replay))
  expect(ids(first)).toEqual(ids(replay))
  expect(locateCharId(first, authored.start)).toEqual(locateCharId(replay, authored.start))
  expect(text(original)).toBe('abcd')
  valid(first)
  valid(replay)
})

it('keeps divergent numeric buffer reuse local to each snapshot', () => {
  const original = make()
  const left = insertByCharId(original, {
    start: id(0, 'left:0'),
    text: 'L',
    at: { after: id(0) },
  })
  const right = insertByCharId(original, {
    start: id(0, 'right:0'),
    text: 'R',
    at: { after: id(0) },
  })
  expect(locateCharId(left, id(0, 'left:0'))!.piece.buffer).toBe(
    locateCharId(right, id(0, 'right:0'))!.piece.buffer,
  )
  expect(locateCharId(left, id(0, 'right:0'))).toBeNull()
  expect(locateCharId(right, id(0, 'left:0'))).toBeNull()
})

it('inserts at distinct interior and adjacent hidden boundaries', () => {
  const hidden = deleteByCharId(make(), [{ start: id(1), count: 2 }])
  const changed = insertByCharId(hidden, {
    start: id(0, 'peer:0'),
    text: 'X',
    at: { after: id(1) },
  })
  const next = insertByCharId(changed, {
    start: id(0, 'peer:1'),
    text: 'Y',
    at: { before: id(2) },
  })
  expect(text(next)).toBe('aXYd')
  expect(locateCharId(next, id(1))!.offset).toBe(1)
  expect(locateCharId(next, id(2))!.offset).toBe(3)
  expect(locateCharId(hidden, id(2))!.offset).toBe(1)
  valid(hidden)
  valid(next)
})

it('distinguishes start and end when the entire document is hidden', () => {
  const hidden = deleteByCharId(make(), [{ start: id(0), count: 4 }])
  const first = insertByCharId(hidden, {
    start: id(0, 'peer:0'),
    text: 'L',
    at: { after: 'start' },
  })
  const last = insertByCharId(first, {
    start: id(0, 'peer:1'),
    text: 'R',
    at: { before: 'end' },
  })
  expect(text(last)).toBe('LR')
  expect(locateCharId(last, id(0))!.offset).toBe(1)
  expect(locateCharId(last, id(3))!.offset).toBe(1)
  valid(last)
})

it('deletes all targeted fragments while preserving inserted text between them', () => {
  let snapshot = make('abcdef')
  snapshot = insertByCharId(snapshot, {
    start: id(0, 'peer:0'),
    text: 'X',
    at: { after: id(1) },
  })
  snapshot = insertByCharId(snapshot, {
    start: id(0, 'peer:1'),
    text: 'Y',
    at: { before: id(4) },
  })
  const deleted = deleteByCharId(snapshot, [{ start: id(1), count: 4 }])
  expect(text(deleted)).toBe('aXYf')
  expect(text(snapshot)).toBe('abXcdYef')
  expect(deleteByCharId(deleted, [{ start: id(1), count: 4 }])).toBe(deleted)
  expect(charIdSpansInRange(snapshot, 1, 7)).toEqual([
    { start: id(1), count: 1 },
    { start: id(0, 'peer:0'), count: 1 },
    { start: id(2), count: 2 },
    { start: id(0, 'peer:1'), count: 1 },
    { start: id(4), count: 1 },
  ])
  valid(deleted)
})

it('coalesces only consecutive counters within one bunch', () => {
  let snapshot = make('')
  snapshot = insertByCharId(snapshot, {
    start: id(0, 'actor:0'),
    text: 'A',
    at: { after: 'start' },
  })
  const joined = insertByCharId(snapshot, {
    start: id(1, 'actor:0'),
    text: 'B',
    at: { after: id(0, 'actor:0') },
  })
  expect(joined.pieceCount).toBe(1)
  const separate = insertByCharId(joined, {
    start: id(0, 'actor:1'),
    text: 'C',
    at: { before: 'end' },
  })
  const gap = insertByCharId(separate, {
    start: id(3, 'actor:1'),
    text: 'D',
    at: { before: 'end' },
  })
  expect(gap.pieceCount).toBe(3)
  expect(ids(gap)).toEqual([id(0, 'actor:0'), id(1, 'actor:0'), id(0, 'actor:1'), id(3, 'actor:1')])
  expect(text(snapshot)).toBe('A')
  valid(gap)
})

it('preserves identity runs across chunk boundaries', () => {
  const payload = 'x'.repeat(BUFFER_CHUNK_SIZE + 12)
  const snapshot = insertByCharId(make(''), {
    start: id(10, 'actor:0'),
    text: payload,
    at: { after: 'start' },
  })
  expect(charIdAt(snapshot, BUFFER_CHUNK_SIZE + 2)).toEqual(id(BUFFER_CHUNK_SIZE + 12, 'actor:0'))
  expect(charIdSpansInRange(snapshot, 0, snapshot.length)).toEqual([
    { start: id(10, 'actor:0'), count: payload.length },
  ])
  const changed = deleteByCharId(snapshot, [
    { start: id(BUFFER_CHUNK_SIZE + 8, 'actor:0'), count: 8 },
  ])
  expect(changed.length).toBe(payload.length - 8)
  valid(changed)
})

it('keeps exact tombstones after compaction and text reclamation', () => {
  let snapshot = make('a\nb\nc\nd')
  snapshot = insertByCharId(snapshot, {
    start: id(0, 'peer:0'),
    text: 'X\nY\nZ',
    at: { after: id(2) },
  })
  snapshot = deleteByCharId(snapshot, [
    { start: id(1), count: 5 },
    { start: id(0, 'peer:0'), count: 5 },
  ])
  const pieces = snapshot.pieceCount
  expect(compactPieceTableTombstones(snapshot)).toEqual({ runs: 0, tombstones: 0, unverified: 0 })
  expect(snapshot.pieceCount).toBe(pieces)
  const reclaimed = reclaimPieceTableText(snapshot)
  expect(reclaimed.buffers.chunks.get(reclaimed.buffers.original)).toBeUndefined()
  const changed = insertByCharId(reclaimed, {
    start: id(0, 'new:0'),
    text: 'Q',
    at: { after: id(3) },
  })
  expect(text(changed)).toBe('aQd')
  expect(locateCharId(changed, id(3))!.liveness).toBe('deleted')
  valid(changed)
})

it('can split a wholly reclaimed non-tail chunk containing line breaks', () => {
  let snapshot = make('')
  snapshot = insertByCharId(snapshot, {
    start: id(0, 'peer:0'),
    text: 'a\n'.repeat(BUFFER_CHUNK_SIZE / 2),
    at: { after: 'start' },
  })
  snapshot = insertByCharId(snapshot, {
    start: id(0, 'peer:1'),
    text: 'tail',
    at: { before: 'end' },
  })
  snapshot = deleteByCharId(snapshot, [{ start: id(0, 'peer:0'), count: BUFFER_CHUNK_SIZE }])
  const reclaimed = reclaimPieceTableText(snapshot)
  const changed = insertByCharId(reclaimed, {
    start: id(0, 'new:0'),
    text: 'X\n',
    at: { after: id(25, 'peer:0') },
  })
  expect(text(changed)).toBe('X\ntail')
  valid(changed)
})

it('reclaims storage with both confirmed and pending snapshots retained', () => {
  const confirmed = make('a\nb\nc\nd')
  const anchor = anchorAt(confirmed, 4, 'right')
  const pending = deleteByCharId(confirmed, [{ start: id(1), count: 5 }])
  const sweep = reclaimSnapshotStorage([confirmed, pending])
  while (!sweep.next().done) {
    /* Complete the incremental sweep. */
  }
  expect(text(confirmed)).toBe('a\nb\nc\nd')
  expect(text(pending)).toBe('ad')
  expect(resolveAnchor(confirmed, anchor)).toEqual({ offset: 4, liveness: 'live' })
  const replay = insertByCharId(pending, {
    start: id(0, 'new:0'),
    text: 'Q',
    at: { before: id(4) },
  })
  expect(text(replay)).toBe('aQd')
  valid(confirmed)
  valid(replay)
})

it('applies replacements atomically after validating every ID', () => {
  const original = make('abcdef', true)
  expect(() =>
    applyCharIdEdit(original, {
      delete: [
        { start: id(0), count: 1 },
        { start: id(20), count: 1 },
      ],
      insert: { start: id(0, 'peer:0'), text: 'Q', at: { after: id(0) } },
    }),
  ).toThrow(RangeError)
  expect(original.consumed).toBe(false)
  expect(text(original)).toBe('abcdef')
  const changed = applyCharIdEdit(original, {
    delete: [{ start: id(1), count: 3 }],
    insert: { start: id(0, 'peer:0'), text: 'Q', at: { after: id(2) } },
  })
  expect(text(changed)).toBe('aQef')
  expect(original.consumed).toBe(true)
  valid(changed)
})

it('rejects duplicate IDs and unmapped offset insertions', () => {
  const original = make()
  expect(() =>
    insertByCharId(original, {
      start: id(2),
      text: 'Q',
      at: { after: id(0) },
    }),
  ).toThrow(RangeError)
  expect(() =>
    insertByCharId(original, {
      start: id(0, 'peer:0'),
      text: 'Q',
      at: { after: id(20) },
    }),
  ).toThrow(RangeError)
  expect(() => insertIntoPieceTable(original, 0, 'Q')).toThrow(RangeError)
  expect(() => applyBatchToPieceTable(original, [{ from: 0, to: 1, text: 'Q' }])).toThrow(
    RangeError,
  )
  expect(text(original)).toBe('abcd')
})

it('keeps ordinary snapshots identity-free and ordinary edits working', () => {
  const original = createPieceTableSnapshot('abc')
  expect(original.charIds).toBeNull()
  expect(text(insertIntoPieceTable(original, 1, 'Q'))).toBe('aQbc')
  expect(() => charIdAt(original, 0)).toThrow(RangeError)
})

describe('independent replica replay', () => {
  it('produces matching text, local anchors and IDs after hidden-origin edits', () => {
    const apply = () => {
      let snapshot = make('abcdef')
      const anchor = anchorAt(snapshot, 3, 'left')
      snapshot = deleteByCharId(snapshot, [{ start: id(1), count: 4 }])
      compactPieceTableTombstones(snapshot)
      snapshot = insertByCharId(snapshot, { start: id(0, 'p:0'), text: 'X', at: { after: id(2) } })
      snapshot = insertByCharId(snapshot, { start: id(0, 'p:1'), text: 'Y', at: { before: id(4) } })
      snapshot = deleteByCharId(snapshot, [{ start: id(0, 'p:0'), count: 1 }])
      valid(snapshot)
      return { snapshot, anchor }
    }
    const left = apply()
    const right = apply()
    expect(text(left.snapshot)).toBe('aYf')
    expect(ids(left.snapshot)).toEqual(ids(right.snapshot))
    expect(resolveAnchor(left.snapshot, left.anchor)).toEqual(
      resolveAnchor(right.snapshot, right.anchor),
    )
    for (let counter = 0; counter < 6; counter++) {
      expect(locateCharId(left.snapshot, id(counter))).toEqual(
        locateCharId(right.snapshot, id(counter)),
      )
    }
  })

  it('survives order normalization after repeated inserts inside a hidden range', () => {
    let snapshot = deleteByCharId(make('abc'), [{ start: id(0), count: 3 }])
    const retained = retainPieceTableSnapshot(snapshot)
    for (let counter = 0; counter < 160; counter++) {
      snapshot = insertByCharId(snapshot, {
        start: id(counter, 'p:0'),
        text: 'X',
        at: { after: id(0) },
      })
      valid(snapshot)
    }
    expect(snapshot.length).toBe(160)
    expect(charIdAt(snapshot, 0)).toEqual(id(159, 'p:0'))
    expect(text(retained)).toBe('')
    snapshot = deleteByCharId(snapshot, [{ start: id(0, 'p:0'), count: 160 }])
    expect(text(snapshot)).toBe('')
    valid(snapshot)
  })
})

it('preserves identity across ordinary offset deletions', () => {
  const original = make('abc')
  const deleted = deleteFromPieceTable(original, 1, 1)
  expect(ids(deleted)).toEqual([id(0), id(2)])
  expect(locateCharId(deleted, id(1))!.liveness).toBe('deleted')
  valid(deleted)
})

it('merges overlapping and separated ranges targeting one piece', () => {
  const snapshot = make('abcdefghij')
  const deleted = deleteByCharId(snapshot, [
    { start: id(1), count: 2 },
    { start: id(2), count: 2 },
    { start: id(6), count: 2 },
    { start: id(9), count: 1 },
  ])
  expect(text(deleted)).toBe('aefi')
  valid(deleted)
})

it('rejects overlap in the middle of a proposed run and gaps in deletion spans', () => {
  const original = insertByCharId(make(''), {
    start: id(5, 'p:0'),
    text: 'abc',
    at: { after: 'start' },
  })
  expect(() =>
    insertByCharId(original, {
      start: id(0, 'p:0'),
      text: '123456',
      at: { before: 'end' },
    }),
  ).toThrow(RangeError)
  expect(() => deleteByCharId(original, [{ start: id(5, 'p:0'), count: 4 }])).toThrow(RangeError)
  expect(text(original)).toBe('abc')
})

const structuralStress = process.env.COLLAB_STRESS === '1'
it.each(structuralStress ? [1, 2, 3, 4, 5, 6] : [1, 2])(
  'matches an independent structural model through seeded fragmented edits (seed %i)',
  (seed) => {
    type Unit = { id: CharId; text: string; visible: boolean }
    let randomState = seed
    const random = (limit: number) => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
      return randomState % limit
    }
    const allocator = new CharIdAllocator(`author${seed}`)
    let snapshot = make('abcd')
    let model: Unit[] = Array.from('abcd', (text, counter) => ({
      id: id(counter),
      text,
      visible: true,
    }))
    const authored: { start: CharId; count: number }[] = [{ start: id(0), count: 4 }]
    for (let step = 0; step < (structuralStress ? 300 : 40); step++) {
      if (random(3) !== 0) {
        const boundary = random(model.length + 1)
        const after = boundary === 0 ? 'start' : model[boundary - 1]!.id
        const payload = random(4) === 0 ? 'x\ny' : 'XY'.slice(0, random(2) + 1)
        const start = allocator.generateAfter(after, payload.length)
        const insertion = { start, text: payload, at: { after } } as const
        snapshot = insertByCharId(snapshot, insertion)
        const units = Array.from(payload, (text, index) => ({
          id: { ...start, counter: start.counter + index },
          text,
          visible: true,
        }))
        model.splice(boundary, 0, ...units)
        authored.push({ start, count: payload.length })
      } else {
        const range = authored[random(authored.length)]!
        const delta = random(range.count)
        const start = { ...range.start, counter: range.start.counter + delta }
        const count = random(range.count - delta) + 1
        snapshot = deleteByCharId(snapshot, [{ start, count }])
        model = model.map((unit) =>
          unit.id.bunch === start.bunch &&
          unit.id.counter >= start.counter &&
          unit.id.counter < start.counter + count
            ? { ...unit, visible: false }
            : unit,
        )
      }
      expect(text(snapshot)).toBe(
        model
          .filter((unit) => unit.visible)
          .map((unit) => unit.text)
          .join(''),
      )
      expect(ids(snapshot)).toEqual(model.filter((unit) => unit.visible).map((unit) => unit.id))
      let offset = 0
      let previous: ReturnType<typeof locateCharId> = null
      for (const unit of model) {
        const location = locateCharId(snapshot, unit.id)!
        expect(location.offset).toBe(offset)
        expect(location.liveness).toBe(unit.visible ? 'live' : 'deleted')
        if (previous)
          expect(
            location.piece.order > previous.piece.order ||
              (location.piece.order === previous.piece.order && location.unit > previous.unit),
          ).toBe(true)
        if (unit.visible) offset++
        previous = location
      }
      valid(snapshot)
    }
  },
)

it('normalizes exhausted split orders within one atomic replacement', () => {
  const original = make('ab'.repeat(100))
  const changed = applyCharIdEdit(original, {
    delete: Array.from({ length: 100 }, (_, counter) => ({ start: id(counter * 2), count: 1 })),
    insert: { start: id(0, 'p:0'), text: 'X', at: { after: id(98) } },
  })
  expect(text(changed)).toBe('b'.repeat(49) + 'X' + 'b'.repeat(51))
  expect(text(original)).toBe('ab'.repeat(100))
  expect(locateCharId(changed, id(98))!.liveness).toBe('deleted')
  valid(changed)
})

it.each([false, true])(
  'visibility edits revive retained payloads and IDs with transient=%s',
  (transient) => {
    const original = make('a😀\nbcdef', transient)
    retainPieceTableSnapshot(original)
    const hidden = deleteByCharId(original, [{ start: id(1), count: 7 }])
    retainPieceTableSnapshot(hidden)
    const revived = setCharIdVisibility(hidden, [
      { start: id(2), count: 2, visible: true },
      { start: id(5), count: 2, visible: true },
      { start: id(0), count: 1, visible: false },
    ])
    expect(text(revived)).toBe('\ude00\ncd' + 'f')
    expect(ids(revived)).toEqual([id(2), id(3), id(5), id(6), id(8)])
    expect(text(original)).toBe('a😀\nbcdef')
    expect(text(hidden)).toBe('af')
    expect(revived.buffers).toBe(original.buffers)
    valid(original)
    valid(hidden)
    valid(revived)
  },
)

it('visibility batches validate all spans before touching transient storage', () => {
  const original = make('abcdef', true)
  const invalid = [
    { start: id(0), count: 1, visible: false },
    { start: id(99), count: 1, visible: true },
  ]
  expect(() => setCharIdVisibility(original, invalid)).toThrow('unknown')
  expect(text(original)).toBe('abcdef')
  valid(original)
  expect(() =>
    setCharIdVisibility(original, [
      { start: id(1), count: 3, visible: false },
      { start: id(2), count: 1, visible: true },
    ]),
  ).toThrow('overlapping')
  expect(setCharIdVisibility(original, [{ start: id(0), count: 6, visible: true }])).toBe(original)
})

it.each([false, true])(
  'seeded visibility flips preserve structure, payload and identities with transient=%s',
  (transient) => {
    const source = 'ab\nc😀def\nghij'.repeat(4)
    let snapshot = make(source, transient)
    const original = snapshot
    retainPieceTableSnapshot(original)
    const live = Array.from({ length: source.length }, () => true)
    let random = 12345
    for (let step = 0; step < 150; step++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      const from = random % source.length
      const count = 1 + ((random >>> 8) % (source.length - from))
      const visible = (random & 0x8000) !== 0
      snapshot = setCharIdVisibility(snapshot, [{ start: id(from), count, visible }])
      live.fill(visible, from, from + count)
      expect(text(snapshot)).toBe(
        source
          .split('')
          .filter((_, index) => live[index])
          .join(''),
      )
      expect(ids(snapshot)).toEqual(live.flatMap((visible, index) => (visible ? [id(index)] : [])))
      valid(snapshot)
    }
    expect(text(original)).toBe(source)
    expect(snapshot.buffers).toBe(original.buffers)
  },
)

function collectPayloads(snapshots: readonly ReturnType<typeof make>[]) {
  const job = reclaimSnapshotStorage(snapshots)
  let step = job.next()
  while (!step.done) step = job.next()
  return step.value
}

it.each([false, true])(
  'expired revival rejects wholly reclaimed payloads atomically with transient=%s',
  (transient) => {
    const original = make('abcdef', transient)
    retainPieceTableSnapshot(original)
    const hidden = deleteByCharId(original, [{ start: id(0), count: 6 }])
    expect(collectPayloads([original, hidden]).codeUnits).toBe(0)
    expect(text(setCharIdVisibility(hidden, [{ start: id(0), count: 6, visible: true }]))).toBe(
      'abcdef',
    )
    expect(collectPayloads([hidden]).codeUnits).toBe(6)
    const epoch = hidden.buffers.lineage.epoch
    expect(() => setCharIdVisibility(hidden, [{ start: id(0), count: 6, visible: true }])).toThrow(
      'expired',
    )
    expect(hidden.buffers.lineage.epoch).toBe(epoch)
    expect(text(hidden)).toBe('')
    expect(locateCharId(hidden, id(3))!.liveness).toBe('deleted')
  },
)

it.each([false, true])(
  'expired revival checks sparse holes and rejects a complete batch with transient=%s',
  (transient) => {
    const original = make('abcdef', transient)
    retainPieceTableSnapshot(original)
    const hidden = deleteByCharId(original, [{ start: id(1), count: 3 }])
    expect(collectPayloads([hidden]).codeUnits).toBe(3)
    const epoch = hidden.buffers.lineage.epoch
    expect(() => setCharIdVisibility(hidden, [{ start: id(0), count: 6, visible: true }])).toThrow(
      'expired',
    )
    expect(() =>
      setCharIdVisibility(hidden, [
        { start: id(0), count: 1, visible: false },
        { start: id(1), count: 3, visible: true },
      ]),
    ).toThrow('expired')
    expect(text(hidden)).toBe('aef')
    expect(hidden.buffers.lineage.epoch).toBe(epoch)
    expect(locateCharId(hidden, id(0))!.liveness).toBe('live')
    expect(locateCharId(hidden, id(2))!.liveness).toBe('deleted')
  },
)

it.each([false, true])(
  'payload roots retain only reachable hidden spans with transient=%s',
  (transient) => {
    const hidden = deleteByCharId(make('abcdef', transient), [{ start: id(1), count: 3 }])
    retainCharIdPayloads(hidden, [{ start: id(1), count: 1 }])
    const fork = reclaimPieceTableText(hidden)
    expect(fork).not.toBe(hidden)
    expect(text(setCharIdVisibility(fork, [{ start: id(1), count: 1, visible: true }]))).toBe(
      'abef',
    )
    expect(() => setCharIdVisibility(fork, [{ start: id(2), count: 2, visible: true }])).toThrow(
      ReclaimedTextError,
    )
    expect(text(hidden)).toBe('aef')
  },
)

it('structural successor includes hidden identities across split pieces and retained snapshots', () => {
  const before = make('abcd')
  const inserted = insertByCharId(before, {
    start: id(0, 'peer'),
    text: 'XY',
    at: { after: id(0) },
  })
  const hidden = deleteByCharId(inserted, [
    { start: id(0, 'peer'), count: 2 },
    { start: id(1), count: 1 },
  ])
  const expected = [id(0), id(0, 'peer'), id(1, 'peer'), id(1), id(2), id(3)]
  let left: CharId | 'start' = 'start'
  for (const next of expected) {
    expect(charIdAfter(hidden, left)).toEqual(next)
    left = next
  }
  expect(charIdAfter(hidden, left)).toBeNull()
  expect(charIdAfter(before, id(0))).toEqual(id(1))
  expect(charIdAfter(make(''), 'start')).toBeNull()
  expect(() => charIdAfter(before, id(0, 'unknown'))).toThrow(RangeError)
})
