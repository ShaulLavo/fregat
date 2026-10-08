import assert from 'node:assert/strict'
import { Session } from '../src/session'
import { editKey, type Message } from '../src/protocol'
import { genesis, ToyEngine, type ToyEdit } from './engine'

type Node = {
  session: Session<ToyEdit>
  engine: ToyEngine
  alive: boolean
  incarnation: number
  sequence: number
  authored: ToyEdit[]
}
type Packet = {
  readonly from: number
  readonly to: number
  readonly sender: string
  readonly message: Message<ToyEdit>
}
export type Link = {
  readonly delay: number
  readonly jitter: number
  readonly drop: number
  readonly duplicate: number
}

export class Network {
  readonly nodes: Node[] = []
  readonly authored = new Map<string, ToyEdit>()
  readonly messages = new Map<string, number>()
  readonly links = new Map<string, Link>()
  private readonly packets = new Map<number, Packet[]>()
  private edges = new Set<string>()
  private clock = 0
  private readonly trace: string[] = []
  private randomState: number
  private groups: number[][]

  constructor(
    readonly seed: number,
    count: number,
  ) {
    this.randomState = seed
    this.groups = [Array.from({ length: count }, (_, index) => index)]
    for (let index = 0; index < count; index++) {
      const engine = new ToyEngine()
      this.nodes.push({
        session: this.session(index, 0, engine),
        engine,
        alive: true,
        incarnation: 0,
        sequence: 0,
        authored: [],
      })
    }
    for (let from = 0; from < count; from++) {
      for (let to = 0; to < count; to++)
        this.links.set(`${from}:${to}`, {
          delay: 1 + this.integer(3),
          jitter: 4 + this.integer(6),
          drop: this.random() * 0.12,
          duplicate: 0.08,
        })
    }
    this.reconnect()
  }

  random(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) | 0
    let value = Math.imul(this.randomState ^ (this.randomState >>> 15), 1 | this.randomState)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  integer(max: number): number {
    return Math.floor(this.random() * max)
  }
  author(index: number, reject = false): void {
    const node = this.nodes[index]!
    if (!node.alive) return
    const prior = node.authored.at(-1)
    const seq = ++node.sequence
    const edit: ToyEdit = {
      document: 'document',
      epoch: node.session.branch.authority.epoch,
      id: { actor: node.session.peer, seq },
      lamport: seq,
      deps: prior ? [prior.id] : [],
      change: { text: `${index}.${seq};`, reject },
    }
    node.authored.push(edit)
    this.authored.set(editKey(edit.id), edit)
    node.session.submit(edit)
  }
  type(count: number): void {
    for (let i = 0; i < count; i++) {
      this.author(this.integer(this.nodes.length), this.random() < 0.07)
      this.advance(1 + this.integer(3))
    }
  }
  partition(groups: number[][]): void {
    this.groups = groups
    this.reconnect()
  }
  heal(): void {
    this.partition([this.nodes.map((_, index) => index)])
  }
  crash(index: number): void {
    this.nodes[index]!.alive = false
    this.reconnect()
  }
  rejoin(index: number): void {
    const node = this.nodes[index]!
    const pending = [...node.session.pending.values()]
    node.incarnation++
    node.session = this.session(index, node.incarnation, node.engine)
    for (const edit of pending) node.session.submit(edit)
    node.alive = true
    this.reconnect()
  }
  stabilize(): void {
    const faults = new Map(this.links)
    for (const [key, link] of this.links) this.links.set(key, { ...link, drop: 0, duplicate: 0 })
    this.advance(240)
    this.invariants()
    for (const [key, link] of faults) this.links.set(key, link)
  }
  advance(steps: number): void {
    for (let step = 0; step < steps; step++) {
      this.clock++
      for (const node of this.nodes) if (node.alive) node.session.tick(this.clock * 10)
      const packets = this.packets.get(this.clock) ?? []
      this.packets.delete(this.clock)
      const reordered = packets
        .map((packet) => ({ packet, order: this.random() }))
        .sort((a, b) => a.order - b.order)
      for (const { packet } of reordered) {
        const from = this.nodes[packet.from]!
        const to = this.nodes[packet.to]!
        if (!from.alive || !to.alive || !this.edges.has(`${packet.from}:${packet.to}`)) continue
        // Old channels can drain after reconnect; the application must fence their authority.
        const before = `${to.session.status}/${to.session.branch.authority.epoch}`
        to.session.receive(packet.message)
        const after = `${to.session.status}/${to.session.branch.authority.epoch}`
        if (before !== after) {
          this.trace.push(
            `${this.clock}: ${packet.from}->${packet.to} ${packet.message.type} ${before}->${after}`,
          )
          if (this.trace.length > 40) this.trace.shift()
        }
      }
    }
  }
  invariants(): void {
    const components = this.groups
      .map((group) => group.filter((index) => this.nodes[index]!.alive))
      .filter((group) => group.length)
    for (const group of components) {
      const nodes = group.map((index) => this.nodes[index]!)
      const first = nodes[0]!
      const history = first.engine.exportHistory(genesis)!
      const context = `seed=${this.seed} clock=${this.clock} group=${group} states=${nodes.map((node) => `${node.session.peer}/${node.session.status}/${node.session.host}`).join(',')}`
      for (const node of nodes) {
        assert.deepEqual(
          node.engine.exportHistory(genesis),
          history,
          `Identical confirmed history: ${context}`,
        )
        assert.equal(node.engine.text, first.engine.text, `Identical materialization: ${context}`)
        assert.equal(
          new Set(history.map((record) => editKey(record.id))).size,
          history.length,
          `No duplicate application: ${context}`,
        )
        assert.equal(
          node.session.pending.size,
          0,
          `Every reachable edit settled: ${context} pending=${JSON.stringify([...node.session.pending.values()].map((edit) => ({ id: edit.id, missing: edit.deps.filter((id) => !node.engine.outcome(id)) })))}\n${this.trace.join('\n')}`,
        )
      }
      assert.equal(
        nodes.filter((node) => node.session.isHost).length,
        1,
        `One stabilized host: ${context}\n${this.trace.join('\n')}`,
      )
      for (const node of nodes)
        assert.equal(node.session.host, first.session.host, `One authority: ${context}`)
    }
    if (components.length !== 1 || this.nodes.some((node) => !node.alive)) return
    const history = this.nodes[0]!.engine.exportHistory(genesis)!
    const outcomes = new Map(history.map((record) => [editKey(record.id), record.outcome]))
    for (const key of this.authored.keys())
      assert.ok(outcomes.has(key), `No edit lost: seed=${this.seed} edit=${key}`)
  }
  private session(index: number, incarnation: number, engine: ToyEngine): Session<ToyEdit> {
    return new Session({
      peer: `peer-${index}-${incarnation}`,
      room: 'room',
      document: 'document',
      genesis,
      engine,
      pulseInterval: 30,
      suspicionTimeout: 300,
      dependencyTimeout: 900,
      historyChunkRecords: 5,
      send: (peer, message) => this.send(index, peer, message),
    })
  }
  private send(from: number, peer: string, message: Message<ToyEdit>): void {
    this.messages.set(message.type, (this.messages.get(message.type) ?? 0) + 1)
    const to = this.nodes.findIndex((node) => node.session.peer === peer)
    if (to < 0 || !this.edges.has(`${from}:${to}`)) return
    const link = this.links.get(`${from}:${to}`)!
    if (this.random() < link.drop) return
    const delay = link.delay + this.integer(link.jitter) + (this.random() < 0.01 ? 80 : 0)
    this.queue(this.clock + delay, { from, to, sender: message.sender, message })
    if (this.random() < link.duplicate)
      this.queue(this.clock + delay + 1 + this.integer(10), {
        from,
        to,
        sender: message.sender,
        message,
      })
  }
  private queue(time: number, packet: Packet): void {
    const packets = this.packets.get(time) ?? []
    packets.push(packet)
    this.packets.set(time, packets)
  }
  private reconnect(): void {
    const next = new Set<string>()
    for (const group of this.groups) {
      for (const from of group) {
        for (const to of group) {
          if (from === to || !this.nodes[from]!.alive || !this.nodes[to]!.alive) continue
          next.add(`${from}:${to}`)
        }
      }
    }
    for (const edge of this.edges) {
      if (next.has(edge)) continue
      const [from, to] = edge.split(':').map(Number)
      this.nodes[from!]!.session.disconnect(this.nodes[to!]!.session.peer)
    }
    const old = this.edges
    this.edges = next
    for (const edge of next) {
      if (old.has(edge)) continue
      const [from, to] = edge.split(':').map(Number)
      this.nodes[from!]!.session.connect(this.nodes[to!]!.session.peer)
    }
  }
}

export function runSeed(seed: number): void {
  const scenario = seed % 3
  const count = scenario === 1 ? 4 : 3 + (Math.floor(seed / 3) % 6)
  const network = new Network(seed, count)
  network.stabilize()
  network.type(8)
  if (scenario === 0) {
    const host = network.nodes.findIndex((node) => node.session.isHost)
    network.author(host)
    for (let index = 0; index < count; index++) network.author(index)
    network.crash(host)
    network.type(10)
    network.stabilize()
    network.rejoin(host)
    network.type(8)
  }
  if (scenario === 1) {
    network.partition([
      [0, 1],
      [2, 3],
    ])
    network.stabilize()
    network.type(12)
    network.advance(30)
    network.heal()
    network.type(8)
  }
  if (scenario === 2) {
    const groups = [[], [], []] as number[][]
    for (let index = 0; index < count; index++) groups[index % 3]!.push(index)
    network.partition(groups)
    network.stabilize()
    network.type(15)
    network.advance(30)
    // Two branches meet while the third keeps typing, then the third joins mid-replay.
    network.partition([[...groups[0]!, ...groups[1]!], groups[2]!])
    network.advance(10 + network.integer(25))
    network.type(8)
    network.heal()
    network.type(8)
  }
  network.stabilize()
}
