import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  Host,
  Participant,
  TextbufferEngine,
  type Envelope,
  type HostMessage,
  type UndoOptions,
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
  private confirmations: HostMessage[] = []
  private allocated: Envelope[] = []
  private batching = 0
  private readonly confirmedObservers = new Set<(reset: boolean, remote: boolean) => void>()

  confirmedSnapshot(): ReturnType<TextbufferEngine['snapshot']> {
    return this.hostEngine.snapshot()
  }

  subscribeConfirmed(observer: (reset: boolean, remote: boolean) => void): () => void {
    this.confirmedObservers.add(observer)
    return () => this.confirmedObservers.delete(observer)
  }

  constructor(
    private readonly options: CollaborationDocumentOptions,
    undo?: UndoOptions,
  ) {
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
      undo,
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

  /** Bind local effect state and retain every already-known foreign identity. */
  historyIdentity(): string {
    const snapshot = this.engine.snapshot()
    const bootstrap = indexEntries(this.base.runs).map(([key, value]) => [key, value.count])
    const operations = indexEntries(snapshot.effects.operations).filter(
      ([, value]) => value.kind === 'edit',
    )
    const own = operations.filter(([key]) => key.bunch === this.options.peer)
    const universe = operations
      .filter(([key]) => key.bunch !== this.options.peer)
      .map(([key, value]) => [key, value.kind === 'edit' ? value.spans : []])
    const identity = digest([
      this.options.document,
      this.options.epoch,
      this.options.peer,
      bootstrap,
      own,
    ])
    return JSON.stringify([identity, universe])
  }

  authoredEffects(): readonly { readonly op: EditId; readonly active: boolean }[] {
    return indexEntries(this.engine.snapshot().effects.operations).flatMap(([key, value]) =>
      value.kind === 'edit'
        ? [{ op: { actor: key.bunch, seq: key.counter }, active: value.active }]
        : [],
    )
  }

  matchesHistoryIdentity(saved: string): boolean {
    try {
      const [identity, universe] = JSON.parse(saved)
      const [current, operations] = JSON.parse(this.historyIdentity())
      if (identity !== current || !Array.isArray(universe)) return false
      const available = new Set(operations.map(canonical))
      return universe.every((operation: unknown) => available.has(canonical(operation)))
    } catch {
      return false
    }
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
    this.confirmation(message, edit)
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
    this.confirmation(hostMessage(record), record.edit)
    return true
  }

  sequenceBatch(
    edits: readonly { readonly edit: Envelope; readonly rejection?: string }[],
  ): readonly Confirmation<Envelope>[] {
    return this.batch(() => edits.map(({ edit, rejection }) => this.sequence(edit, rejection)))
  }

  applyBatch(records: readonly Confirmation<Envelope>[]): boolean {
    return this.batch(() => records.every((record) => this.apply(record)))
  }

  private batch<T>(operation: () => T): T {
    this.batching++
    try {
      return operation()
    } finally {
      this.batching--
      if (!this.batching) this.settleProjection()
    }
  }

  private confirmation(message: HostMessage, envelope: Envelope): void {
    this.confirmations.push(message)
    if (message.status === 'rejected') this.allocated.push(envelope)
    if (!this.batching) this.settleProjection()
  }

  private settleProjection(): void {
    if (!this.confirmations.length) return
    const messages = this.confirmations
    const allocated = this.allocated
    this.confirmations = []
    this.allocated = []
    this.participant.receive(messages, allocated)
    const remote = messages.some(
      (message) => message.status === 'accepted' && message.envelope.id.actor !== this.options.peer,
    )
    for (const observer of this.confirmedObservers) observer(false, remote)
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
    this.participant.install(
      this.base,
      history.map(hostMessage),
      recovered,
      history.filter((record) => record.outcome.kind === 'rejected').map((record) => record.edit),
    )
    const remote = history.some(
      (record) => record.outcome.kind === 'accepted' && record.id.actor !== this.options.peer,
    )
    for (const observer of this.confirmedObservers) observer(true, remote)
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

type IdentityTree<T> = {
  readonly key: { readonly bunch: string; readonly counter: number }
  readonly value: T
  readonly left: IdentityTree<T> | null
  readonly right: IdentityTree<T> | null
}
function indexEntries<T>(
  root: IdentityTree<T> | null,
): readonly (readonly [{ readonly bunch: string; readonly counter: number }, T])[] {
  if (!root) return []
  return indexEntries(root.left).concat([[root.key, root.value] as const], indexEntries(root.right))
}
