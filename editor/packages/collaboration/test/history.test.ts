import { expect, test } from 'vitest'
import { Session } from '../src/session'
import { type Message } from '../src/protocol'
import { genesis, ToyEngine, type ToyEdit } from './engine'

function transfer(records: number, window: number, reversed: boolean) {
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
  const engines = [source, new ToyEngine()]
  const queue: { to: string; message: Message<ToyEdit> }[] = []
  let staleChunks = 0
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
        send: (to, message) => queue.push({ to, message }),
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
      for (const { to, message } of [...other, ...chunks]) {
        const accepted = sessions[to === 'a' ? 0 : 1]!.receive(message)
        if (!accepted && message.type === 'HISTORY_CHUNK') staleChunks++
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
  }
}

test.each([
  [12, 8, false],
  [12, 8192, true],
  [12, 8, true],
  [8193, 8192, true],
] as const)(
  'history of %i records converges with window %i and reversed delivery %s',
  (records, window, reversed) => {
    const result = transfer(records, window, reversed)
    console.log(`History transfer: ${JSON.stringify(result)}`)
    expect(result.depths).toEqual([records, records])
    expect(result.statuses).toEqual(['stable', 'stable'])
    expect(result.hosts).toEqual(['a', 'a'])
  },
  120_000,
)
