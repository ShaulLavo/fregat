import { createEngine, liveIds } from '../engine-fixture'
import { submitAsAuthor } from '../host-fixtures'
import { expect } from 'vitest'
import { Host, Participant } from '../../src/index'
import type { Envelope, HostMessage, OffsetEdit } from '../../src/index'
import { replica } from '../fixtures'

// Placement workloads observe causal subsets; protocol workloads consume one host log.
export function causalAuthor(actor: string) {
  const engine = createEngine()
  const edits: Envelope[] = []
  let sequence = 0
  return {
    engine,
    edits,
    observe(envelopes: readonly Envelope[]) {
      for (const envelope of envelopes) {
        if (edits.some((known) => sameEdit(known, envelope))) continue
        engine.apply(envelope)
        edits.push(envelope)
      }
    },
    insert(offset: number, text: string) {
      const envelope = engine.author(
        { offset, deleteCount: 0, text },
        {
          document: 'test',
          epoch: '1',
          id: { actor, seq: ++sequence },
          lamport: Math.max(0, ...edits.map((edit) => edit.lamport)) + 1,
          deps: edits.map((edit) => edit.id),
          allocate: () => ({ bunch: `${actor}:${sequence}`, counter: 0 }),
        },
      )
      engine.apply(envelope)
      edits.push(envelope)
      return envelope
    },
  }
}

function sameEdit(a: Envelope, b: Envelope) {
  return a.id.actor === b.id.actor && a.id.seq === b.id.seq
}

export function mergeCausal(groups: readonly (readonly Envelope[])[]) {
  const engine = createEngine()
  const host = new Host({ document: 'test', epoch: '1', engine })
  for (const group of groups) for (const edit of group) submitAsAuthor(host, edit)
  const unique = new Map(groups.flat().map((edit) => [JSON.stringify(edit.id), edit]))
  expect(host.hostSequence).toBe(unique.size)
  for (const edit of unique.values()) expect(host.outcome(edit.id)?.status).toBe('accepted')
  return engine
}

export { liveIds } from '../engine-fixture'

export function network(size: number) {
  const engine = createEngine()
  const host = new Host({ document: 'test', epoch: '1', engine })
  const users = Array.from({ length: size }, (_, index) => replica(String(index)))
  const online = new Set(users.map((_, index) => index))
  const log: HostMessage[] = []
  const outbound: { user: number; envelope: Envelope }[] = []
  const inbound: { user: number; message: HostMessage }[] = []
  host.subscribe((message) => {
    log.push(message)
    for (const user of online) inbound.push({ user, message })
  })
  function edit(user: number, change: OffsetEdit) {
    const envelope = users[user]!.participant.local(change)
    outbound.push({ user, envelope })
    return envelope
  }
  function flushOne(random: () => number) {
    const candidates = [
      ...outbound.flatMap((packet, index) =>
        online.has(packet.user) ? [{ direction: 'out' as const, index }] : [],
      ),
      ...inbound.flatMap((packet, index) =>
        online.has(packet.user) ? [{ direction: 'in' as const, index }] : [],
      ),
    ]
    if (candidates.length === 0) return false
    const chosen = candidates[Math.floor(random() * candidates.length)]!
    if (chosen.direction === 'out') {
      const packet = outbound.splice(chosen.index, 1)[0]!
      submitAsAuthor(host, packet.envelope)
      return true
    }
    const packet = inbound.splice(chosen.index, 1)[0]!
    users[packet.user]!.participant.receive([packet.message])
    return true
  }
  function connect(user: number) {
    if (online.has(user)) return
    online.add(user)
    for (const message of log) inbound.push({ user, message })
  }
  function flushAll() {
    while (flushOne(() => 0)) {
      /* A finite queue, including broadcasts from submissions. */
    }
  }
  function settle() {
    for (let user = 0; user < size; user++) connect(user)
    flushAll()
    expect(log.every((message) => message.status === 'accepted')).toBe(true)
    expect(log).toHaveLength(host.hostSequence)
    expect(outbound).toHaveLength(0)
    expect(inbound).toHaveLength(0)
    for (const user of users) {
      expect(user.participant.text()).toBe(host.text())
      expect(user.participant.state()).toMatchObject({
        pending: [],
        blocked: [],
        hostSequence: host.hostSequence,
      })
      expect(liveIds(user.engine)).toEqual(liveIds(engine))
    }
    const fresh = new Participant({
      actor: 'fresh',
      document: 'test',
      epoch: '1',
      engine: createEngine(),
    })
    fresh.receive(log)
    expect(fresh.text()).toBe(host.text())
    return host.text()
  }
  function sync(selected: readonly number[]) {
    // A peer sync becomes submission to the host followed by its complete log prefix.
    for (let index = outbound.length - 1; index >= 0; index--) {
      if (!selected.includes(outbound[index]!.user)) continue
      submitAsAuthor(host, outbound.splice(index, 1)[0]!.envelope)
    }
    for (const user of selected) users[user]!.participant.receive(log)
    for (let index = inbound.length - 1; index >= 0; index--) {
      if (selected.includes(inbound[index]!.user)) inbound.splice(index, 1)
    }
    for (const user of selected) {
      expect(users[user]!.participant.text()).toBe(host.text())
      expect(users[user]!.participant.state().pending).toHaveLength(0)
    }
  }
  return {
    host,
    engine,
    users,
    online,
    log,
    edit,
    flushOne,
    flushAll,
    connect,
    disconnect: (user: number) => online.delete(user),
    settle,
    sync,
  }
}

export function randomSource(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}
