import { CollabFailure } from './failure'
import { cloneEnvelope } from './host'
import type { HostMessage } from './host'
import { editKey, sameChar } from './types'
import type { CharId, EditId, Engine, Envelope, LeftOrigin, OffsetEdit } from './types'

export type ParticipantOptions<Snapshot> = {
  readonly actor: string
  readonly document: string
  readonly epoch: string
  readonly engine: Engine<Snapshot>
}
export type ParticipantState = {
  readonly text: string
  readonly frontier: readonly EditId[]
  readonly hostSequence: number
  readonly pending: readonly Envelope[]
  readonly blocked: readonly EditId[]
}

export class Participant<Snapshot = unknown> {
  private confirmed: Snapshot
  private frontier = new Map<string, EditId>()
  private pending: Envelope[] = []
  private incoming = new Map<number, HostMessage>()
  private rejected = new Set<string>()
  private blocked: EditId[] = []
  private sequence = 0
  private editSequence = 0
  private lamport = 0
  private runSequence = 0
  private lastId: CharId | null = null
  private listeners = new Set<(state: ParticipantState) => void>()

  constructor(private readonly options: ParticipantOptions<Snapshot>) {
    if (!options.actor) throw new CollabFailure('invalid-actor')
    this.confirmed = options.engine.snapshot()
  }

  text(): string {
    return this.options.engine.text()
  }

  state(): ParticipantState {
    return {
      text: this.text(),
      frontier: [...this.frontier.values()].map((id) => ({ ...id })),
      hostSequence: this.sequence,
      pending: this.pending.map(cloneEnvelope),
      blocked: this.blocked.map((id) => ({ ...id })),
    }
  }

  subscribe(listener: (state: ParticipantState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  local(edit: OffsetEdit): Envelope {
    const envelope = this.options.engine.author(edit, {
      document: this.options.document,
      epoch: this.options.epoch,
      id: { actor: this.options.actor, seq: this.editSequence + 1 },
      lamport: this.lamport + 1,
      deps: this.pendingFrontier(),
      allocate: (left, count) => this.allocate(left, count),
    })
    this.options.engine.apply(envelope)
    this.editSequence++
    this.lamport++
    this.pending.push(cloneEnvelope(envelope))
    this.publish()
    return envelope
  }

  receive(messages: readonly HostMessage[]): void {
    for (const message of messages) {
      if (message.document !== this.options.document || message.epoch !== this.options.epoch)
        throw new CollabFailure('wrong-document-epoch')
      if (!Number.isSafeInteger(message.sequence) || message.sequence < 1)
        throw new CollabFailure('invalid-host-sequence')
      if (message.sequence > this.sequence) this.incoming.set(message.sequence, message)
    }
    if (!this.incoming.has(this.sequence + 1)) return
    this.options.engine.restore(this.confirmed)
    while (this.incoming.has(this.sequence + 1)) {
      const message = this.incoming.get(this.sequence + 1)!
      this.incoming.delete(++this.sequence)
      this.confirm(message)
    }
    this.confirmed = this.options.engine.snapshot()
    this.replay()
    this.publish()
  }

  private confirm(message: HostMessage): void {
    const id = message.status === 'accepted' ? message.envelope.id : message.id
    this.pending = this.pending.filter((envelope) => editKey(envelope.id) !== editKey(id))
    if (message.status === 'rejected') {
      this.rejected.add(editKey(id))
      return
    }
    this.options.engine.apply(message.envelope)
    this.lamport = Math.max(this.lamport, message.envelope.lamport)
    for (const dependency of message.envelope.deps) this.frontier.delete(editKey(dependency))
    this.frontier.set(editKey(id), { ...id })
  }

  private replay(): void {
    this.blocked = []
    const blocked = new Set(this.rejected)
    for (const envelope of this.pending) {
      if (envelope.deps.some((id) => blocked.has(editKey(id)))) {
        blocked.add(editKey(envelope.id))
        this.blocked.push(envelope.id)
        continue
      }
      this.options.engine.apply(envelope)
    }
  }

  private pendingFrontier(): readonly EditId[] {
    const frontier = new Map(this.frontier)
    const blocked = new Set(this.blocked.map(editKey))
    for (const envelope of this.pending) {
      if (blocked.has(editKey(envelope.id))) continue
      for (const dependency of envelope.deps) frontier.delete(editKey(dependency))
      frontier.set(editKey(envelope.id), envelope.id)
    }
    return [...frontier.values()]
  }

  private allocate(left: LeftOrigin, count: number): CharId {
    const start =
      this.lastId && sameChar(left, this.lastId)
        ? { bunch: this.lastId.bunch, counter: this.lastId.counter + 1 }
        : { bunch: `${this.options.actor}:${++this.runSequence}`, counter: 0 }
    this.lastId = { bunch: start.bunch, counter: start.counter + count - 1 }
    return start
  }

  private publish(): void {
    if (this.listeners.size === 0) return
    const state = this.state()
    for (const listener of this.listeners) listener(state)
  }
}
