import { CharIdAllocator } from '@singapore-editor/textbuffer'
import { CollabFailure, rethrowObserverErrors } from './failure'
import { cloneEnvelope } from './host'
import { UndoManager } from './undo'
import type { CaptureOptions, UndoOptions } from './undo'
import type { HostMessage } from './host'
import { editKey } from './types'
import type { EditId, Effect, EffectiveEdit, Engine, Envelope, OffsetEdit } from './types'

export type ParticipantOptions<Snapshot> = {
  readonly actor: string
  readonly document: string
  readonly epoch: string
  readonly engine: Engine<Snapshot>
  readonly undo?: UndoOptions
}
export type ParticipantState = {
  readonly text: string
  readonly frontier: readonly EditId[]
  readonly hostSequence: number
  readonly pending: readonly Envelope[]
  readonly blocked: readonly EditId[]
}

export type ParticipantChange = Omit<ParticipantState, 'text'> & {
  readonly edits: readonly EffectiveEdit[]
}

type Subscription = { readonly listener: (change: ParticipantChange) => void }
type Publication = {
  readonly change: ParticipantChange
  readonly listeners: readonly Subscription[]
}

export class Participant<Snapshot = unknown> {
  readonly actor: string
  readonly undoManager: UndoManager
  private historyRejected: EditId[] = []
  private confirmed: Snapshot
  private frontier = new Map<string, EditId>()
  private pending: Envelope[] = []
  private incoming = new Map<number, HostMessage>()
  private rejected = new Set<string>()
  private blocked: EditId[] = []
  private sequence = 0
  private editSequence = 0
  private lamport = 0
  private readonly allocator: CharIdAllocator
  private listeners = new Set<Subscription>()
  private publication: { readonly snapshot: Snapshot } | null = null
  private publications: Publication[] = []
  private publishing = false

  constructor(private readonly options: ParticipantOptions<Snapshot>) {
    if (!options.actor) throw new CollabFailure('invalid-actor')
    this.allocator = new CharIdAllocator(options.actor)
    this.actor = options.actor
    this.confirmed = options.engine.snapshot()
    this.undoManager = new UndoManager(
      options.actor,
      (effects) => this.enqueueEffects(effects),
      options.undo,
      () => this.publish(),
    )
  }

  text(): string {
    return this.options.engine.text()
  }

  state(): ParticipantState {
    return { ...this.metadata(), text: this.text() }
  }

  private metadata(): Omit<ParticipantState, 'text'> {
    return {
      frontier: [...this.frontier.values()].map((id) => ({ ...id })),
      hostSequence: this.sequence,
      pending: this.pending.map(cloneEnvelope),
      blocked: this.blocked.map((id) => ({ ...id })),
    }
  }

  subscribe(listener: (change: ParticipantChange) => void): () => void {
    if (this.listeners.size === 0) this.publication = { snapshot: this.options.engine.snapshot() }
    const subscription = { listener }
    this.listeners.add(subscription)
    return () => {
      this.listeners.delete(subscription)
      if (this.listeners.size === 0) this.publication = null
    }
  }

  local(edit: OffsetEdit, capture: CaptureOptions = {}): Envelope {
    const envelope = this.options.engine.author(edit, {
      document: this.options.document,
      epoch: this.options.epoch,
      id: { actor: this.options.actor, seq: this.editSequence + 1 },
      lamport: this.lamport + 1,
      deps: this.pendingFrontier(),
      allocate: (left, count) => this.allocator.generateAfter(left, count),
    })
    this.options.engine.apply(envelope)
    this.editSequence++
    this.lamport++
    this.pending.push(cloneEnvelope(envelope))
    try {
      this.undoManager.record(envelope, capture)
    } finally {
      this.publish()
    }
    return envelope
  }

  setEffects(effects: readonly Effect[]): Envelope {
    const envelope = this.enqueueEffects(effects)
    this.publish()
    return envelope
  }

  private enqueueEffects(effects: readonly Effect[]): Envelope {
    const id = { actor: this.options.actor, seq: this.editSequence + 1 }
    const envelope: Envelope = {
      document: this.options.document,
      epoch: this.options.epoch,
      id,
      lamport: this.lamport + 1,
      deps: this.pendingFrontier(),
      change: { kind: 'setEffects', command: id, effects },
    }
    this.options.engine.apply(envelope)
    this.editSequence++
    this.lamport++
    this.pending.push(cloneEnvelope(envelope))
    return cloneEnvelope(envelope)
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
    this.historyRejected = []
    this.options.engine.restore(this.confirmed)
    while (this.incoming.has(this.sequence + 1)) {
      const message = this.incoming.get(this.sequence + 1)!
      this.incoming.delete(++this.sequence)
      this.confirm(message)
    }
    this.confirmed = this.options.engine.snapshot()
    this.replay()
    this.undoManager.reject([...this.historyRejected, ...this.blocked])
    this.publish()
  }

  private confirm(message: HostMessage): void {
    const id = message.status === 'accepted' ? message.envelope.id : message.id
    this.pending = this.pending.filter((envelope) => editKey(envelope.id) !== editKey(id))
    if (message.status === 'rejected') {
      this.rejected.add(editKey(id))
      this.historyRejected.push(id)
      return
    }
    this.options.engine.apply(message.envelope)
    this.undoManager.remote(message.envelope)
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

  private publish(): void {
    if (this.listeners.size === 0) return
    const edits = this.options.engine.changesBetween(this.publication!.snapshot)
    this.publication = { snapshot: this.options.engine.snapshot() }
    const change = { ...this.metadata(), edits }
    this.publications.push({ change, listeners: [...this.listeners] })
    if (this.publishing) return
    this.publishing = true
    const errors: unknown[] = []
    try {
      while (this.publications.length) this.deliver(this.publications.shift()!, errors)
    } finally {
      this.publications = []
      this.publishing = false
    }
    rethrowObserverErrors('participant.publish', errors)
  }

  private deliver({ change, listeners }: Publication, errors: unknown[]): void {
    for (const subscription of listeners) {
      if (!this.listeners.has(subscription)) continue
      try {
        subscription.listener(change)
      } catch (error) {
        errors.push(error)
      }
    }
  }
}
