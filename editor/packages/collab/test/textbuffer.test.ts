import { expect, test } from 'vitest'
import {
  CharIdAllocator,
  createPieceTableSnapshot,
  locateCharId,
  materializePieceTableFullText,
} from '@singapore-editor/textbuffer'
import { Participant, ReferenceEngine, TextbufferEngine, simulate } from '../src/index'
import type {
  AuthorContext,
  CharId,
  Envelope,
  OffsetEdit,
  ReferenceSnapshot,
  TextbufferSnapshot,
} from '../src/index'
import { characters, liveIds } from './engine-fixture'

function envelope(change: Envelope['change']): Envelope {
  const insert = change.kind === 'insert' ? change : null
  const id = insert
    ? { actor: insert.start.bunch, seq: insert.start.counter + 1 }
    : { actor: 'a', seq: 1 }
  return { document: 'test', epoch: '1', id, lamport: 1, deps: [], change }
}
function compare(reference: ReferenceEngine, buffer: TextbufferEngine): void {
  expect(buffer.text()).toBe(reference.text())
  expect(liveIds(buffer)).toEqual(liveIds(reference))
  const expected = characters(reference)
    .slice()
    .sort((a, b) => a.id.bunch.localeCompare(b.id.bunch) || a.id.counter - b.id.counter)
  expect(characters(buffer)).toEqual(expected)
  for (const { id } of expected) expect(buffer.visibleOffset(id)).toBe(reference.visibleOffset(id))
}

test.each([false, true])(
  'retained snapshots restore by reference with transient=%s',
  (transient) => {
    const original = createPieceTableSnapshot('abc', {
      normalized: true,
      transient,
      charIds: { bunch: 'initial', counter: 0 },
    })
    const engine = new TextbufferEngine(original)
    expect(engine.snapshot().buffer).toBe(original)
    const before = engine.snapshot()
    engine.apply(
      envelope({
        kind: 'insert',
        start: { bunch: 'a:1', counter: 0 },
        originLeft: { bunch: 'initial', counter: 0 },
        originRight: { bunch: 'initial', counter: 1 },
        text: 'X',
      }),
    )
    const after = engine.snapshot()
    engine.restore(before)
    expect(engine.snapshot()).toBe(before)
    expect(engine.text()).toBe('abc')
    engine.restore(after)
    expect(engine.snapshot()).toBe(after)
    expect(engine.text()).toBe('aXbc')
    expect(materializePieceTableFullText(before.buffer)).toBe('abc')
  },
)

test('sequential typing coalesces placement metadata and uses the textbuffer allocator', () => {
  const engine = new TextbufferEngine()
  const ids = new CharIdAllocator('author')
  for (let seq = 1; seq <= 1000; seq++) {
    const edit = engine.author(
      { offset: seq - 1, deleteCount: 0, text: 'x' },
      {
        document: 'test',
        epoch: '1',
        id: { actor: 'author', seq },
        lamport: seq,
        deps: [],
        allocate: (left, count) => ids.generateAfter(left, count),
      },
    )
    engine.apply(edit)
  }
  const root = engine.snapshot().runs!
  expect(root.value.count).toBe(1000)
  expect(root.left).toBeNull()
  expect(root.right).toBeNull()
  expect(engine.snapshot().forks).toBeNull()
})

test('extending a branched character preserves its left children across later splits', () => {
  const reference = new ReferenceEngine()
  const buffer = new TextbufferEngine()
  const id = (bunch: string, counter = 0): CharId => ({ bunch, counter })
  const inserts = [
    { start: id('base'), originLeft: 'start' as const, originRight: 'end' as const, text: 'c' },
    { start: id('before'), originLeft: 'start' as const, originRight: id('base'), text: 'a' },
    { start: id('base', 1), originLeft: id('base'), originRight: 'end' as const, text: 'XY' },
    { start: id('inside'), originLeft: id('base'), originRight: id('base', 1), text: 'B' },
  ]
  for (const insert of inserts) {
    const edit = envelope({ kind: 'insert', ...insert })
    reference.apply(edit)
    buffer.apply(edit)
    compare(reference, buffer)
  }
  expect(buffer.text()).toBe('acBXY')
  for (let offset = 0; offset <= 5; offset++)
    expect(buffer.origins(offset)).toEqual(reference.origins(offset))
})

test('large bootstrap and interior edits use compact runs without document traversal', () => {
  const original = createPieceTableSnapshot('line\n'.repeat(100_000), {
    normalized: true,
    charIds: { bunch: 'initial', counter: 0 },
  })
  const engine = new TextbufferEngine(original)
  const before = engine.snapshot()
  expect(before.runs!.value.count).toBe(500_000)
  expect(before.runs!.left).toBeNull()
  expect(before.runs!.right).toBeNull()
  const participant = new Participant({ actor: 'a', document: 'test', epoch: '1', engine })
  participant.local({ offset: 250_000, deleteCount: 0, text: 'hello' })
  expect(engine.snapshot().runs!.height).toBeLessThanOrEqual(3)
  expect(
    locateCharId(engine.snapshot().buffer, { bunch: 'initial', counter: 250_000 })!.offset,
  ).toBe(250_005)
  engine.restore(before)
  expect(engine.origins(500_000)).toEqual({
    originLeft: { bunch: 'initial', counter: 499_999 },
    originRight: 'end',
  })
})

test.each([false, true])(
  'seeded arrivals and pending replay match after every operation with undo=%s',
  (undoRedo) => {
    for (let seed = 0; seed < 25; seed++) {
      const result = simulate({
        seed,
        participants: 3 + (seed % 3),
        edits: 48,
        undoRedo,
        createEngine: () => new DifferentialEngine(),
      })
      expect(result.hostSequence).toBe(48)
    }
  },
  120_000,
)

class DifferentialEngine {
  private readonly reference = new ReferenceEngine()
  private readonly buffer = new TextbufferEngine()
  text() {
    return this.buffer.text()
  }
  characters() {
    return this.buffer.characters()
  }
  visibleOffset(id: CharId) {
    return this.buffer.visibleOffset(id)
  }
  origins(offset: number) {
    return this.buffer.origins(offset)
  }
  author(edit: OffsetEdit, context: AuthorContext) {
    let reserved: CharId | null = null
    const envelope = this.buffer.author(edit, {
      ...context,
      allocate: (left, count) => {
        reserved = context.allocate(left, count)
        return reserved
      },
    })
    const expected = this.reference.author(edit, { ...context, allocate: () => reserved! })
    expect(envelope).toEqual(expected)
    return envelope
  }
  apply(edit: Envelope) {
    this.reference.apply(edit)
    this.buffer.apply(edit)
    compare(this.reference, this.buffer)
  }
  snapshot(): TextbufferSnapshot & { reference: ReferenceSnapshot } {
    return { ...this.buffer.snapshot(), reference: this.reference.snapshot() }
  }
  restore(snapshot: TextbufferSnapshot & { reference: ReferenceSnapshot }) {
    this.reference.restore(snapshot.reference)
    this.buffer.restore(snapshot)
    compare(this.reference, this.buffer)
  }
}
