import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  Host,
  Participant,
  TextbufferEngine,
  type Envelope,
  type HostMessage,
} from '@singapore-editor/collab'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import {
  editKey,
  sameTip,
  type Checkpoint,
  type Confirmation,
  type DocumentEngine,
  type EditId,
  type Outcome,
} from './protocol'

function digest(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonical(value))))
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function hostMessage(record: Confirmation<Envelope>): HostMessage {
  const common = {
    document: record.edit.document,
    epoch: record.edit.epoch,
    sequence: record.depth,
  }
  return record.outcome.kind === 'accepted'
    ? { ...common, status: 'accepted', envelope: record.edit }
    : { ...common, status: 'rejected', id: record.id, reason: record.outcome.reason }
}

export interface CollaborationDocumentOptions {
  readonly peer: string
  readonly document: string
  readonly epoch: string
  readonly text: string
}

/** Confirmed ordering and optimistic text have independent engines and snapshot ownership. */
export class CollaborationDocument implements DocumentEngine<Envelope> {
  readonly engine: TextbufferEngine
  readonly participant: Participant<ReturnType<TextbufferEngine['snapshot']>>
  readonly genesis: Checkpoint
  private readonly base: ReturnType<TextbufferEngine['snapshot']>
  private hostEngine: TextbufferEngine
  private host: Host<ReturnType<TextbufferEngine['snapshot']>>
  private history: Confirmation<Envelope>[] = []
  private readonly records = new Map<string, Confirmation<Envelope>>()

  constructor(private readonly options: CollaborationDocumentOptions) {
    const buffer = createPieceTableSnapshot(options.text, {
      charIds: { bunch: `${options.epoch}:bootstrap`, counter: 0 },
    })
    this.engine = new TextbufferEngine(buffer)
    this.base = this.engine.snapshot()
    this.participant = new Participant({
      actor: options.peer,
      document: options.document,
      epoch: options.epoch,
      engine: this.engine,
    })
    this.hostEngine = new TextbufferEngine(buffer)
    this.host = this.createHost()
    this.genesis = { depth: 0, hash: digest([options.document, options.epoch, this.engine.text()]) }
  }

  private createHost() {
    return new Host({
      document: this.options.document,
      epoch: this.options.epoch,
      engine: this.hostEngine,
      unknownDeps: 'reject',
    })
  }

  checkpoint(): Checkpoint {
    const last = this.history.at(-1)
    return last ? { depth: last.depth, hash: last.hash } : this.genesis
  }

  outcome(id: EditId): Outcome | undefined {
    return this.records.get(editKey(id))?.outcome
  }

  sequence(edit: Envelope, rejection?: string): Confirmation<Envelope> {
    const previous = this.records.get(editKey(edit.id))
    if (previous) return previous
    const message = this.host.submit(edit, edit.id.actor, rejection)
    if (message.status === 'deferred')
      throw new TypeError('The session sequenced an unresolved edit')
    const tip = this.checkpoint()
    const outcome: Outcome =
      message.status === 'accepted'
        ? { kind: 'accepted' }
        : { kind: 'rejected', reason: message.reason }
    const body = { depth: tip.depth + 1, predecessor: tip.hash, id: edit.id, edit, outcome }
    const record = { ...body, hash: digest(body) }
    this.append(record)
    this.participant.receive([message])
    return record
  }

  apply(record: Confirmation<Envelope>): boolean {
    if (!this.validNext(record, this.checkpoint(), this.records)) return false
    const result = this.host.submit(
      record.edit,
      record.id.actor,
      record.outcome.kind === 'rejected' ? record.outcome.reason : undefined,
    )
    if (result.status === 'deferred' || result.status !== hostMessage(record).status) {
      this.restoreHost()
      return false
    }
    this.append(record)
    this.participant.receive([hostMessage(record)])
    return true
  }

  private append(record: Confirmation<Envelope>): void {
    // Keep the verified wire history independent of caller-owned message objects.
    const owned = freezeRecord(structuredClone(record))
    this.history.push(owned)
    this.records.set(editKey(owned.id), owned)
  }

  exportHistory(from: Checkpoint): readonly Confirmation<Envelope>[] | undefined {
    const point = from.depth === 0 ? this.genesis : this.history[from.depth - 1]
    if (!point || !sameTip(point, from)) return undefined
    return Object.freeze(this.history.slice(from.depth))
  }

  verify(history: readonly Confirmation<Envelope>[], tip: Checkpoint): boolean {
    let point = this.genesis
    const records = new Map<string, Confirmation<Envelope>>()
    const engine = new TextbufferEngine(this.base.buffer)
    const host = new Host({
      document: this.options.document,
      epoch: this.options.epoch,
      engine,
      unknownDeps: 'reject',
    })
    for (const record of history) {
      if (!this.validNext(record, point, records)) return false
      const result = host.submit(
        record.edit,
        record.id.actor,
        record.outcome.kind === 'rejected' ? record.outcome.reason : undefined,
      )
      if (result.status === 'deferred' || result.status !== hostMessage(record).status) return false
      records.set(editKey(record.id), record)
      point = record
    }
    return sameTip(point, tip)
  }

  private validNext(
    record: Confirmation<Envelope>,
    tip: Checkpoint,
    records: ReadonlyMap<string, Confirmation<Envelope>>,
  ): boolean {
    const { hash, ...body } = record
    return (
      record.depth === tip.depth + 1 &&
      record.predecessor === tip.hash &&
      !records.has(editKey(record.id)) &&
      editKey(record.id) === editKey(record.edit.id) &&
      record.edit.document === this.options.document &&
      record.edit.epoch === this.options.epoch &&
      hash === digest(body)
    )
  }

  install(history: readonly Confirmation<Envelope>[], recovered: readonly Envelope[] = []): void {
    if (!this.verify(history, history.at(-1) ?? this.genesis))
      throw new TypeError('Invalid collaboration history')
    this.history = []
    this.records.clear()
    for (const record of history) this.append(record)
    this.restoreHost()
    this.participant.install(this.base, history.map(hostMessage), recovered)
  }

  private restoreHost(): void {
    this.hostEngine = new TextbufferEngine(this.base.buffer)
    this.host = this.createHost()
    for (const record of this.history) {
      this.host.submit(
        record.edit,
        record.id.actor,
        record.outcome.kind === 'rejected' ? record.outcome.reason : undefined,
      )
    }
  }

  uniquePending(history: readonly Confirmation<Envelope>[]): readonly Envelope[] {
    return history.filter((record) => !this.outcome(record.id)).map((record) => record.edit)
  }
}

function freezeRecord<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeRecord(child)
  return Object.freeze(value)
}
