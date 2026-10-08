import { CollabFailure, rethrowObserverErrors } from './failure'
import { editKey, insertionOf } from './types'
import type { EditId, Engine, Envelope } from './types'

export type HostMessage = {
  readonly document: string
  readonly epoch: string
  readonly sequence: number
} & (
  | { readonly status: 'accepted'; readonly envelope: Envelope }
  | { readonly status: 'rejected'; readonly id: EditId; readonly reason: string }
)
export type SubmitResult = HostMessage | { readonly status: 'deferred'; readonly id: EditId }
export type HostOptions<Snapshot> = {
  readonly document: string
  readonly epoch: string
  readonly engine: Engine<Snapshot>
  readonly unknownDeps?: 'defer' | 'reject'
}

type Subscription = { readonly listener: (message: HostMessage) => void }

export class Host<Snapshot = unknown> {
  private sequence = 0
  private outcomes = new Map<string, HostMessage>()
  private deferred = new Map<string, Envelope>()
  private listeners = new Set<Subscription>()
  private draining = false
  private broadcasts: HostMessage[] = []

  constructor(private readonly options: HostOptions<Snapshot>) {}

  text(): string {
    return this.options.engine.text()
  }
  get hostSequence(): number {
    return this.sequence
  }

  subscribe(listener: (message: HostMessage) => void): () => void {
    const subscription = { listener }
    this.listeners.add(subscription)
    return () => {
      this.listeners.delete(subscription)
    }
  }

  outcome(id: EditId): HostMessage | undefined {
    return this.outcomes.get(editKey(id))
  }

  /** The transport supplies sender from its authenticated session, never from the frame. */
  submit(envelope: Envelope, sender: string): SubmitResult {
    if (typeof sender !== 'string' || !sender) throw new CollabFailure('missing-sender')
    if (sender !== envelope.id.actor) throw new CollabFailure('sender-mismatch')
    const key = editKey(envelope.id)
    const outcome = this.outcomes.get(key)
    if (outcome) return outcome
    if (!this.deferred.has(key)) this.deferred.set(key, cloneEnvelope(envelope))
    this.drain()
    return this.outcomes.get(key) ?? { status: 'deferred', id: { ...envelope.id } }
  }

  private drain(): void {
    // A synchronous transport may submit during a broadcast; settle before notifying it.
    if (this.draining) return
    this.draining = true
    const errors: unknown[] = []
    try {
      do {
        this.settleReady()
        while (this.broadcasts.length) this.deliver(this.broadcasts.shift()!, errors)
      } while ([...this.deferred.values()].some((envelope) => this.ready(envelope)))
    } finally {
      this.draining = false
    }
    rethrowObserverErrors('host.broadcast', errors)
  }

  private deliver(message: HostMessage, errors: unknown[]): void {
    const subscriptions = [...this.listeners]
    for (const subscription of subscriptions) {
      if (!this.listeners.has(subscription)) continue
      try {
        subscription.listener(message)
      } catch (error) {
        errors.push(error)
      }
    }
  }

  private settleReady(): void {
    let progress = true
    while (progress) {
      progress = false
      for (const [key, envelope] of this.deferred) {
        const reason = this.rejection(envelope)
        if (reason === null && envelope.deps.some((id) => !this.outcomes.has(editKey(id)))) continue
        this.deferred.delete(key)
        this.settle(envelope, reason)
        progress = true
      }
    }
  }

  private ready(envelope: Envelope): boolean {
    return (
      this.rejection(envelope) !== null ||
      envelope.deps.every((id) => this.outcomes.has(editKey(id)))
    )
  }

  private rejection(envelope: Envelope): string | null {
    if (envelope.document !== this.options.document || envelope.epoch !== this.options.epoch)
      return 'wrong-document-epoch'
    if (
      !envelope.id.actor ||
      !Number.isSafeInteger(envelope.id.seq) ||
      envelope.id.seq < 1 ||
      !Number.isSafeInteger(envelope.lamport) ||
      envelope.lamport < 1
    )
      return 'invalid-edit-id-clock'
    if (envelope.deps.some((id) => editKey(id) === editKey(envelope.id))) return 'self-dependency'
    const dependencies = envelope.deps.map((id) => this.outcomes.get(editKey(id)))
    if (dependencies.some((outcome) => outcome?.status === 'rejected')) return 'rejected-dependency'
    if (
      dependencies.some(
        (outcome) => outcome?.status === 'accepted' && outcome.envelope.lamport >= envelope.lamport,
      )
    )
      return 'invalid-lamport'
    if (this.options.unknownDeps === 'reject' && dependencies.includes(undefined))
      return 'unknown-dependency'
    return null
  }

  private effectRejection(envelope: Envelope): string | null {
    const change = envelope.change
    if (change.kind !== 'setEffects') return null
    if (editKey(change.command) !== editKey(envelope.id)) return 'invalid-effect-command'
    for (const effect of change.effects) {
      if (effect.op.actor !== envelope.id.actor) return 'foreign-effect'
      const target = this.outcomes.get(editKey(effect.op))
      if (target?.status !== 'accepted') return 'unknown-effect'
      if (target.envelope.change.kind === 'setEffects') return 'invalid-effect-target'
    }
    return null
  }

  private settle(envelope: Envelope, rejection: string | null): void {
    let reason = rejection ?? this.effectRejection(envelope)
    if (reason === null) {
      const snapshot = this.options.engine.snapshot()
      try {
        this.options.engine.apply(envelope)
      } catch (failure) {
        this.options.engine.restore(snapshot)
        reason = failure instanceof CollabFailure ? failure.code : 'invalid-change'
      }
    }
    const common = {
      document: this.options.document,
      epoch: this.options.epoch,
      sequence: ++this.sequence,
    }
    const message: HostMessage =
      reason === null
        ? { ...common, status: 'accepted', envelope }
        : { ...common, status: 'rejected', id: { ...envelope.id }, reason }
    this.outcomes.set(editKey(envelope.id), message)
    this.broadcasts.push(message)
  }
}

export function cloneEnvelope(envelope: Envelope): Envelope {
  const change = envelope.change
  if (change.kind === 'setEffects')
    return {
      ...envelope,
      id: { ...envelope.id },
      deps: envelope.deps.map((id) => ({ ...id })),
      change: {
        kind: 'setEffects',
        command: { ...change.command },
        effects: change.effects.map((effect) => ({ op: { ...effect.op }, active: effect.active })),
      },
    }
  const insert = insertionOf(change)
  const copied = insert
    ? {
        start: { ...insert.start },
        text: insert.text,
        originLeft:
          typeof insert.originLeft === 'string' ? insert.originLeft : { ...insert.originLeft },
        originRight:
          typeof insert.originRight === 'string' ? insert.originRight : { ...insert.originRight },
      }
    : null
  const spans =
    change.kind === 'insert'
      ? []
      : change.spans.map((span) => ({ start: { ...span.start }, count: span.count }))
  const metadata = {
    document: envelope.document,
    epoch: envelope.epoch,
    id: { ...envelope.id },
    lamport: envelope.lamport,
    deps: envelope.deps.map((id) => ({ ...id })),
  }
  if (change.kind === 'insert') return { ...metadata, change: { kind: 'insert', ...copied! } }
  if (change.kind === 'delete') return { ...metadata, change: { kind: 'delete', spans } }
  return { ...metadata, change: { kind: 'replace', spans, insert: copied! } }
}
