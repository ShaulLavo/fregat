import { CharIdAllocator } from '@singapore-editor/textbuffer'
import { CollabFailure, rethrowObserverErrors } from './failure'
import { cloneEnvelope } from './host'
import { UndoManager } from './undo'
import type { CaptureOptions, UndoOptions } from './undo'
import type { HostMessage } from './host'
import { editKey, insertionOf, sameEnvelope } from './types'
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

type PendingEdit = { readonly envelope: Envelope; applied: boolean }
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
  // Snapshot-copying engines retain one base and accepted prefix envelopes, never every prefix snapshot.
  private acknowledged: Envelope[] = []
  private frontier = new Map<string, EditId>()
  private pending = new Map<string, PendingEdit>()
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
      frontier: Array.from(this.frontier.values(), (id) => ({ ...id })),
      hostSequence: this.sequence,
      pending: Array.from(this.pending.values(), ({ envelope }) => cloneEnvelope(envelope)),
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
    return this.localBatch([edit], capture)[0]!
  }

  /** Author the entire offset batch before recording history or publishing it. */
  localBatch(edits: readonly OffsetEdit[], capture: CaptureOptions = {}): readonly Envelope[] {
    const before = this.options.engine.snapshot()
    const sequence = this.editSequence
    const lamport = this.lamport
    const envelopes: Envelope[] = []
    try {
      for (const edit of edits) {
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
        this.pending.set(editKey(envelope.id), {
          envelope: cloneEnvelope(envelope),
          applied: true,
        })
        envelopes.push(envelope)
      }
    } catch (error) {
      this.options.engine.restore(before)
      for (const envelope of envelopes) this.pending.delete(editKey(envelope.id))
      this.editSequence = sequence
      this.lamport = lamport
      throw error
    }
    if (envelopes.length > 1) this.undoManager.beginTransaction()
    try {
      for (const envelope of envelopes) this.undoManager.record(envelope, capture)
    } finally {
      if (envelopes.length > 1) this.undoManager.endTransaction()
      this.publish()
    }
    return envelopes
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
    this.pending.set(editKey(envelope.id), {
      envelope: cloneEnvelope(envelope),
      applied: true,
    })
    return cloneEnvelope(envelope)
  }

  receive(messages: readonly HostMessage[], allocated: readonly Envelope[] = []): void {
    // Rejected wire records retain allocations that are absent from accepted engine state.
    for (const envelope of allocated) this.reserveIdentities(envelope, true)
    for (const message of messages) {
      if (message.document !== this.options.document || message.epoch !== this.options.epoch)
        throw new CollabFailure('wrong-document-epoch')
      if (!Number.isSafeInteger(message.sequence) || message.sequence < 1)
        throw new CollabFailure('invalid-host-sequence')
      if (message.sequence > this.sequence) this.incoming.set(message.sequence, message)
    }
    if (!this.incoming.has(this.sequence + 1)) return
    this.historyRejected = []
    let reconcile = false
    while (this.incoming.has(this.sequence + 1)) {
      const message = this.incoming.get(this.sequence + 1)!
      this.incoming.delete(++this.sequence)
      const head = this.pending.values().next().value
      const promoted =
        !reconcile &&
        message.status === 'accepted' &&
        head?.applied &&
        sameEnvelope(head.envelope, message.envelope)
      if (promoted) {
        this.acknowledged.push(head!.envelope)
      } else if (!reconcile) {
        this.options.engine.restore(this.confirmed)
        for (const envelope of this.acknowledged) this.options.engine.apply(envelope)
        this.acknowledged = []
        reconcile = true
      }
      this.confirm(message, !promoted)
    }
    if (reconcile) {
      this.confirmed = this.options.engine.snapshot()
      this.replay()
    } else if (!this.pending.size) {
      this.confirmed = this.options.engine.snapshot()
      this.acknowledged = []
    }
    this.undoManager.reject(this.historyRejected.concat(this.blocked))
    this.publish()
  }

  /** Installs a verified branch while retaining authored pending work and local undo. */
  install(
    base: Snapshot,
    messages: readonly HostMessage[],
    recovered: readonly Envelope[] = [],
    allocated: readonly Envelope[] = [],
  ): void {
    const pending = new Map<string, Envelope>()
    for (const edit of recovered.concat(
      Array.from(this.pending.values(), ({ envelope }) => envelope),
    ))
      pending.set(editKey(edit.id), cloneEnvelope(edit))
    this.pending = new Map(
      Array.from(pending, ([key, envelope]) => [key, { envelope, applied: false }]),
    )
    for (const { envelope } of this.pending.values()) this.reserveIdentities(envelope)
    this.confirmed = base
    this.acknowledged = []
    this.sequence = 0
    this.frontier.clear()
    this.rejected.clear()
    this.incoming.clear()
    if (messages.length) {
      this.receive(messages, allocated)
      return
    }
    this.options.engine.restore(base)
    this.replay()
    this.undoManager.reject(this.blocked)
    this.publish()
  }

  private confirm(message: HostMessage, apply: boolean): void {
    const id = message.status === 'accepted' ? message.envelope.id : message.id
    if (id.actor === this.actor) this.editSequence = Math.max(this.editSequence, id.seq)
    if (message.status === 'accepted') this.reserveIdentities(message.envelope)
    this.pending.delete(editKey(id))
    if (message.status === 'rejected') {
      this.rejected.add(editKey(id))
      this.historyRejected.push(id)
      return
    }
    if (apply) this.options.engine.apply(message.envelope)
    this.undoManager.remote(message.envelope)
    this.lamport = Math.max(this.lamport, message.envelope.lamport)
    for (const dependency of message.envelope.deps) this.frontier.delete(editKey(dependency))
    this.frontier.set(editKey(id), { ...id })
  }

  private reserveIdentities(envelope: Envelope, rejected = false): void {
    if (envelope.id.actor !== this.actor) return
    this.editSequence = Math.max(this.editSequence, envelope.id.seq)
    const insert = insertionOf(envelope.change)
    if (!insert) return
    try {
      this.allocator.reserve(insert.start, insert.text.length)
    } catch (error) {
      // A malformed rejected span contains no allocatable character IDs.
      if (!rejected || !(error instanceof RangeError)) throw error
    }
  }

  private replay(): void {
    this.blocked = []
    const blocked = new Set(this.rejected)
    for (const entry of this.pending.values()) {
      const { envelope } = entry
      entry.applied = false
      if (envelope.deps.some((id) => blocked.has(editKey(id)))) {
        blocked.add(editKey(envelope.id))
        this.blocked.push(envelope.id)
        continue
      }
      try {
        this.options.engine.apply(envelope)
        entry.applied = true
      } catch (error) {
        if (!(error instanceof CollabFailure) || error.code !== 'unknown-character') throw error
        blocked.add(editKey(envelope.id))
        this.blocked.push(envelope.id)
      }
    }
  }

  private pendingFrontier(): readonly EditId[] {
    const frontier = new Map(this.frontier)
    const blocked = new Set(this.blocked.map(editKey))
    for (const { envelope } of this.pending.values()) {
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
