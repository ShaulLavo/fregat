import { serialize } from 'node:v8'
import { expect, test } from 'vitest'
import { type Message } from '../src/protocol'
import { Session } from '../src/session'
import { genesis, ToyEngine, type ToyEdit } from './engine'

function receiver(
  onPresence?: (peer: string, payload: { clock: number; state: unknown }) => void,
  replayWindowSize?: number,
) {
  const session = new Session<ToyEdit>({
    peer: 'b',
    room: 'room',
    document: 'document',
    genesis,
    engine: new ToyEngine(),
    pulseInterval: 30,
    suspicionTimeout: 300,
    dependencyTimeout: 900,
    historyChunkRecords: 5,
    send: () => {},
    onPresence,
    replayWindowSize,
  })
  session.connect('a')
  return session
}

function pulse(messageId: number): Message<ToyEdit> {
  return {
    version: 1,
    room: 'room',
    document: 'document',
    sender: 'a',
    messageId,
    epoch: genesis.hash,
    type: 'HOST_PULSE',
    payload: {
      branch: { tip: genesis, authority: { host: 'a', term: 0, epoch: genesis.hash } },
      members: ['a', 'b'],
    },
  }
}

function retainedBytes(session: Session<ToyEdit>): number {
  return serialize(Reflect.get(session, 'seen')).byteLength
}

test('a surviving session rejects duplicates across a temporary disconnect', () => {
  let received = 0
  const session = receiver(() => received++)
  const presence: Message<ToyEdit> = {
    ...pulse(1),
    type: 'PRESENCE',
    payload: { clock: 1, state: null },
  }
  session.receive(presence)
  session.receive(presence)
  session.disconnect('a')
  session.connect('a')
  session.receive(presence)
  session.receive({ ...presence, messageId: 2 })
  expect(received).toBe(2)
})

test('a surviving session bounds dedup state after one million unique pulses', () => {
  const session = receiver()
  session.receive(pulse(1))
  expect(retainedBytes(session)).toBeLessThan(4096)
  for (let id = 2; id <= 1_000_000; id++) session.receive(pulse(id))
  expect(retainedBytes(session)).toBeLessThan(4096)
  expect(session.members.has('a')).toBe(true)
  const state = Reflect.get(session, 'seen') as Map<string, object>
  expect(state.size).toBe(1)
  expect((Reflect.get(state.get('a')!, 'bits') as Uint32Array).byteLength).toBe(1024)
  console.log(
    `Replay dedup: 1,000,000 pulses; retainedBytes=${retainedBytes(session)}; bitmapBytes=1024`,
  )
})

test('late unique presence is accepted inside the window and treated as loss below its floor', () => {
  const received: number[] = []
  const session = receiver((_, payload) => received.push(payload.clock), 8)
  const presence = (id: number): Message<ToyEdit> => ({
    ...pulse(id),
    type: 'PRESENCE',
    payload: { clock: id, state: null },
  })
  for (const id of [10, 3, 5, 9]) expect(session.receive(presence(id))).toBe(true)
  for (const id of [10, 3, 5, 9, 2, 1]) expect(session.receive(presence(id))).toBe(false)
  expect(session.receive(presence(18))).toBe(true)
  for (const id of [1, 2, 3, 5, 9, 10]) expect(session.receive(presence(id))).toBe(false)
  expect(received).toEqual([10, 3, 5, 9, 18])
})

test('retired session IDs release dedup state and a fresh session ID starts at one', () => {
  let received = 0
  const session = receiver(() => received++)
  const presence: Message<ToyEdit> = {
    ...pulse(1),
    type: 'PRESENCE',
    payload: { clock: 1, state: null },
  }
  expect(session.receive(presence)).toBe(true)
  session.retire('a')
  const seen = Reflect.get(session, 'seen') as Map<string, object>
  expect(seen.size).toBe(0)
  session.connect('a')
  expect(session.members.has('a')).toBe(false)
  session.connect('a-restarted')
  expect(session.receive({ ...presence, sender: 'a-restarted' })).toBe(true)
  expect(session.receive(presence)).toBe(false)
  expect(received).toBe(2)
  for (let index = 0; index < 1000; index++) {
    const peer = `transient-${index}`
    session.connect(peer)
    session.receive({ ...presence, sender: peer })
    session.retire(peer)
    expect(seen.size).toBe(1)
  }
})

test('LEAVE releases a departed sender window and fences later traffic', () => {
  const session = receiver()
  session.receive(pulse(1))
  expect(session.receive({ ...pulse(2), type: 'LEAVE', payload: { successor: null } })).toBe(true)
  expect((Reflect.get(session, 'seen') as Map<string, object>).size).toBe(0)
  session.connect('a')
  expect(session.receive(pulse(3))).toBe(false)
})

test.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
  'invalid message ID %s cannot poison the replay window',
  (messageId) => {
    const session = receiver()
    expect(session.receive(pulse(messageId))).toBe(false)
    expect((Reflect.get(session, 'seen') as Map<string, object>).size).toBe(0)
    expect(session.receive(pulse(1))).toBe(true)
  },
)

test.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
  'invalid replay window size %s is rejected at construction',
  (size) => expect(() => receiver(undefined, size)).toThrow('Replay window size'),
)
