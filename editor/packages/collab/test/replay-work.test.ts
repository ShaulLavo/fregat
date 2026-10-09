import { expect, test, vi } from 'vitest'
import { Host, Participant } from '../src/index'
import type { Envelope, HostMessage } from '../src/index'
import { createEngine } from './engine-fixture'

function setup(actor = 'a') {
  const engine = createEngine()
  const participant = new Participant({ actor, document: 'test', epoch: '1', engine })
  const host = new Host({ document: 'test', epoch: '1', engine: createEngine() })
  return { engine, participant, host }
}

function accepted(host: Host, envelope: Envelope): HostMessage {
  const message = host.submit(envelope, envelope.id.actor)
  if (message.status !== 'accepted') throw new TypeError('Expected accepted edit')
  return message
}

test('unchanged own-head acknowledgements advance the confirmed prefix without applying or restoring', () => {
  const { engine, participant, host } = setup()
  const pending = participant.localBatch(
    Array.from({ length: 20 }, (_, offset) => ({ offset, deleteCount: 0, text: 'a' })),
  )
  const apply = vi.spyOn(engine, 'apply')
  const restore = vi.spyOn(engine, 'restore')
  const before = engine.snapshot()
  for (const envelope of pending) participant.receive([accepted(host, envelope)])
  expect(apply).toHaveBeenCalledTimes(0)
  expect(restore).toHaveBeenCalledTimes(0)
  expect(engine.changesBetween(before)).toEqual([])
  expect(participant.state().pending).toEqual([])

  const remote = setup('b').participant.local({ offset: 0, deleteCount: 0, text: 'b' })
  participant.receive([accepted(host, remote)])
  expect(participant.text()).toBe(host.text())
})

test('a mixed host batch restores once and replays only remaining pending edits', () => {
  const { engine, participant, host } = setup()
  const pending = participant.localBatch([
    { offset: 0, deleteCount: 0, text: 'a' },
    { offset: 1, deleteCount: 0, text: 'b' },
    { offset: 2, deleteCount: 0, text: 'c' },
  ])
  const foreign = setup('z').participant.local({ offset: 0, deleteCount: 0, text: 'z' })
  const messages = [
    accepted(host, pending[0]!),
    accepted(host, foreign),
    accepted(host, pending[1]!),
  ]
  const restore = vi.spyOn(engine, 'restore')
  const apply = vi.spyOn(engine, 'apply')
  const before = engine.snapshot()
  const publications: (readonly {
    readonly from: number
    readonly to: number
    readonly text: string
  }[])[] = []
  participant.subscribe(({ edits }) => publications.push(edits))
  participant.receive(messages)
  expect(restore).toHaveBeenCalledTimes(1)
  expect(apply).toHaveBeenCalledTimes(4)
  expect(publications).toEqual([engine.changesBetween(before)])
  expect(participant.state().pending.map((edit) => edit.id)).toEqual([pending[2]!.id])
  participant.receive([accepted(host, pending[2]!)])
  expect(restore).toHaveBeenCalledTimes(1)
  expect(apply).toHaveBeenCalledTimes(4)
  expect(participant.text()).toBe(host.text())
})

test('a changed acceptance with the same ID reconciles its payload', () => {
  const { engine, participant, host } = setup()
  const envelope = participant.local({ offset: 0, deleteCount: 0, text: 'a' })
  if (envelope.change.kind !== 'insert') throw new TypeError('Expected insertion')
  const changed = { ...envelope, change: { ...envelope.change, text: 'b' } }
  const restore = vi.spyOn(engine, 'restore')
  participant.receive([accepted(host, changed)])
  expect(restore).toHaveBeenCalledTimes(1)
  expect(participant.text()).toBe('b')
})

test('installing a long split and confirming its losing branch has linear envelope work', () => {
  const count = process.env.COLLABORATION_LONG_RUN === '1' ? 2_000 : 64
  const { engine, participant, host } = setup()
  const winner = setup('b').participant
  const winning = winner.localBatch(
    Array.from({ length: count }, (_, offset) => ({ offset, deleteCount: 0, text: 'b' })),
  )
  const losing = participant.localBatch(
    Array.from({ length: count }, (_, offset) => ({ offset, deleteCount: 0, text: 'a' })),
  )
  const base = createEngine().snapshot()
  const history = winning.map((envelope) => accepted(host, envelope))
  const apply = vi.spyOn(engine, 'apply')
  const restore = vi.spyOn(engine, 'restore')
  participant.install(base, history)
  for (const envelope of losing) participant.receive([accepted(host, envelope)])
  expect(apply.mock.calls.length).toBeLessThanOrEqual(3 * count)
  expect(restore).toHaveBeenCalledTimes(1)
  expect(participant.state().pending).toEqual([])
  expect(participant.text()).toBe(host.text())
}, 120_000)

test.each([0, 1, 10, 100])(
  'typing with %i pending edits applies one envelope and takes one snapshot',
  (count) => {
    const { engine, participant } = setup()
    if (count)
      participant.localBatch(
        Array.from({ length: count }, (_, offset) => ({ offset, deleteCount: 0, text: 'a' })),
      )
    const apply = vi.spyOn(engine, 'apply')
    const restore = vi.spyOn(engine, 'restore')
    const snapshot = vi.spyOn(engine, 'snapshot')
    participant.local({ offset: count, deleteCount: 0, text: 'b' })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(0)
    expect(snapshot).toHaveBeenCalledTimes(1)
  },
)
