import { createHash } from 'node:crypto'
import { Host, Participant } from '../src/index'
import type { Envelope, HostMessage } from '../src/index'
import { editKey } from '../src/types'
import { Session } from '../../collaboration/src/session'
import {
  sameTip,
  type Checkpoint,
  type Confirmation,
  type DocumentEngine,
  type EditId,
  type Message,
} from '../../collaboration/src/protocol'
import { createEngine } from './engine-fixture'

const genesis = { depth: 0, hash: 'order-independence-genesis' }
const hash = (body: Omit<Confirmation<Envelope>, 'hash'>) =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex')
const hostMessage = (record: Confirmation<Envelope>): HostMessage =>
  record.outcome.kind === 'accepted'
    ? {
        document: 'test',
        epoch: '1',
        sequence: record.depth,
        status: 'accepted',
        envelope: record.edit,
      }
    : {
        document: 'test',
        epoch: '1',
        sequence: record.depth,
        status: 'rejected',
        id: record.id,
        reason: record.outcome.reason,
      }

/** Session history adapter using the selected real Host/Participant engines, not a text-sorting toy. */
export class SessionDocument implements DocumentEngine<Envelope> {
  readonly engine = createEngine()
  readonly participant: Participant
  private readonly base = this.engine.snapshot()
  private batching = false
  private host = this.createHost()
  private history: Confirmation<Envelope>[] = []
  private records = new Map<string, Confirmation<Envelope>>()
  private confirmations: HostMessage[] = []

  constructor(
    actor: string,
    private readonly batch = false,
  ) {
    this.participant = new Participant({ actor, document: 'test', epoch: '1', engine: this.engine })
  }
  private createHost() {
    return new Host({ document: 'test', epoch: '1', engine: createEngine(), unknownDeps: 'reject' })
  }
  checkpoint(): Checkpoint {
    const last = this.history.at(-1)
    return last ? { depth: last.depth, hash: last.hash } : genesis
  }
  outcome(id: EditId) {
    return this.records.get(editKey(id))?.outcome
  }
  sequence(edit: Envelope, rejection?: string): Confirmation<Envelope> {
    const prior = this.records.get(editKey(edit.id))
    if (prior) return prior
    const message = this.host.submit(edit, edit.id.actor, rejection)
    if (message.status === 'deferred')
      throw new TypeError('Session sequenced unresolved dependencies')
    const tip = this.checkpoint()
    const outcome =
      message.status === 'accepted'
        ? { kind: 'accepted' as const }
        : { kind: 'rejected' as const, reason: message.reason }
    const body = { depth: tip.depth + 1, predecessor: tip.hash, id: edit.id, edit, outcome }
    const record = { ...body, hash: hash(body) }
    this.append(record)
    return record
  }
  private append(record: Confirmation<Envelope>) {
    this.history.push(record)
    this.records.set(editKey(record.id), record)
    this.confirmations.push(hostMessage(record))
    if (!this.batch && !this.batching) this.settleProjection()
  }
  settleProjection() {
    if (!this.confirmations.length) return
    this.participant.receive(this.confirmations)
    this.confirmations = []
  }
  sequenceBatch(edits: readonly { readonly edit: Envelope; readonly rejection?: string }[]) {
    this.batching = true
    try {
      return edits.map(({ edit, rejection }) => this.sequence(edit, rejection))
    } finally {
      this.batching = false
      if (!this.batch) this.settleProjection()
    }
  }
  applyBatch(records: readonly Confirmation<Envelope>[]): boolean {
    this.batching = true
    try {
      return records.every((record) => this.apply(record))
    } finally {
      this.batching = false
      if (!this.batch) this.settleProjection()
    }
  }
  private valid(record: Confirmation<Envelope>, tip: Checkpoint) {
    const { hash: digest, ...body } = record
    return (
      record.depth === tip.depth + 1 &&
      record.predecessor === tip.hash &&
      digest === hash(body) &&
      editKey(record.id) === editKey(record.edit.id)
    )
  }
  apply(record: Confirmation<Envelope>): boolean {
    if (!this.valid(record, this.checkpoint()) || this.outcome(record.id)) return false
    const message = this.host.submit(
      record.edit,
      record.id.actor,
      record.outcome.kind === 'rejected' ? record.outcome.reason : undefined,
    )
    if (message.status !== record.outcome.kind) return false
    this.append(record)
    return true
  }
  exportHistory(from: Checkpoint) {
    const point = from.depth === 0 ? genesis : this.history[from.depth - 1]
    return point && sameTip(point, from) ? this.history.slice(from.depth) : undefined
  }
  verify(history: readonly Confirmation<Envelope>[], tip: Checkpoint): boolean {
    const host = this.createHost()
    let point = genesis
    for (const record of history) {
      if (!this.valid(record, point)) return false
      const message = host.submit(
        record.edit,
        record.id.actor,
        record.outcome.kind === 'rejected' ? record.outcome.reason : undefined,
      )
      if (message.status !== record.outcome.kind) return false
      point = record
    }
    return sameTip(point, tip)
  }
  install(history: readonly Confirmation<Envelope>[], recovered: readonly Envelope[] = []) {
    if (!this.verify(history, history.at(-1) ?? genesis))
      throw new TypeError('Invalid session history')
    this.host = this.createHost()
    this.history = [...history]
    this.records = new Map(history.map((record) => [editKey(record.id), record]))
    for (const record of history) this.host.submit(record.edit, record.id.actor)
    this.confirmations = []
    this.participant.install(this.base, history.map(hostMessage), recovered)
  }
  uniquePending(history: readonly Confirmation<Envelope>[]) {
    return history.filter((record) => !this.outcome(record.id)).map((record) => record.edit)
  }
}

export function sessionNetwork(documents: readonly DocumentEngine<Envelope>[], base = genesis) {
  const queue: { from: number; to: number; message: Message<Envelope> }[] = []
  const topology = new Set<string>()
  const replay: Envelope[] = []
  const confirmationSizes: number[] = []
  let commits = 0
  let now = 0
  const sessions = documents.map(
    (engine, index) =>
      new Session<Envelope>({
        peer: `actor${index}`,
        room: 'order-test',
        document: 'test',
        genesis: base,
        engine,
        pulseInterval: 10,
        suspicionTimeout: 40,
        dependencyTimeout: 400,
        historyChunkRecords: 32,
        replayWindowSize: 8192,
        send: (to, message) => {
          const target = Number(to.slice(5))
          if (!topology.has(`${index}:${target}`)) return
          if (message.type === 'CONFIRM') confirmationSizes.push(message.payload.records.length)
          if (message.type === 'RECONCILE_COMMIT') {
            replay.push(...message.payload.replay)
            commits++
          }
          queue.push({ from: index, to: target, message: structuredClone(message) })
        },
      }),
  )
  function flush() {
    let delivered = 0
    while (queue.length) {
      if (++delivered > 100_000) throw new TypeError('Session message drain did not settle')
      const packet = queue.shift()!
      if (topology.has(`${packet.from}:${packet.to}`)) sessions[packet.to]!.receive(packet.message)
    }
  }
  function advance(steps = 80) {
    for (let step = 0; step < steps; step++) {
      now += 10
      for (const session of sessions) session.tick(now)
      flush()
    }
  }
  function partition(groups: readonly (readonly number[])[]) {
    const next = new Set(
      groups.flatMap((group) =>
        group.flatMap((from) => group.filter((to) => to !== from).map((to) => `${from}:${to}`)),
      ),
    )
    for (let from = 0; from < sessions.length; from++) {
      for (let to = 0; to < sessions.length; to++) {
        const key = `${from}:${to}`
        if (topology.has(key) && !next.has(key)) sessions[from]!.disconnect(`actor${to}`)
      }
    }
    const added = [...next].filter((key) => !topology.has(key))
    topology.clear()
    for (const key of next) topology.add(key)
    for (const key of added) {
      const [from, to] = key.split(':').map(Number)
      sessions[from!]!.connect(`actor${to}`)
    }
    advance()
  }
  return { sessions, replay, confirmationSizes, flush, advance, partition, commits: () => commits }
}
