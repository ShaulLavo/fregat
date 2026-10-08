import { expect, test, vi } from 'vitest'
import {
  Presence,
  parsePresence,
  type PresenceObserver,
  type PresenceMessage,
} from '../src/presence'
import { remoteState, ReferenceResolver } from './presence-fixtures'
import { Session } from '../src/session'
import type { Message } from '../src/protocol'
import { ToyEngine, genesis, type ToyEdit } from './engine'

function wire() {
  let observer: PresenceObserver | undefined
  const sendPresence = vi.fn<(payload: PresenceMessage) => void>()
  const subscribePresence = vi.fn((next: PresenceObserver) => {
    observer = next
    return () => {
      observer = undefined
    }
  })
  return {
    channel: { sendPresence, subscribePresence },
    get observer() {
      return observer
    },
  }
}

function payload(peer = 'remote', clock = 1) {
  return { clock, state: remoteState(peer, clock) }
}

test('unattached awareness creates no timer, subscription or transport work', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  const state = remoteState()
  presence.setLocalState(state)
  presence.tick(60_000)
  expect(channel.channel.subscribePresence).not.toHaveBeenCalled()
  expect(channel.channel.sendPresence).not.toHaveBeenCalled()
  expect(channel.observer).toBeUndefined()
})

test('renews every 15 seconds through the session clock and sends null on final detach', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  const detach = presence.attach()
  const second = presence.attach()
  presence.setLocalState(remoteState())
  const first = channel.channel.sendPresence.mock.lastCall![0]
  channel.observer!.tick(14_999)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(1)
  channel.observer!.tick(15_000)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(2)
  expect(channel.channel.sendPresence.mock.lastCall![0].clock).toBe(first.clock + 1)
  detach()
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(2)
  second()
  const leave = channel.channel.sendPresence.mock.lastCall![0]
  expect(leave).toEqual({ clock: first.clock + 2, state: null })
  expect(channel.observer).toBeUndefined()
  second()
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(3)
})

test('newer clocks win, equal-clock null removes, renewals refresh expiry without repainting', () => {
  const presence = new Presence('local', 'document')
  const changed = vi.fn()
  presence.subscribe(changed)
  expect(presence.receive('remote', payload('remote', 3))).toBe(true)
  presence.tick(20_000)
  expect(presence.receive('remote', payload('remote', 2))).toBe(false)
  expect(presence.receive('remote', payload('remote', 3))).toBe(false)
  expect(presence.receive('remote', payload('remote', 4))).toBe(true)
  expect(changed).toHaveBeenCalledTimes(1)
  presence.tick(49_999)
  expect(presence.states).toHaveLength(1)
  presence.tick(50_000)
  expect(presence.states).toHaveLength(0)
  expect(presence.receive('remote', payload('remote', 4))).toBe(false)
  expect(presence.receive('remote', payload('remote', 5))).toBe(true)
  expect(presence.receive('remote', { clock: 5, state: null })).toBe(true)
  expect(presence.receive('remote', payload('remote', 5))).toBe(false)
  expect(presence.receive('remote', { clock: 5, state: null })).toBe(false)
})

test('ignores own state, preserves tombstone clocks, and bounds peer churn', () => {
  const presence = new Presence('local', 'document')
  expect(presence.receive('local', payload('local'))).toBe(false)
  expect(presence.receive('remote', payload('remote', 0))).toBe(false)
  expect(presence.receive('remote', { clock: 0, state: null })).toBe(false)
  for (let i = 0; i < 256; i++)
    expect(presence.receive(`peer-${i}`, { clock: 3, state: null })).toBe(true)
  expect(presence.receive('overflow', payload('overflow'))).toBe(false)
  expect(presence.receive('peer-0', payload('peer-0', 2))).toBe(false)
  expect(presence.receive('peer-0', payload('peer-0', 4))).toBe(true)
})

test('validates and copies bounded hostile state at the wire boundary', () => {
  const valid = payload()
  const hostile = [
    null,
    [],
    { clock: -1, state: null },
    { clock: Infinity, state: null },
    { clock: Number.MAX_SAFE_INTEGER + 1, state: null },
    { ...valid, state: { ...valid.state, peerSessionId: 'other' } },
    { ...valid, state: { ...valid.state, documentId: 'other' } },
    { ...valid, state: { ...valid.state, presenceClock: 9 } },
    ...['', 'a'.repeat(129), 'bad\nname', String.fromCharCode(0x202e) + 'name'].map(
      (displayName) => ({
        ...valid,
        state: { ...valid.state, displayName },
      }),
    ),
    ...['red', '#123', '#12345678', 'url(bad)', '#zzzzzz'].map((colour) => ({
      ...valid,
      state: { ...valid.state, colour },
    })),
    { ...valid, state: { ...valid.state, focusedViewId: 'x'.repeat(257) } },
    { ...valid, state: { ...valid.state, tip: { depth: -1, hash: 'tip' } } },
    { ...valid, state: { ...valid.state, epoch: 'x'.repeat(257) } },
    {
      ...valid,
      state: {
        ...valid.state,
        selections: Array(33).fill({
          anchor: { left: 'start', right: 'end', bias: 'left' },
          head: { left: 'start', right: 'end', bias: 'left' },
        }),
      },
    },
    {
      ...valid,
      state: {
        ...valid.state,
        selections: [
          { anchor: { left: { bunch: 'x', counter: -1 }, right: 'end', bias: 'left' }, head: {} },
        ],
      },
    },
    {
      ...valid,
      state: {
        ...valid.state,
        selections: [{ anchor: { left: 'end', right: 'start', bias: 'left' }, head: {} }],
      },
    },
  ]
  for (const input of hostile) expect(parsePresence(input, 'remote', 'document')).toBeUndefined()
  const parsed = parsePresence(
    { ...valid, ignored: 'x'.repeat(10_000), state: { ...valid.state, extra: 'x'.repeat(10_000) } },
    'remote',
    'document',
  )!
  expect(parsed).toEqual(valid)
  Object.assign(valid.state.tip, { hash: 'changed' })
  expect(parsed.state?.tip.hash).toBe('genesis')
})

test('retains gaps awaiting edits and resolves biased tombstone gaps through the reference engine', () => {
  const resolver = new ReferenceResolver('ab')
  const gap = {
    left: { bunch: 'pending:0', counter: 0 },
    right: { bunch: 'seed:0', counter: 1 },
    bias: 'left' as const,
  }
  const presence = new Presence('local', 'document')
  const state = { ...remoteState(), selections: [{ anchor: gap, head: gap }] }
  presence.receive('remote', { clock: 1, state })
  expect(resolver.resolveGap(gap)).toBeUndefined()
  expect(presence.states[0]!.selections).toEqual(state.selections)
  resolver.engine.apply({
    document: 'document',
    epoch: 'epoch',
    id: { actor: 'pending', seq: 0 },
    lamport: 1,
    deps: [],
    change: {
      kind: 'insert',
      start: gap.left,
      originLeft: { bunch: 'seed:0', counter: 0 },
      originRight: gap.right,
      text: 'X',
    },
  })
  expect(resolver.resolveGap(gap)).toBe(2)
  resolver.engine.apply({
    document: 'document',
    epoch: 'epoch',
    id: { actor: 'pending', seq: 1 },
    lamport: 2,
    deps: [],
    change: { kind: 'delete', spans: [{ start: gap.left, count: 1 }] },
  })
  expect(resolver.resolveGap(gap)).toBe(1)
  expect(resolver.resolveGap({ ...gap, bias: 'right' })).toBe(1)
})

test('presence travels on PRESENCE without entering document history; remote LEAVE removes it', () => {
  const messages: Message<ToyEdit>[] = []
  const engine = new ToyEngine()
  const session = new Session({
    peer: 'local',
    room: 'room',
    document: 'document',
    genesis,
    engine,
    send: (_peer, message) => messages.push(message),
    pulseInterval: 100,
    suspicionTimeout: 300,
    dependencyTimeout: 500,
    historyChunkRecords: 10,
  })
  session.connect('remote')
  const presence = new Presence('local', 'document', session)
  const detach = presence.attach()
  presence.setLocalState(remoteState())
  expect(messages.at(-1)?.type).toBe('PRESENCE')
  expect(engine.checkpoint()).toEqual(genesis)
  const base = {
    version: 1 as const,
    room: 'room',
    document: 'document',
    sender: 'remote',
    epoch: 'epoch',
  }
  session.receive({ ...base, messageId: 1, type: 'PRESENCE', payload: payload() })
  expect(presence.states).toHaveLength(1)
  session.receive({ ...base, messageId: 2, type: 'LEAVE', payload: { successor: null } })
  expect(presence.states).toHaveLength(0)
  expect(engine.checkpoint()).toEqual(genesis)
  detach()
})

test('detach preserves clocks across reattachment and room disposal clears retained state', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  const detach = presence.attach()
  presence.receive('remote', payload('remote', 7))
  detach()
  expect(presence.states).toHaveLength(0)
  const next = presence.attach()
  expect(presence.receive('remote', payload('remote', 7))).toBe(false)
  expect(presence.receive('remote', payload('remote', 8))).toBe(true)
  presence.setLocalState(remoteState())
  channel.observer!.leave('local')
  expect(channel.channel.sendPresence.mock.lastCall![0].state).toBeNull()
  presence.dispose()
  next()
  presence.dispose()
  expect(channel.observer).toBeUndefined()
  expect(presence.states).toHaveLength(0)
  expect(presence.receive('remote', payload('remote', 9))).toBe(false)
  expect(() => presence.attach()).toThrow('disposed')
})

test('gap bias chooses either side of concurrent insertions', () => {
  const resolver = new ReferenceResolver('ab')
  const gap = resolver.gap(1, 'left')
  resolver.engine.apply({
    document: 'document',
    epoch: 'epoch',
    id: { actor: 'concurrent', seq: 0 },
    lamport: 1,
    deps: [],
    change: {
      kind: 'insert',
      start: { bunch: 'concurrent:0', counter: 0 },
      originLeft: gap.left,
      originRight: gap.right,
      text: 'X',
    },
  })
  expect(resolver.resolveGap(gap)).toBe(1)
  expect(resolver.resolveGap({ ...gap, bias: 'right' })).toBe(2)
})
