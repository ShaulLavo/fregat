import { expect, test } from 'vitest'
import { ConfirmedWindow } from '@singapore-editor/collab'
import type { Envelope } from '@singapore-editor/collab'
import { CollaborationDocument } from '../src/document'
import { Session } from '../src/session'
import type { Message } from '../src/protocol'
import { history, syntaxFixture } from './merge-review-fixture'

function random(seed: number) {
  let state = seed
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b)
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b)
    state ^= state >>> 16
    return (state >>> 0) / 4294967296
  }
}

test.each(Array.from({ length: 10 }, (_, index) => index))(
  'seeded separation and shared-unit simulation shard %i',
  async (shard) => {
    const fixture = await syntaxFixture('typescript', false, 'differential')
    let independentMarks = 0
    let sharedMarked = 0
    try {
      for (let run = 0; run < 1000; run++) {
        const seed = shard * 1000 + run + 1
        const next = random(seed)
        const text = `function east${seed}() { return 1; }\nfunction west${seed}() { return 2; }`
        const first = text.indexOf('return 1') + 7
        const second = text.indexOf('return 2') + 7
        const authors = [`peer-${Math.floor(next() * 4)}`, `other-${Math.floor(next() * 4)}`]
        const edit = { offset: first, deleteCount: 1, text: String(3 + Math.floor(next() * 5)) }
        const independent = history(
          text,
          [edit, { offset: second, deleteCount: 1, text: '9' }],
          authors,
        )
        const separate = await fixture.detector.detect(
          independent.window,
          independent.base.snapshot(),
        )
        expect(separate.status, `independent seed ${seed}`).toBe('complete')
        independentMarks += separate.marks.length
        const shared = history(text, [edit, { offset: first, deleteCount: 1, text: '9' }], authors)
        const together = await fixture.detector.detect(shared.window, shared.base.snapshot())
        expect(together.status, `shared seed ${seed}`).toBe('complete')
        sharedMarked += Number(together.marks.some((mark) => mark.kind === 'overlap'))
        fixture.clear()
      }
      expect(independentMarks).toBe(0)
      expect(sharedMarked).toBe(1000)
    } finally {
      fixture.dispose()
    }
  },
  30_000,
)

test.each([1, 17, 43, 91, 120])(
  'real peer sessions converge on identical marks, seed %i',
  async (seed) => {
    const next = random(seed)
    const fixture = await syntaxFixture('typescript', false, 'differential')
    const count = 3 + Math.floor(next() * 4)
    const text = 'function combine() { return 1; }\nfunction separate() { return 2; }'
    const documents = Array.from(
      { length: count },
      (_, index) =>
        new CollaborationDocument({ peer: `peer-${index}`, document: 'review', epoch: '1', text }),
    )
    const packets: { to: number; message: Message<Envelope> }[] = []
    const sessions = documents.map(
      (document, index) =>
        new Session({
          peer: `peer-${index}`,
          room: 'review-room',
          document: 'review',
          genesis: document.genesis,
          engine: document,
          pulseInterval: 30,
          suspicionTimeout: 300,
          dependencyTimeout: 900,
          historyChunkRecords: 3,
          send: (peer, message) => {
            const to = Number(peer.slice(5))
            packets.push({ to, message })
            if (next() < 0.2) packets.push({ to, message })
          },
        }),
    )
    const advance = (from: number, to: number) => {
      for (let tick = from; tick < to; tick++) {
        for (const session of sessions) session.tick(tick * 10)
        const delivery = packets
          .splice(0)
          .map((packet) => ({ packet, order: next() }))
          .sort((a, b) => a.order - b.order)
        for (const { packet } of delivery) sessions[packet.to]!.receive(packet.message)
      }
    }
    try {
      for (const session of sessions)
        for (const other of sessions) if (session !== other) session.connect(other.peer)
      advance(0, 60)
      expect(new Set(sessions.map((session) => session.host)).size).toBe(1)
      const authored = documents.map((document, index) =>
        document.participant.local({
          offset: text.indexOf('return 1') + 7,
          deleteCount: 1,
          text: String(index + 3),
        }),
      )
      for (let index = 0; index < count; index++) sessions[index]!.submit(authored[index]!)
      advance(60, 250)
      const expected = await fixture.detector.detect(
        new ConfirmedWindow(authored),
        documents[0]!.engine.snapshot(),
      )
      expect(expected.marks.length).toBeGreaterThan(0)
      for (const document of documents) {
        expect(document.participant.state().pending).toHaveLength(0)
        expect(document.engine.text()).toBe(documents[0]!.engine.text())
        const log = document
          .exportHistory(document.genesis)!
          .filter((record) => record.outcome.kind === 'accepted')
          .map((record) => record.edit)
        expect(
          await fixture.detector.detect(new ConfirmedWindow(log), document.engine.snapshot()),
        ).toEqual(expected)
      }
    } finally {
      fixture.dispose()
    }
  },
)
