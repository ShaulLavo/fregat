import { expect, test, vi } from 'vitest'
import {
  Presence,
  parsePresence,
  type PresenceObserver,
  type PresenceMessage,
} from '../src/presence'
import { remoteState, ReferenceResolver } from './presence-fixtures'
import { Session } from '../src/session'
import { Network } from './network'
import type { Message } from '../src/protocol'
import { ToyEngine, genesis, type ToyEdit } from './engine'

function wire() {
  let observer: PresenceObserver | undefined
  let clock: ((now: number) => void) | undefined
  const sendPresence = vi.fn<(payload: PresenceMessage) => void>()
  const subscribePresence = vi.fn((next: PresenceObserver) => {
    observer = next
    return () => {
      observer = undefined
    }
  })
  const channel = {
    presenceTime: 0,
    sendPresence,
    subscribePresence,
    subscribePresenceClock: vi.fn((next: (now: number) => void) => {
      clock = next
      return () => {
        clock = undefined
      }
    }),
  }
  return {
    channel,
    tick(now: number) {
      channel.presenceTime = now
      clock?.(now)
    },
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
  expect(channel.channel.subscribePresenceClock).not.toHaveBeenCalled()
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
  channel.tick(14_999)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(1)
  channel.tick(15_000)
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

test('newer clocks win, equal-clock null is rejected, renewals refresh expiry without repainting', () => {
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
  expect(presence.receive('remote', { clock: 5, state: null })).toBe(false)
  expect(presence.states).toHaveLength(0)
  presence.tick(50_050)
  expect(presence.states).toHaveLength(1)
  expect(presence.receive('remote', { clock: 6, state: null })).toBe(true)
  expect(presence.states).toHaveLength(0)
  expect(presence.receive('remote', payload('remote', 5))).toBe(false)
  expect(presence.receive('remote', { clock: 6, state: null })).toBe(false)
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

test('session replay bounds presence while its clock floor admits fresh reordered state', () => {
  const network = new Network(997, 2, 8)
  const session = network.nodes[0]!.session
  const peer = network.nodes[1]!.session.peer
  const presence = new Presence(session.peer, 'document', session)
  const detach = presence.attach()
  const base = {
    version: 1 as const,
    room: 'room',
    document: 'document',
    sender: peer,
    epoch: 'epoch',
  }
  const receive = (messageId: number, clock: number) =>
    session.receive({ ...base, messageId, type: 'PRESENCE', payload: payload(peer, clock) })
  try {
    expect(
      session.receive({
        ...base,
        messageId: 32,
        type: 'HAVE',
        payload: { tip: genesis, epoch: 'epoch' },
      }),
    ).toBe(true)
    expect(receive(31, 1)).toBe(true)
    expect(presence.states[0]?.presenceClock).toBe(1)
    expect(receive(31, 2)).toBe(false)
    expect(receive(24, 3)).toBe(false)
    expect(receive(25, 2)).toBe(true)
    session.tick(50)
    expect(presence.states[0]?.presenceClock).toBe(2)
    expect(receive(33, 1)).toBe(true)
    expect(presence.states[0]?.presenceClock).toBe(2)
    expect(receive(34, 3)).toBe(true)
    session.tick(100)
    expect(presence.states[0]?.presenceClock).toBe(3)
  } finally {
    detach()
    presence.dispose()
  }
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

test('coalesces local bursts at 20 sends per second and flushes the final state', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  const detach = presence.attach()
  for (let clock = 1; clock <= 10_000; clock++)
    presence.setLocalState({ ...remoteState(), displayName: `Latest ${clock}` })
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(1)
  presence.tick(49)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(1)
  presence.tick(50)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(2)
  expect(channel.channel.sendPresence.mock.lastCall![0].state?.displayName).toBe('Latest 10000')
  presence.setLocalState({ ...remoteState(), displayName: 'Cancelled' })
  detach()
  const calls = channel.channel.sendPresence.mock.calls.length
  presence.tick(100)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(calls)
  expect(channel.channel.sendPresence.mock.lastCall![0].state).toBeNull()
})

test('coalesces each inbound peer to latest state, preserves clocks and removes leave promptly', () => {
  const presence = new Presence('local', 'document')
  const changed = vi.fn()
  presence.subscribe(changed)
  for (let clock = 1; clock <= 10_000; clock++)
    presence.receive('remote', {
      clock,
      state: { ...remoteState('remote', clock), displayName: `Latest ${clock}` },
    })
  expect(changed).toHaveBeenCalledTimes(1)
  expect(presence.receive('remote', payload('remote', 9_999))).toBe(false)
  expect(
    presence.receive('remote', {
      clock: 20_000,
      state: { ...remoteState('remote', 20_000), colour: 'bad' },
    }),
  ).toBe(false)
  presence.tick(50)
  expect(changed).toHaveBeenCalledTimes(2)
  expect(presence.states[0]?.displayName).toBe('Latest 10000')
  presence.receive('remote', payload('remote', 10_001))
  presence.receive('remote', { clock: 10_002, state: null })
  expect(presence.states).toHaveLength(0)
  presence.tick(100)
  expect(presence.states).toHaveLength(0)
})

test('completed local host handoff clears remote awareness on the readable final document', () => {
  const network = new Network(90001, 4)
  network.stabilize()
  for (const [key, link] of network.links)
    network.links.set(key, { ...link, delay: 1, jitter: 1, drop: 0, duplicate: 0, tailDelay: 0 })
  const host = network.nodes.findIndex((node) => node.session.isHost)
  const successor = (host + 1) % network.nodes.length
  const departed = network.nodes[host]!
  const remote = network.nodes[successor]!
  const presence = new Presence(departed.session.peer, 'document', departed.session)
  const other = new Presence(remote.session.peer, 'document', remote.session)
  const detach = presence.attach()
  const tick = vi.spyOn(presence, 'tick')
  const detachOther = other.attach()
  other.setLocalState(remoteState())
  network.advance(30)
  expect(presence.states).toHaveLength(1)
  const finalTip = departed.engine.checkpoint()
  departed.session.leave(remote.session.peer)
  network.advance(100)
  expect(departed.session.status).toBe('left')
  expect(departed.engine.checkpoint()).toEqual(finalTip)
  expect(presence.states).toHaveLength(0)
  tick.mockClear()
  network.advance(4_000)
  expect(presence.states).toHaveLength(0)
  expect(tick).not.toHaveBeenCalled()
  detach()
  detachOther()
})

test('real Session-backed awareness has no empty, post-expiry or detached clock callbacks', () => {
  const session = new Session({
    peer: 'local',
    room: 'room',
    document: 'document',
    genesis,
    engine: new ToyEngine(),
    send() {},
    pulseInterval: 100,
    suspicionTimeout: 300,
    dependencyTimeout: 500,
    historyChunkRecords: 10,
  })
  session.connect('remote')
  const presence = new Presence('local', 'document', session)
  const tick = vi.spyOn(presence, 'tick')
  const receive = (clock: number) =>
    session.receive({
      version: 1,
      room: 'room',
      document: 'document',
      sender: 'remote',
      epoch: 'epoch',
      messageId: clock,
      type: 'PRESENCE',
      payload: payload('remote', clock),
    })
  const detach = presence.attach()
  for (let now = 1; now <= 1_000; now++) session.tick(now)
  expect(tick).not.toHaveBeenCalled()
  receive(1)
  expect(presence.states).toHaveLength(1)
  session.tick(31_000)
  expect(presence.states).toHaveLength(0)
  tick.mockClear()
  for (let now = 31_001; now <= 32_000; now++) session.tick(now)
  expect(tick).not.toHaveBeenCalled()
  presence.setLocalState(remoteState())
  session.tick(32_001)
  expect(tick).toHaveBeenCalledTimes(1)
  presence.leave()
  tick.mockClear()
  session.tick(32_002)
  expect(tick).not.toHaveBeenCalled()
  receive(2)
  expect(presence.states).toHaveLength(1)
  detach()
  tick.mockClear()
  for (let now = 32_003; now <= 33_000; now++) session.tick(now)
  expect(tick).not.toHaveBeenCalled()
})

test.each([false, true])(
  'rejects delayed presence replays after expiry and long idle periods (reattach=%s)',
  (reattach) => {
    const session = new Session({
      peer: 'local',
      room: 'room',
      document: 'document',
      genesis,
      engine: new ToyEngine(),
      send() {},
      pulseInterval: 100,
      suspicionTimeout: 300,
      dependencyTimeout: 500,
      historyChunkRecords: 10,
    })
    session.connect('remote')
    const presence = new Presence('local', 'document', session)
    let detach = presence.attach()
    let messageId = 0
    const receive = (clock: number) =>
      session.receive({
        version: 1,
        room: 'room',
        document: 'document',
        sender: 'remote',
        epoch: 'epoch',
        messageId: ++messageId,
        type: 'PRESENCE',
        payload: payload('remote', clock),
      })
    try {
      receive(7)
      expect(presence.states[0]?.presenceClock).toBe(7)
      session.tick(30_000)
      expect(presence.states).toHaveLength(0)
      session.tick(89_999)
      receive(6)
      expect(presence.states).toHaveLength(0)
      if (reattach) detach()
      session.tick(90_000)
      if (reattach) detach = presence.attach()
      receive(5)
      expect(presence.states).toHaveLength(0)
      receive(7)
      expect(presence.states).toHaveLength(0)
      session.tick(86_400_000)
      receive(5)
      receive(7)
      expect(presence.states).toHaveLength(0)
      receive(8)
      expect(presence.states[0]?.presenceClock).toBe(8)
    } finally {
      detach()
      presence.dispose()
    }
  },
)

test('bounds peer-session clock floors across lazy state pruning and releases them on disposal', () => {
  const presence = new Presence('local', 'document')
  for (let peer = 0; peer < 256; peer++) presence.receive(`peer-${peer}`, { clock: 3, state: null })
  expect(presence.receive('overflow', payload('overflow'))).toBe(false)
  presence.tick(60_000)
  expect(presence.receive('overflow', payload('overflow'))).toBe(false)
  expect(presence.receive('peer-0', payload('peer-0', 1))).toBe(false)
  expect(presence.receive('peer-0', payload('peer-0', 3))).toBe(false)
  expect(presence.receive('peer-0', payload('peer-0', 4))).toBe(true)
  presence.dispose()
  const nextRoom = new Presence('local', 'document')
  expect(nextRoom.receive('peer-0', payload('peer-0', 1))).toBe(true)
  expect(nextRoom.receive('overflow', payload('overflow'))).toBe(true)
  nextRoom.dispose()
})

test('disposal discards queued incoming and outgoing states without deferred callbacks', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  presence.attach()
  const changed = vi.fn()
  presence.subscribe(changed)
  presence.setLocalState(remoteState())
  presence.setLocalState({ ...remoteState(), displayName: 'Queued local' })
  presence.receive('remote', payload('remote', 1))
  presence.receive('remote', payload('remote', 2))
  presence.dispose()
  const notifications = changed.mock.calls.length
  const sends = channel.channel.sendPresence.mock.calls.length
  presence.tick(60_000)
  expect(changed).toHaveBeenCalledTimes(notifications)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(sends)
  expect(channel.channel.sendPresence.mock.lastCall![0].state).toBeNull()
  expect(presence.states).toHaveLength(0)
})

test('final detach cancels the pending inbound latest state and stops notifications', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  const detach = presence.attach()
  const changed = vi.fn()
  presence.subscribe(changed)
  presence.receive('remote', payload('remote', 1))
  presence.receive('remote', {
    clock: 2,
    state: { ...remoteState('remote', 2), displayName: 'Pending' },
  })
  detach()
  expect(presence.states).toHaveLength(0)
  const notifications = changed.mock.calls.length
  presence.tick(50)
  expect(presence.states).toHaveLength(0)
  expect(changed).toHaveBeenCalledTimes(notifications)
})

test('repeated leave and reappearance cannot bypass outgoing burst limits', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  const detach = presence.attach()
  for (let i = 0; i < 10_000; i++) {
    presence.setLocalState(remoteState())
    presence.setLocalState(null)
  }
  presence.setLocalState({ ...remoteState(), displayName: 'Final' })
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(2)
  presence.tick(50)
  expect(channel.channel.sendPresence).toHaveBeenCalledTimes(3)
  expect(channel.channel.sendPresence.mock.lastCall![0].state?.displayName).toBe('Final')
  detach()
})

test('prompt null removal cannot be used to bypass a peer inbound cadence', () => {
  const presence = new Presence('local', 'document')
  const changed = vi.fn()
  presence.subscribe(changed)
  for (let clock = 1; clock <= 20_000; clock += 2) {
    presence.receive('remote', payload('remote', clock))
    presence.receive('remote', { clock: clock + 1, state: null })
  }
  presence.receive('remote', payload('remote', 20_001))
  expect(changed).toHaveBeenCalledTimes(2)
  presence.tick(50)
  expect(changed).toHaveBeenCalledTimes(3)
  expect(presence.states[0]?.presenceClock).toBe(20_001)
})

test('attachment churn preserves the positive-state sending cadence', () => {
  const channel = wire()
  const presence = new Presence('local', 'document', channel.channel)
  for (let i = 0; i < 100; i++) {
    presence.setLocalState(remoteState())
    presence.attach()()
  }
  expect(channel.channel.sendPresence.mock.calls.filter(([packet]) => packet.state)).toHaveLength(1)
  presence.setLocalState(remoteState())
  const detach = presence.attach()
  channel.tick(50)
  expect(channel.channel.sendPresence.mock.calls.filter(([packet]) => packet.state)).toHaveLength(2)
  detach()
})
