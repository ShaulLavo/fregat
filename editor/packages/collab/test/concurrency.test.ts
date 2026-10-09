import { expect, test } from 'vitest'
import { ConfirmedWindow, Host, Participant, ReferenceEngine } from '../src/index'
import type { Envelope, IdSpan } from '../src/index'
import { charKey, editKey } from '../src/types'
import { createEngine } from './engine-fixture'
import { confirmedHistory, oraclePairs, pairKey, randomFor, shuffled } from './concurrency-fixtures'

const keys = (window: ConfirmedWindow) =>
  window
    .pairs()
    .map(([a, b]) => pairKey(a.envelope, b.envelope))
    .sort()
const expand = (spans: readonly IdSpan[]) =>
  spans.flatMap(({ start, count }) =>
    Array.from({ length: count }, (_, i) =>
      charKey({ bunch: start.bunch, counter: start.counter + i }),
    ),
  )

test('seeded confirmed histories match transitive dependency walks and both engines', () => {
  for (let seed = 0; seed < 50; seed++) {
    const history = confirmedHistory(seed)
    const window = new ConfirmedWindow(history)
    expect(keys(window)).toEqual(oraclePairs(history))
    const host = new Host({ document: 'review', epoch: '1', engine: createEngine() })
    const confirmed: Envelope[] = []
    host.subscribe((message) => {
      expect(message.status).toBe('accepted')
      if (message.status === 'accepted') confirmed.push(message.envelope)
    })
    for (const edit of shuffled(history, randomFor(seed + 100))) host.submit(edit, edit.id.actor)
    expect(confirmed).toHaveLength(history.length)
    expect(new ConfirmedWindow(confirmed).pairs()).toEqual(window.pairs())
    const reference = new ReferenceEngine()
    for (const edit of history) reference.apply(edit)
    expect(host.text()).toBe(reference.text())
    const identities = new Set(reference.characters().map(({ id }) => charKey(id)))
    for (const edit of window.edits) {
      expect(
        [...expand(edit.inserted), ...expand(edit.deleted)].every((id) => identities.has(id)),
      ).toBe(true)
    }
    for (const limit of [0, 1, 7, 16]) {
      const bounded = new ConfirmedWindow(history, limit)
      const retained = new Set(bounded.edits.map((edit) => editKey(edit.envelope.id)))
      expect(bounded.edits.length).toBeLessThanOrEqual(limit)
      expect(keys(bounded)).toEqual(
        oraclePairs(history).filter((key) => {
          const [left, right] = key.split('|')
          return retained.has(left!) && retained.has(right!)
        }),
      )
    }
  }
})

test('incremental batches, retries and eviction match fresh canonical windows', () => {
  for (let seed = 0; seed < 30; seed++) {
    const history = confirmedHistory(seed)
    for (const limit of [1, 7, 16, 32]) {
      const window = new ConfirmedWindow([], limit)
      for (let end = 4; end <= history.length; end += 4) {
        const batch = history.slice(end - 4, end)
        window.append(batch)
        window.append(batch)
        const fresh = new ConfirmedWindow(history.slice(0, end), limit)
        expect(window.edits).toEqual(fresh.edits)
        expect(window.pairs()).toEqual(fresh.pairs())
        expect(window.pairs(batch.map((edit) => edit.id))).toEqual(
          fresh.pairs(batch.map((edit) => edit.id)),
        )
      }
    }
  }
})

test('a bridge dependency and an effect command preserve transitive causality', () => {
  const peers = ['a', 'b', 'c'].map(
    (actor) => new Participant({ actor, document: 'review', epoch: '1', engine: createEngine() }),
  )
  const host = new Host({ document: 'review', epoch: '1', engine: createEngine() })
  const messages: Parameters<Participant['receive']>[0][number][] = []
  host.subscribe((message) => messages.push(message))
  const a = peers[0]!.local({ offset: 0, deleteCount: 0, text: 'a' })
  host.submit(a, 'a')
  peers[0]!.receive(messages)
  const undo = peers[0]!.setEffects([{ op: a.id, active: false }])
  host.submit(undo, 'a')
  peers[1]!.receive(messages)
  const b = peers[1]!.local({ offset: 0, deleteCount: 0, text: 'b' })
  host.submit(b, 'b')
  peers[2]!.receive(messages)
  const c = peers[2]!.local({ offset: 0, deleteCount: 0, text: 'c' })
  expect(new ConfirmedWindow([c, b, undo, a]).pairs()).toEqual([])
})

test('concurrency is represented by exact pairs, not transitive connected groups', () => {
  const history = confirmedHistory(42)
  for (const [left, right] of new ConfirmedWindow(history).pairs()) {
    expect(left.envelope.id.actor).not.toBe(right.envelope.id.actor)
    expect(oraclePairs(history)).toContain(pairKey(left.envelope, right.envelope))
  }
  const batch = history.slice(-4).map((edit) => edit.id)
  const selected = new Set(batch.map(editKey))
  const window = new ConfirmedWindow(history)
  expect(window.pairs(batch)).toEqual(
    window
      .pairs()
      .filter(
        ([a, b]) => selected.has(editKey(a.envelope.id)) || selected.has(editKey(b.envelope.id)),
      ),
  )
})

test('the replay cap retains the same canonical suffix regardless of arrival order', () => {
  const history: Envelope[] = Array.from({ length: 8193 }, (_, i) => ({
    document: 'review',
    epoch: '1',
    id: { actor: 'a', seq: i + 1 },
    lamport: i + 1,
    deps: i ? [{ actor: 'a', seq: i }] : [],
    change: {
      kind: 'insert',
      start: { bunch: 'a', counter: i },
      text: 'x',
      originLeft: 'start',
      originRight: 'end',
    },
  }))
  const window = new ConfirmedWindow(history)
  expect(window.edits).toHaveLength(8192)
  expect(window.edits[0]!.envelope.id.seq).toBe(2)
  expect(new ConfirmedWindow(history.toReversed()).edits).toEqual(window.edits)
  expect(window.pairs()).toEqual([])
  expect(() => new ConfirmedWindow(history, 8193)).toThrow()
})

test('touches preserve exact UTF-16 spans for insert, delete and replace', () => {
  const peer = new Participant({
    actor: 'a',
    document: 'review',
    epoch: '1',
    engine: createEngine(),
  })
  const insert = peer.local({ offset: 0, deleteCount: 0, text: 'a😀b' })
  const remove = peer.local({ offset: 1, deleteCount: 2, text: '' })
  const replace = peer.local({ offset: 0, deleteCount: 1, text: 'AB' })
  const window = new ConfirmedWindow([replace, insert, remove])
  expect(
    window.edits.map(({ inserted, deleted }) => ({
      inserted: expand(inserted),
      deleted: expand(deleted),
    })),
  ).toEqual([
    {
      inserted: expand([
        {
          start: insert.change.kind === 'insert' ? insert.change.start : { bunch: '', counter: 0 },
          count: 4,
        },
      ]),
      deleted: [],
    },
    {
      inserted: [],
      deleted:
        insert.change.kind === 'insert'
          ? expand([
              {
                start: { ...insert.change.start, counter: insert.change.start.counter + 1 },
                count: 2,
              },
            ])
          : [],
    },
    {
      inserted:
        replace.change.kind === 'replace'
          ? expand([{ start: replace.change.insert.start, count: 2 }])
          : [],
      deleted:
        insert.change.kind === 'insert' ? expand([{ start: insert.change.start, count: 1 }]) : [],
    },
  ])
})
