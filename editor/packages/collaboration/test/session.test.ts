import { describe, expect, test } from 'vitest'
import { Network, runSeed } from './network'
import { genesis, ToyEngine, type ToyEdit } from './engine'
import { compareBranches, type Message } from '../src/protocol'
import { Session } from '../src/session'

const runs = process.env.COLLABORATION_LONG_RUN === '1' ? 10_000 : 100

describe('transport-neutral session', () => {
  test('converges after host crashes, two pairs rejoin and concurrent three-way reconciliation', () => {
    for (let seed = 1; seed <= runs; seed++) runSeed(seed)
    console.log(
      `Session simulation: ${runs} seeded runs passed; host-crash, 2+2 and three-way partitions; 3–8 peers.`,
    )
  }, 600_000)

  test('delayed archived history and stale election requests remain fenced', () => {
    runSeed(5377)
    runSeed(3928)
  })

  test('clean handoff waits for the successor to possess the flushed tip', () => {
    const network = new Network(90001, 4)
    network.stabilize()
    network.type(12)
    network.stabilize()
    const host = network.nodes.findIndex((node) => node.session.isHost)
    const successor = network.nodes.length - 1
    const tip = network.nodes[host]!.engine.checkpoint()
    network.author(host)
    const pendingId = network.nodes[host]!.authored.at(-1)!.id
    network.nodes[host]!.session.leave(network.nodes[successor]!.session.peer)
    expect(network.nodes[host]!.session.status).toBe('handoff')
    network.advance(100)
    expect(network.nodes[host]!.session.status).toBe('left')
    expect(network.nodes[successor]!.engine.checkpoint().depth).toBe(tip.depth + 1)
    expect(network.nodes[successor]!.engine.outcome(pendingId)).toEqual({ kind: 'accepted' })
    expect(network.messages.get('HANDOFF')).toBeGreaterThanOrEqual(2)
    network.crash(host)
    network.stabilize()
    expect(network.nodes[successor]!.session.isHost).toBe(true)
  })

  test('handoff selects its successor across lossy links', () => {
    for (let seed = 90100; seed < 90200; seed++) {
      const network = new Network(seed, 4)
      network.stabilize()
      const host = network.nodes.findIndex((node) => node.session.isHost)
      const successor = 3
      network.author(host)
      network.nodes[host]!.session.leave(network.nodes[successor]!.session.peer)
      network.advance(150)
      expect(network.nodes[host]!.session.status, `seed=${seed}`).toBe('left')
      network.crash(host)
      network.stabilize()
      expect(network.nodes[successor]!.session.isHost, `seed=${seed}`).toBe(true)
    }
  })

  test('missing host pulses freeze confirmation and start an election', () => {
    const network = new Network(90003, 3)
    network.stabilize()
    const host = network.nodes.findIndex((node) => node.session.isHost)
    const offers = network.messages.get('ELECTION_OFFER') ?? 0
    for (const [key, link] of network.links) {
      if (key.startsWith(`${host}:`)) network.links.set(key, { ...link, drop: 1 })
    }
    network.advance(140)
    expect(network.messages.get('ELECTION_OFFER')!).toBeGreaterThan(offers)
    expect(network.nodes.some((node) => node.session.status !== 'stable')).toBe(true)
    network.stabilize()
  })

  test('rejected outcomes and their dependents remain deduplicated on retransmission', () => {
    const network = new Network(90002, 3)
    network.stabilize()
    network.author(2, true)
    network.author(2)
    network.stabilize()
    const edits = network.nodes[2]!.authored
    for (const node of network.nodes) for (const edit of edits) node.session.submit(edit)
    network.stabilize()
    const history = network.nodes[0]!.engine.exportHistory(genesis)!
    expect(history).toHaveLength(2)
    expect(history.map((record) => record.outcome.kind)).toEqual(['rejected', 'rejected'])
    expect(network.nodes[0]!.engine.text).toBe('')
  })

  test('an unavailable dependency becomes one explicit conflict with its original ID', () => {
    const network = new Network(23, 3)
    network.stabilize()
    const edit: ToyEdit = {
      document: 'document',
      epoch: 'test',
      id: { actor: 'offline', seq: 2 },
      lamport: 2,
      deps: [{ actor: 'offline', seq: 1 }],
      change: { text: 'blocked' },
    }
    network.nodes[1]!.session.submit(edit)
    network.stabilize()
    for (const node of network.nodes) node.session.submit(edit)
    network.stabilize()
    const history = network.nodes[0]!.engine.exportHistory(genesis)!
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toEqual(edit.id)
    expect(history[0]!.outcome).toEqual({ kind: 'rejected', reason: 'Dependency unavailable' })
    expect(network.nodes[0]!.engine.text).toBe('')
  })

  test('three branches choose the deepest verified history and archive the losers', () => {
    const network = new Network(90004, 3)
    network.stabilize()
    network.partition([[0], [1], [2]])
    network.stabilize()
    network.author(0)
    network.author(1)
    network.author(1)
    network.author(1)
    network.author(2)
    network.author(2)
    network.stabilize()
    network.heal()
    network.stabilize()
    expect(network.nodes[1]!.session.isHost).toBe(true)
    expect(network.nodes[0]!.session.archives.length).toBeGreaterThan(0)
    expect(network.nodes[2]!.session.archives.length).toBeGreaterThan(0)
    expect(network.nodes[0]!.engine.checkpoint().depth).toBe(6)
  })

  test('presence passes through once and room boundaries reject unrelated traffic', () => {
    const received: unknown[] = []
    const engine = new ToyEngine()
    const session = new Session<ToyEdit>({
      peer: 'a',
      room: 'room',
      document: 'document',
      genesis,
      engine,
      pulseInterval: 30,
      suspicionTimeout: 300,
      dependencyTimeout: 900,
      historyChunkRecords: 5,
      send: () => {},
      onPresence: (peer, payload) => received.push({ peer, payload }),
    })
    session.connect('b')
    const presence: Message<ToyEdit> = {
      version: 1,
      sender: 'b',
      messageId: 1,
      room: 'room',
      document: 'document',
      epoch: genesis.hash,
      type: 'PRESENCE',
      payload: { clock: 1, state: { caret: 4 } },
    }
    session.receive({ ...presence, room: 'another-room' })
    session.receive({ ...presence, document: 'another-document' })
    session.receive({ ...presence, sender: 'stranger' })
    expect(received).toEqual([])
    session.receive(presence)
    session.receive(presence)
    expect(received).toEqual([{ peer: 'b', payload: presence.payload }])
    expect(engine.checkpoint()).toEqual(genesis)
  })

  test('history selection ignores inflated terms and uses depth, host ID, then tip hash', () => {
    const branch = (depth: number, host: string, hash: string, term: number) => ({
      tip: { depth, hash },
      authority: { host, term, epoch: String(term) },
    })
    expect(
      [branch(2, 'a', 'z', 999), branch(3, 'b', 'z', 1)].sort(compareBranches)[0]!.tip.depth,
    ).toBe(3)
    expect(
      [branch(3, 'b', 'a', 999), branch(3, 'a', 'z', 1)].sort(compareBranches)[0]!.authority.host,
    ).toBe('a')
    expect(
      [branch(3, 'a', 'z', 999), branch(3, 'a', 'a', 1)].sort(compareBranches)[0]!.tip.hash,
    ).toBe('a')
  })

  test('a late transfer cannot install a commit from an obsolete round', () => {
    const source = new ToyEngine()
    const record = source.sequence({
      document: 'document',
      epoch: 'original',
      id: { actor: 'a', seq: 1 },
      lamport: 1,
      deps: [],
      change: { text: 'a' },
    })
    const engine = new ToyEngine()
    const session = new Session<ToyEdit>({
      peer: 'b',
      room: 'room',
      document: 'document',
      genesis,
      engine,
      pulseInterval: 30,
      suspicionTimeout: 300,
      dependencyTimeout: 900,
      historyChunkRecords: 5,
      send: () => {},
    })
    session.connect('a')
    const round = { coordinator: 'a', serial: 1, roster: ['a', 'b'] }
    const branch = {
      tip: source.checkpoint(),
      authority: { host: 'a', term: 1, epoch: 'original' },
    }
    const envelope = {
      version: 1 as const,
      room: 'room',
      document: 'document',
      sender: 'a',
      epoch: 'original',
    }
    session.receive({
      ...envelope,
      messageId: 1,
      type: 'ELECTION_OFFER',
      payload: { round, branch, term: 1 },
    })
    session.receive({
      ...envelope,
      messageId: 2,
      type: 'RECONCILE_COMMIT',
      payload: {
        round,
        base: branch,
        authority: { host: 'a', term: 2, epoch: 'round-one' },
        replay: [],
        offers: [
          { peer: 'a', branch },
          { peer: 'b', branch: session.branch },
        ],
      },
    })
    session.receive({
      ...envelope,
      messageId: 3,
      type: 'ELECTION_OFFER',
      payload: {
        round: { ...round, serial: 2 },
        branch,
        term: 2,
      },
    })
    session.receive({
      ...envelope,
      messageId: 4,
      type: 'HISTORY_CHUNK',
      payload: {
        tip: source.checkpoint(),
        from: genesis,
        index: 0,
        count: 1,
        records: [record],
      },
    })
    expect(engine.checkpoint()).toEqual(genesis)
    expect(session.status).toBe('collecting')
  })

  test('the engine verifies the hash chain and refuses duplicate or reordered history', () => {
    const engine = new ToyEngine()
    const edit: ToyEdit = {
      document: 'document',
      epoch: 'test',
      id: { actor: 'a', seq: 1 },
      lamport: 1,
      deps: [],
      change: { text: 'a' },
    }
    const record = engine.sequence(edit)
    expect(engine.apply(record)).toBe(false)
    expect(engine.verify([{ ...record, predecessor: 'wrong' }], engine.checkpoint())).toBe(false)
    expect(engine.verify([record, record], engine.checkpoint())).toBe(false)
  })
})
