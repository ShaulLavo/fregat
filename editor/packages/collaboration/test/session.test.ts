import { describe, expect, test } from 'vitest'
import { Network, runSeed } from './network'
import { genesis, ToyEngine, type ToyEdit } from './engine'
import { compareBranches, type Message } from '../src/protocol'
import { Session } from '../src/session'

const longRun = process.env.COLLABORATION_LONG_RUN === '1'
const seeds = longRun
  ? Array.from({ length: 10_000 }, (_, index) => index + 1)
  : [1, 2, 4, 7, 8, 9, 12, 15, 17]
const handoffRuns = longRun ? 100 : 18

describe('transport-neutral session', () => {
  test.each([8, 8192])(
    'converges after host crashes, two pairs rejoin and concurrent three-way reconciliation with a %i-ID replay window',
    (window) => {
      const hits: Network['hits'] = {
        hostKill: 0,
        pairs: 0,
        threeWay: 0,
        crashRejoin: 0,
        partialHeal: 0,
        oldGeneration: 0,
        reconnectReorder: 0,
      }
      const replay: Network['replay'] = {
        uniqueDelivery: 0,
        duplicateDrop: 0,
        staleDrop: 0,
        maxReorderDistance: 0,
      }
      const staleByType: Network['staleByType'] = {}
      for (const seed of seeds) {
        const result = runSeed(seed, window)
        for (const key of Object.keys(hits) as (keyof typeof hits)[]) hits[key] += result[key]
        for (const key of ['uniqueDelivery', 'duplicateDrop', 'staleDrop'] as const)
          replay[key] += result[key]
        replay.maxReorderDistance = Math.max(replay.maxReorderDistance, result.maxReorderDistance)
        for (const [type, count] of Object.entries(result.staleByType)) {
          const key = type as Message['type']
          staleByType[key] = (staleByType[key] ?? 0) + count
        }
      }
      for (const count of Object.values(hits)) expect(count).toBeGreaterThan(0)
      expect(replay.duplicateDrop).toBeGreaterThan(0)
      if (window === 8) expect(replay.staleDrop).toBeGreaterThan(0)
      else expect(replay.staleDrop).toBe(0)
      console.log(
        `Session simulation: ${seeds.length} seeded runs passed; 3–8 peers; window=${window}; hits=${JSON.stringify(hits)}; replay=${JSON.stringify(replay)}; staleByType=${JSON.stringify(staleByType)}`,
      )
    },
    600_000,
  )

  test('history recovery progresses while an eight-peer host replies to concurrent downloads', () => {
    runSeed(107, 8)
  })

  test('stable history recovery installs verified prefixes before the final chunk arrives', () => {
    const network = new Network(994, 2, 8, 1)
    network.stabilize()
    const host = network.nodes.findIndex((node) => node.session.isHost)
    const follower = network.nodes[1 - host]!
    for (const key of network.links.keys())
      network.links.set(key, { delay: 1, jitter: 1, drop: 0, duplicate: 0, dropTypes: ['CONFIRM'] })
    for (let index = 0; index < 17; index++) network.author(host)
    let partial = 0
    for (let step = 0; step < 200; step++) {
      network.advance(1)
      partial = follower.engine.checkpoint().depth
      if (partial > 0) break
    }
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(17)
    const transfers = Reflect.get(follower.session, 'transfers') as Map<string, object>
    expect(transfers.has(network.nodes[host]!.session.peer)).toBe(true)
    network.stabilize()
    expect(follower.engine.checkpoint().depth).toBe(17)
  })

  test('a growing host tip keeps each selective download on its current target', () => {
    const network = new Network(995, 2, 8, 1)
    network.stabilize()
    const host = network.nodes.findIndex((node) => node.session.isHost)
    const follower = network.nodes[1 - host]!
    for (const key of network.links.keys())
      network.links.set(key, {
        delay: 10,
        jitter: 1,
        drop: 0,
        duplicate: 0,
        tailDelay: 0,
        dropTypes: ['CONFIRM'],
      })
    for (let index = 0; index < 300; index++) {
      network.author(host)
      network.advance(3)
    }
    expect(follower.engine.checkpoint().depth).toBeGreaterThan(16)
    network.stabilize()
    expect(follower.engine.checkpoint().depth).toBe(300)
  })

  test('delayed archived history and stale election requests remain fenced', () => {
    runSeed(5377)
    runSeed(3928)
    runSeed(1419)
  })

  test('clean handoff waits for the successor to possess the flushed tip', () => {
    const network = new Network(90001, 4)
    network.stabilize()
    for (let index = 0; index < 12; index++) {
      network.author(index % network.nodes.length)
      network.advance(3)
    }
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

  test.each([8, 8192])(
    'handoff selects its successor across lossy links with window %i',
    (window) => {
      let staleHandoffs = 0
      for (let seed = 90100; seed < 90100 + handoffRuns; seed++) {
        const network = new Network(seed, 4, window)
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
        staleHandoffs += network.staleByType.HANDOFF ?? 0
      }
      if (window === 8) expect(staleHandoffs).toBeGreaterThan(0)
      console.log(
        `Handoff simulation: ${handoffRuns} seeded runs passed; window=${window}; staleHandoffs=${staleHandoffs}`,
      )
    },
  )

  test('the successor renews authority while follower rosters are delayed after departure', () => {
    const network = new Network(993, 4, 8)
    network.stabilize()
    const host = network.nodes.findIndex((node) => node.session.isHost)
    const successor = 3
    for (let from = 0; from < network.nodes.length; from++) {
      if (from === host || from === successor) continue
      network.links.set(`${from}:${successor}`, {
        delay: 60,
        jitter: 1,
        drop: 0,
        duplicate: 0,
        tailDelay: 0,
      })
    }
    network.author(host)
    network.nodes[host]!.session.leave(network.nodes[successor]!.session.peer)
    network.advance(150)
    expect(network.nodes[host]!.session.status).toBe('left')
    network.stabilize()
    expect(network.nodes[successor]!.session.isHost).toBe(true)
  })

  test('submission retries rotate through bounded batches while history recovery stays reachable', () => {
    const network = new Network(90100, 4, 8)
    network.stabilize()
    const host = network.nodes.findIndex((node) => node.session.isHost)
    const sender = (host + 1) % network.nodes.length
    const key = `${sender}:${host}`
    const link = network.links.get(key)!
    network.links.set(key, { ...link, drop: 1 })
    for (let index = 0; index < 33; index++) network.author(sender)
    const submitted = network.messages.get('SUBMIT') ?? 0
    network.advance(3)
    expect((network.messages.get('SUBMIT') ?? 0) - submitted).toBe(2)
    network.links.set(key, link)
    network.stabilize()
  })

  test('host pulses activate installed followers when every host claim is lost', () => {
    const network = new Network(991, 4, 8)
    for (const [key, link] of network.links)
      network.links.set(key, { ...link, dropTypes: ['HOST_CLAIM'] })
    network.stabilize()
    network.type(12)
    network.stabilize()
    expect(network.messages.get('HOST_CLAIM')).toBeGreaterThan(0)
    expect(network.messages.get('HOST_PULSE')).toBeGreaterThan(0)
  })

  test('completed handoff announcements preserve pulses without acknowledging a departed host', () => {
    const network = new Network(90100, 4, 8)
    network.stabilize()
    network.author(0)
    network.nodes[0]!.session.leave(network.nodes[3]!.session.peer)
    network.advance(60)
    expect(network.nodes[0]!.session.status).toBe('left')
    const acknowledgements = network.messages.get('HAVE')
    network.advance(30)
    expect(network.messages.get('HAVE')).toBe(acknowledgements)
    network.advance(60)
    network.invariants()
    expect(network.nodes[3]!.session.isHost).toBe(true)
  })

  test('handoff transfers edits authored during prepare and committed acknowledgement windows', () => {
    const network = new Network(90001, 4)
    network.stabilize()
    network.nodes[0]!.session.leave(network.nodes[3]!.session.peer)
    network.author(0)
    for (let step = 0; step < 100 && !network.handoffCommits.has(0); step++) network.advance(1)
    expect(network.handoffCommits.has(0)).toBe(true)
    expect(network.nodes[0]!.session.status).toBe('handoff')
    network.author(0)
    network.advance(200)
    expect(network.nodes[0]!.session.status).toBe('left')
    for (const edit of network.nodes[0]!.authored)
      for (const node of network.nodes.slice(1))
        expect(node.engine.outcome(edit.id)).toEqual({ kind: 'accepted' })
    expect(network.nodes[0]!.session.pending.size).toBe(0)
    network.stabilize()
    expect(() => network.nodes[0]!.session.submit(network.nodes[0]!.authored[0]!)).toThrow(
      'The session has left the room',
    )
    network.crash(0)
    network.stabilize()
  })

  test('handoff installation settles follower work already confirmed in the base', () => {
    const network = new Network(90001, 4)
    network.stabilize()
    const links = new Map(network.links)
    for (const key of network.links.keys())
      if (key.endsWith(':1'))
        network.links.set(key, { delay: 150, jitter: 1, drop: 0, duplicate: 0 })
    network.author(1)
    network.advance(25)
    const edit = network.nodes[1]!.authored[0]!
    expect(network.nodes[0]!.engine.outcome(edit.id)).toEqual({ kind: 'accepted' })
    expect(network.nodes[1]!.session.pending.size).toBe(1)
    for (const [key, link] of links) network.links.set(key, link)
    network.nodes[0]!.session.leave(network.nodes[3]!.session.peer)
    network.advance(200)
    expect(network.nodes[0]!.session.status).toBe('left')
    expect(network.nodes[1]!.engine.outcome(edit.id)).toEqual({ kind: 'accepted' })
    expect(network.nodes[1]!.session.pending.size).toBe(0)
    network.crash(0)
    network.stabilize()
  })

  test('an asymmetric bridge freezes both incumbent hosts until full-mesh discovery', () => {
    const network = new Network(90004, 4)
    network.stabilize()
    network.partition([[0], [1], [2], [3]])
    network.stabilize()
    network.author(1)
    network.author(1)
    network.author(3)
    network.author(3)
    network.author(3)
    network.stabilize()
    network.partition([
      [0, 1],
      [2, 3],
    ])
    network.stabilize()
    expect(network.nodes[1]!.session.isHost).toBe(true)
    expect(network.nodes[3]!.session.isHost).toBe(true)
    network.edge(0, 2, true)
    network.edge(2, 0, true)
    network.advance(240)
    expect(network.components()).toHaveLength(1)
    network.safety()
    const tips = network.nodes.map((node) => node.engine.checkpoint())
    network.author(1)
    network.author(3)
    network.advance(30)
    expect(network.nodes.map((node) => node.engine.checkpoint())).toEqual(tips)
    network.heal()
    network.stabilize()
  })

  test('a non-coordinator host completes departure after a delayed prepare', () => {
    const network = new Network(90006, 4)
    network.stabilize()
    network.partition([[0], [1], [2], [3]])
    network.stabilize()
    network.author(3)
    network.author(3)
    network.stabilize()
    network.heal()
    network.stabilize()
    expect(network.nodes[3]!.session.isHost).toBe(true)
    const link = network.links.get('3:2')!
    network.links.set('3:2', { ...link, drop: 1 })
    network.nodes[3]!.session.leave(network.nodes[2]!.session.peer)
    network.advance(45)
    network.links.set('3:2', link)
    network.advance(240)
    expect(network.nodes[3]!.session.status).toBe('left')
    network.crash(3)
    network.stabilize()
    expect(network.nodes[2]!.session.isHost).toBe(true)
  })

  test('lossy non-coordinator handoffs retain typing in both transfer stages', () => {
    for (let seed = 90200; seed < 90200 + handoffRuns; seed++) {
      const network = new Network(seed, 4)
      network.stabilize()
      network.partition([[0], [1], [2], [3]])
      network.stabilize()
      network.author(3)
      network.author(3)
      network.stabilize()
      network.heal()
      network.stabilize()
      expect(network.nodes[3]!.session.isHost, `seed=${seed}`).toBe(true)
      const link = network.links.get('3:2')!
      network.links.set('3:2', { ...link, drop: 1 })
      network.nodes[3]!.session.leave(network.nodes[2]!.session.peer)
      network.author(3)
      for (let step = 0; step < 100 && !network.handoffCommits.has(3); step++) network.advance(1)
      expect(network.handoffCommits.has(3), `seed=${seed}`).toBe(true)
      expect(network.nodes[3]!.session.status, `seed=${seed}`).toBe('handoff')
      network.author(3)
      network.advance(45)
      network.links.set('3:2', link)
      network.advance(200)
      expect(network.nodes[3]!.session.status, `seed=${seed}`).toBe('left')
      network.crash(3)
      network.stabilize()
      expect(network.nodes[2]!.session.isHost, `seed=${seed}`).toBe(true)
    }
    console.log(`Non-coordinator handoffs: ${handoffRuns} seeded runs passed; both transfer stages`)
  })

  test('departure intent survives an election that replaces the interrupted handoff', () => {
    const network = new Network(90006, 4)
    network.stabilize()
    network.partition([[0], [1], [2], [3]])
    network.stabilize()
    network.author(3)
    network.author(3)
    network.stabilize()
    network.heal()
    network.stabilize()
    const links = new Map(network.links)
    for (const [key, link] of network.links)
      if (key.startsWith('3:')) network.links.set(key, { ...link, drop: 1 })
    network.nodes[3]!.session.leave(network.nodes[2]!.session.peer)
    network.author(3)
    network.advance(45)
    expect(network.nodes.some((node) => node.session.status === 'collecting')).toBe(true)
    for (const [key, link] of links) network.links.set(key, link)
    network.advance(240)
    expect(network.nodes[3]!.session.status).toBe('left')
    expect(network.nodes[3]!.session.pending.size).toBe(0)
    network.crash(3)
    network.stabilize()
  })

  test('a re-elected departing host transfers its final tip when the requested successor disconnects', () => {
    const network = new Network(90006, 4)
    network.stabilize()
    network.partition([[0], [1], [2], [3]])
    network.stabilize()
    network.author(3)
    network.author(3)
    network.stabilize()
    network.heal()
    network.stabilize()
    const links = new Map(network.links)
    for (const key of network.links.keys())
      if (key.startsWith('3:')) network.links.set(key, { ...network.links.get(key)!, drop: 1 })
    network.author(3)
    network.advance(3)
    expect(network.nodes[3]!.engine.checkpoint().depth).toBe(3)
    network.nodes[3]!.session.leave(network.nodes[2]!.session.peer)
    network.author(3)
    const edit = network.nodes[3]!.authored.at(-1)!
    network.crash(2)
    const departing = network.nodes[3]!.session
    const successor = network.nodes[2]!.session.peer
    for (let step = 0; step < 200 && departing.members.has(successor); step++) network.advance(1)
    expect(departing.members.has(successor)).toBe(false)
    for (const [key, link] of links) network.links.set(key, link)
    for (let step = 0; step < 200 && !departing.isHost; step++) network.advance(1)
    expect(network.nodes[3]!.session.isHost).toBe(true)
    for (const [key, link] of network.links)
      if (key.startsWith('3:')) network.links.set(key, { ...link, drop: 1 })
    network.advance(3)
    expect(network.nodes[3]!.session.status).toBe('handoff')
    for (const [key, link] of links) network.links.set(key, link)
    network.advance(240)
    expect(network.nodes[3]!.session.status).toBe('left')
    network.crash(3)
    network.rejoin(2)
    network.stabilize()
    for (const node of network.nodes.slice(0, 3))
      expect(node.engine.outcome(edit.id)).toEqual({ kind: 'accepted' })
  })

  test('a departing singleton host retains its document until a successor connects', () => {
    const network = new Network(90241, 3)
    network.stabilize()
    network.nodes[0]!.session.leave(network.nodes[2]!.session.peer)
    network.author(0)
    const edit = network.nodes[0]!.authored[0]!
    network.crash(1)
    network.crash(2)
    network.advance(90)
    expect(network.nodes[0]!.session.status).toBe('stable')
    expect(network.nodes[0]!.session.isHost).toBe(true)
    expect(network.nodes[0]!.engine.outcome(edit.id)).toEqual({ kind: 'accepted' })
    network.rejoin(1)
    network.advance(240)
    expect(network.nodes[0]!.session.status).toBe('left')
    expect(network.nodes[1]!.engine.outcome(edit.id)).toEqual({ kind: 'accepted' })
    network.rejoin(2)
    network.stabilize()
  })

  test('committed handoff departure survives a membership-triggered election', () => {
    const network = new Network(90240, 5)
    network.stabilize()
    network.partition([[0, 1, 2, 3], [4]])
    network.stabilize()
    network.author(0)
    const edit = network.nodes[0]!.authored[0]!
    network.nodes[0]!.session.leave(network.nodes[3]!.session.peer)
    for (let step = 0; step < 100 && !network.handoffCommits.has(0); step++) network.advance(1)
    expect(network.handoffCommits.has(0)).toBe(true)
    const links = new Map(network.links)
    for (const from of [1, 2]) {
      const key = `${from}:0`
      network.links.set(key, { ...network.links.get(key)!, drop: 1 })
    }
    network.advance(40)
    expect(network.nodes[0]!.session.status).toBe('handoff')
    for (const [key, link] of links) network.links.set(key, link)
    network.heal()
    network.advance(240)
    expect(network.nodes[0]!.session.status).toBe('left')
    network.stabilize()
    for (const node of network.nodes.slice(1))
      expect(node.engine.outcome(edit.id)).toEqual({ kind: 'accepted' })
  })

  test('short reconnects deliver old-generation traffic after new-generation traffic', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const network = new Network(seed, 4)
      network.stabilize()
      network.reconnectTraffic()
      expect(network.hits.oldGeneration).toBeGreaterThan(0)
      expect(network.hits.reconnectReorder).toBeGreaterThan(0)
      network.stabilize()
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
