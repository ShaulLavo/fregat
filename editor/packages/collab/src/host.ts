import { CollabFailure } from './failure'
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

export class Host<Snapshot = unknown> {
  private sequence = 0
  private outcomes = new Map<string, HostMessage>()
  private deferred = new Map<string, Envelope>()
  private listeners = new Set<(message: HostMessage) => void>()
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
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  outcome(id: EditId): HostMessage | undefined {
    return this.outcomes.get(editKey(id))
  }

  submit(envelope: Envelope): SubmitResult {
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
    try {
      this.settleReady()
      while (this.broadcasts.length) {
        const message = this.broadcasts.shift()!
        for (const listener of this.listeners) listener(message)
      }
    } finally {
      this.draining = false
    }
    if (this.deferred.size && [...this.deferred.values()].some((envelope) => this.ready(envelope)))
      this.drain()
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

  private settle(envelope: Envelope, rejection: string | null): void {
    let reason = rejection
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
