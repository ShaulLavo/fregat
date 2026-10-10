import { expect, test } from 'vitest'
import { Session } from '../src/session'
import { type Message } from '../src/protocol'
import { genesis, ToyEngine, type ToyEdit } from './engine'
import { Network } from './network'

const largeHistoryRecords = process.env.COLLABORATION_LONG_RUN === '1' ? 8193 : 33

function transfer(
  records: number,
  window: number,
  reversed: boolean,
  dropOnce: readonly number[] = [],
  prefixRecords = 0,
) {
  const source = new ToyEngine()
  for (let seq = 1; seq <= records; seq++)
    source.sequence({
      document: 'document',
      epoch: 'old',
      id: { actor: 'a', seq },
      lamport: seq,
      deps: [],
      change: { text: 'x' },
    })
  const follower = new ToyEngine()
  follower.install(source.exportHistory(genesis)!.slice(0, prefixRecords))
  const engines = [source, follower]
  const queue: { to: string; message: Message<ToyEdit> }[] = []
  let staleChunks = 0
  const missing = new Set(dropOnce)
  const received = new Set<number>()
  let largestResponse = 0
  let transferredRecords = 0
  const sessions = engines.map(
    (engine, index) =>
      new Session<ToyEdit>({
        peer: index ? 'b' : 'a',
        room: 'room',
        document: 'document',
        genesis,
        engine,
        pulseInterval: 30,
        suspicionTimeout: 300,
        dependencyTimeout: 900,
        historyChunkRecords: 1,
        replayWindowSize: window,
        send: (to, message) => {
          if (message.type === 'HISTORY_REQUEST' && message.sender === 'b')
            expect(received.has(message.payload.index)).toBe(false)
          queue.push({ to, message })
        },
      }),
  )
  sessions[0]!.tick(0)
  sessions[0]!.connect('b')
  sessions[1]!.connect('a')
  for (let tick = 1; tick <= 80; tick++) {
    for (const session of sessions) session.tick(tick * 30)
    let batches = 0
    while (queue.length) {
      expect(++batches).toBeLessThan(100_000)
      const batch = queue.splice(0)
      const chunks = batch.filter((packet) => packet.message.type === 'HISTORY_CHUNK')
      if (reversed) chunks.reverse()
      const other = batch.filter((packet) => packet.message.type !== 'HISTORY_CHUNK')
      for (const { to, message } of other.concat(chunks)) {
        if (message.type === 'HISTORY_CHUNK' && missing.delete(message.payload.index)) continue
        const before = queue.length
        const accepted = sessions[to === 'a' ? 0 : 1]!.receive(message)
        if (message.type === 'HISTORY_REQUEST')
          largestResponse = Math.max(
            largestResponse,
            queue.slice(before).filter((packet) => packet.message.type === 'HISTORY_CHUNK').length,
          )
        if (message.type !== 'HISTORY_CHUNK') continue
        if (!accepted) staleChunks++
        if (!accepted || to !== 'b' || received.has(message.payload.index)) continue
        received.add(message.payload.index)
        transferredRecords += message.payload.records.length
      }
    }
  }
  return {
    records,
    window,
    reversed,
    depths: engines.map((engine) => engine.checkpoint().depth),
    statuses: sessions.map((session) => session.status),
    hosts: sessions.map((session) => session.host),
    staleChunks,
    largestResponse,
    transferredRecords,
    lostChunks: dropOnce.length - missing.size,
  }
}

test.each([
  [12, 8, false],
  [12, 8192, true],
  [12, 8, true],
  [largeHistoryRecords, 8192, true],
] as const)(
  'history of %i records converges with window %i and reversed delivery %s',
  (records, window, reversed) => {
    const result = transfer(records, window, reversed)
    console.log(`History transfer: ${JSON.stringify(result)}`)
    expect(result.depths).toEqual([records, records])
    expect(result.statuses).toEqual(['stable', 'stable'])
    expect(result.hosts).toEqual(['a', 'a'])
    expect(result.largestResponse).toBe(1)
  },
  120_000,
)

test('selective retries recover lost prefix, middle and final chunks under reversed delivery', () => {
  const result = transfer(33, 8, true, [0, 16, 32])
  console.log(`Lossy history transfer: ${JSON.stringify(result)}`)
  expect(result.depths).toEqual([33, 33])
  expect(result.statuses).toEqual(['stable', 'stable'])
  expect(result.hosts).toEqual(['a', 'a'])
  expect(result.largestResponse).toBe(1)
  expect(result.lostChunks).toBe(3)
})

test.each([17, 32])('history recovery keeps a verified prefix of %i records', (prefix) => {
  const result = transfer(33, 8, true, [], prefix)
  expect(result.depths).toEqual([33, 33])
  expect(result.statuses).toEqual(['stable', 'stable'])
  expect(result.hosts).toEqual(['a', 'a'])
  expect(result.transferredRecords).toBe(33 - prefix)
  expect(result.largestResponse).toBe(1)
})

test.each([
  [8, 33, 17],
  [8192, largeHistoryRecords, 3],
] as const)(
  'large transfers, branch replay and handoff progress under reversed delivery with window %i',
  (window, records, branchRecords) => {
    const network = new Network(990, 3, window, 1)
    network.partition([[0], [1], [2]])
    network.stabilize()
    for (const [index, count] of [
      [0, records],
      [1, branchRecords],
    ] as const) {
      const node = network.nodes[index]!
      for (let seq = 0; seq < count; seq++) {
        network.author(index)
        node.engine.sequence(node.authored.at(-1)!)
      }
      network.rejoin(index)
    }
    network.stabilize()
    for (const key of network.links.keys())
      network.links.set(key, {
        delay: 1,
        jitter: 1,
        drop: 0,
        duplicate: 0,
        tailDelay: 0,
        reverse: true,
      })
    network.heal()
    network.advance(4 * (records + branchRecords) + 600)
    network.invariants()
    expect(network.nodes.map((node) => node.engine.checkpoint().depth)).toEqual([
      records + branchRecords,
      records + branchRecords,
      records + branchRecords,
    ])
    const host = network.nodes.findIndex((node) => node.session.isHost)
    const successor = (host + 1) % network.nodes.length
    const handoffPending = Math.max(9, branchRecords)
    for (let index = 0; index < handoffPending; index++) network.author(host)
    network.nodes[host]!.session.leave(network.nodes[successor]!.session.peer)
    network.advance(4 * (records + branchRecords + handoffPending) + 600)
    expect(network.nodes[host]!.session.status).toBe('left')
    network.stabilize()
    expect(network.nodes[successor]!.session.isHost).toBe(true)
    console.log(
      `Large transfer simulation: window=${window}; historyRecords=${records}; branchReplayRecords=${branchRecords}; handoffPending=${handoffPending}; replay=${JSON.stringify(network.replay)}; staleByType=${JSON.stringify(network.staleByType)}`,
    )
  },
  120_000,
)

test.each(['retire', 'leave'] as const)(
  'a permanent %s releases an unfinished history download',
  (departure) => {
    const network = new Network(992, 2, 8, 1)
    network.stabilize()
    const host = network.nodes.find((node) => node.session.isHost)!
    const follower = network.nodes.find((node) => !node.session.isHost)!
    for (const [key, link] of network.links)
      network.links.set(key, { ...link, dropTypes: ['CONFIRM', 'HISTORY_CHUNK'] })
    network.author(network.nodes.indexOf(host))
    network.advance(30)
    const transfers = Reflect.get(follower.session, 'transfers') as Map<string, object>
    expect(transfers.has(host.session.peer)).toBe(true)
    if (departure === 'retire') follower.session.retire(host.session.peer)
    if (departure === 'leave')
      expect(
        follower.session.receive({
          version: 1,
          room: 'room',
          document: 'document',
          sender: host.session.peer,
          messageId: Number.MAX_SAFE_INTEGER,
          epoch: host.session.branch.authority.epoch,
          type: 'LEAVE',
          payload: { successor: null },
        }),
      ).toBe(true)
    expect(transfers.size).toBe(0)
  },
)
