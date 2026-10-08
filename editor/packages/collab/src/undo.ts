import { CollabFailure } from './failure'
import { editKey, insertionOf } from './types'
import type { Change, CharId, EditId, Effect, Envelope, IdSpan } from './types'

export type UndoTransaction = {
  readonly id: EditId
  readonly edits: readonly EditId[]
  readonly metadata?: unknown
}
export type UndoState = {
  readonly undo: readonly UndoTransaction[]
  readonly redo: readonly UndoTransaction[]
}
export type UndoEvent = {
  readonly kind: 'record' | 'undo' | 'redo'
  readonly transaction: UndoTransaction
}
export type UndoOptions = {
  readonly groupDelay?: number
  readonly now?: () => number
  readonly onEvent?: (event: UndoEvent) => void
}
export type CaptureOptions = {
  readonly boundary?: boolean
  readonly history?: boolean
  readonly metadata?: unknown
}
type Transaction = { id: EditId; edits: EditId[]; metadata?: unknown }
type HistoryAction = {
  readonly kind: 'record' | 'undo' | 'redo'
  readonly id: EditId
  readonly transaction: string
  status: 'pending' | 'accepted' | 'rejected'
}
type Action = HistoryAction | { readonly kind: 'clearUndo' } | { readonly kind: 'clearRedo' }
type Outcome =
  | { readonly kind: 'accepted'; readonly envelope: Envelope }
  | { readonly kind: 'rejected'; readonly ids: readonly EditId[] }
type Link = { previous: string | null; next: string | null }

class HistoryStack {
  private entries = new Map<string, Link>()
  private last: string | null = null

  constructor(keys: Iterable<string> = []) {
    for (const key of keys) this.push(key)
  }

  get top(): string | null {
    return this.last
  }

  [Symbol.iterator](): MapIterator<string> {
    return this.entries.keys()
  }

  push(key: string): void {
    const previous = this.last
    this.entries.set(key, { previous, next: null })
    if (previous !== null) this.entries.get(previous)!.next = key
    this.last = key
  }

  delete(key: string): boolean {
    const link = this.entries.get(key)
    if (!link) return false
    if (link.previous !== null) this.entries.get(link.previous)!.next = link.next
    if (link.next !== null) this.entries.get(link.next)!.previous = link.previous
    if (this.last === key) this.last = link.previous
    return this.entries.delete(key)
  }
}

type Traversal = { undo: HistoryStack; redo: HistoryStack; keys: Set<string> }

/** Local history captures user work once; host outcomes settle its replay journal. */
export class UndoManager {
  private transactions = new Map<string, Transaction>()
  private traversal: Traversal = {
    undo: new HistoryStack(),
    redo: new HistoryStack(),
    keys: new Set(),
  }
  private checkpoint: Traversal = {
    undo: new HistoryStack(),
    redo: new HistoryStack(),
    keys: new Set(),
  }
  private actions: (Action | null)[] = []
  private actionHead = 0
  private emitting: Outcome[] | null = null
  private pending = new Map<string, HistoryAction>()
  private journalReferences = new Map<string, number>()
  private group: string | null = null
  private lastTime = -Infinity
  private explicit = false
  private metadata: unknown
  private paused = false
  private region: IdSpan[] = []
  private operations = new Map<string, readonly IdSpan[]>()
  private current: UndoTransaction | null = null

  constructor(
    private readonly actor: string,
    private readonly emit: (effects: readonly Effect[]) => Envelope,
    private readonly options: UndoOptions = {},
    private readonly publish?: () => void,
  ) {
    const delay = options.groupDelay ?? 500
    if (!Number.isFinite(delay) || delay < 0) throw new CollabFailure('invalid-group-delay')
  }

  get canUndo(): boolean {
    return this.traversal.undo.top !== null
  }

  get canRedo(): boolean {
    return this.traversal.redo.top !== null
  }

  state(): UndoState {
    return {
      undo: Array.from(this.traversal.undo, (key) => this.transaction(key)),
      redo: Array.from(this.traversal.redo, (key) => this.transaction(key)),
    }
  }

  get currentTransaction(): UndoTransaction | null {
    return this.current
  }

  beginTransaction(metadata?: unknown): void {
    if (this.explicit) throw new CollabFailure('nested-transaction')
    this.seal()
    this.explicit = true
    this.metadata = metadata
  }

  endTransaction(): UndoTransaction | null {
    const transaction = this.group ? this.transaction(this.group) : null
    this.seal()
    return transaction
  }

  seal(): void {
    this.group = null
    this.region = []
    this.explicit = false
    this.metadata = undefined
  }

  pause(): void {
    this.seal()
    this.paused = true
  }

  resume(): void {
    this.paused = false
    this.seal()
  }

  clearUndo(): void {
    this.seal()
    this.clearStack(this.traversal, 'undo')
    this.actions.push({ kind: 'clearUndo' })
    this.compact()
  }

  clearRedo(): void {
    this.seal()
    this.clearStack(this.traversal, 'redo')
    this.actions.push({ kind: 'clearRedo' })
    this.compact()
  }

  undo(): Envelope | null {
    return this.move('undo')
  }

  redo(): Envelope | null {
    return this.move('redo')
  }

  /** A branching graph can set several departing/arriving edges in one command. */
  setTransactions(
    changes: readonly { readonly transaction: UndoTransaction; readonly active: boolean }[],
  ): Envelope {
    const effects = changes.flatMap(({ transaction, active }) =>
      transaction.edits.map((op) => ({ op, active })),
    )
    for (const effect of effects)
      if (effect.op.actor !== this.actor) throw new CollabFailure('foreign-effect')
    this.seal()
    const envelope = this.emit(effects)
    this.publish?.()
    return envelope
  }

  setActive(transaction: UndoTransaction, active: boolean): Envelope {
    return this.setTransactions([{ transaction, active }])
  }

  record(envelope: Envelope, capture: CaptureOptions = {}): void {
    if (envelope.id.actor !== this.actor || envelope.change.kind === 'setEffects') return
    this.operations.set(editKey(envelope.id), affectedSpans(envelope.change))
    if (this.paused || capture.history === false) {
      this.seal()
      return
    }
    const now = (this.options.now ?? Date.now)()
    if (
      capture.boundary ||
      (!this.explicit && now - this.lastTime >= (this.options.groupDelay ?? 500))
    )
      this.seal()
    const key = this.group ?? editKey(envelope.id)
    const existing = this.transactions.get(key)
    if (!existing) {
      this.transactions.set(key, {
        id: { ...envelope.id },
        edits: [],
        metadata: capture.metadata ?? this.metadata,
      })
      this.traversal.undo.push(key)
      this.traversal.keys.add(key)
    }
    this.transactions.get(key)!.edits.push({ ...envelope.id })
    this.append({ kind: 'record', id: { ...envelope.id }, transaction: key, status: 'pending' })
    this.clearStack(this.traversal, 'redo')
    this.group = key
    this.lastTime = now
    this.region.push(...affectedSpans(envelope.change))
    try {
      this.options.onEvent?.({ kind: 'record', transaction: this.transaction(key) })
    } finally {
      if (capture.boundary) this.seal()
    }
  }

  remote(envelope: Envelope): void {
    const change = envelope.change
    if (change.kind !== 'setEffects')
      this.operations.set(editKey(envelope.id), affectedSpans(change))
    if (envelope.id.actor === this.actor) {
      if (this.emitting) {
        this.emitting.push({ kind: 'accepted', envelope })
        return
      }
      const action = this.pending.get(editKey(envelope.id))
      if (action?.status === 'pending') action.status = 'accepted'
      this.compact()
      return
    }
    if (!this.group) return
    if (change.kind !== 'setEffects') {
      if (intersects(change, this.region)) this.seal()
      return
    }
    if (
      change.effects.some((effect) => {
        const spans = this.operations.get(editKey(effect.op))
        // Snapshot baselines may predate the observed operation scopes.
        return !spans || spansIntersect(spans, this.region)
      })
    )
      this.seal()
  }

  reject(ids: readonly EditId[]): void {
    if (ids.length === 0) return
    if (this.emitting) {
      this.emitting.push({ kind: 'rejected', ids })
      return
    }
    const rejected = new Map<string, Set<string>>()
    for (const id of ids) {
      const key = editKey(id)
      const action = this.pending.get(key)
      if (!action || action.status !== 'pending') continue
      action.status = 'rejected'
      if (action.kind !== 'record') continue
      let edits = rejected.get(action.transaction)
      if (!edits) {
        edits = new Set()
        rejected.set(action.transaction, edits)
      }
      edits.add(key)
    }
    for (const [key, edits] of rejected) {
      const transaction = this.transactions.get(key)!
      transaction.edits = transaction.edits.filter((edit) => !edits.has(editKey(edit)))
    }
    this.seal()
    const previous = this.traversal.keys
    this.traversal = {
      undo: new HistoryStack(this.checkpoint.undo),
      redo: new HistoryStack(this.checkpoint.redo),
      keys: new Set(this.checkpoint.keys),
    }
    for (let index = this.actionHead; index < this.actions.length; index++)
      this.rebuild(this.actions[index]!, this.traversal)
    for (const key of previous) this.release(key)
    this.compact()
  }

  private move(kind: 'undo' | 'redo'): Envelope | null {
    const from = kind === 'undo' ? this.traversal.undo : this.traversal.redo
    const to = kind === 'undo' ? this.traversal.redo : this.traversal.undo
    const key = from.top
    if (!key) return null
    this.seal()
    const transaction = this.transaction(key)
    const previous = this.current
    this.current = transaction
    from.delete(key)
    to.push(key)
    let envelope: Envelope | null = null
    const outcomes: Outcome[] = []
    const previousEmission = this.emitting
    try {
      // The emitter chooses the command ID and can deliver its outcome before returning.
      this.emitting = outcomes
      try {
        envelope = this.emit(transaction.edits.map((op) => ({ op, active: kind === 'redo' })))
      } finally {
        this.emitting = previousEmission
      }
      this.append({ kind, id: { ...envelope.id }, transaction: key, status: 'pending' })
      this.settle(outcomes)
      try {
        this.options.onEvent?.({ kind, transaction })
      } finally {
        this.publish?.()
      }
      return envelope
    } catch (failure) {
      if (!envelope) {
        to.delete(key)
        from.push(key)
        this.settle(outcomes)
      }
      throw failure
    } finally {
      this.current = previous
    }
  }

  private settle(outcomes: readonly Outcome[]): void {
    for (const outcome of outcomes) {
      if (outcome.kind === 'accepted') this.remote(outcome.envelope)
      if (outcome.kind === 'rejected') this.reject(outcome.ids)
    }
  }

  private transaction(key: string): UndoTransaction {
    const transaction = this.transactions.get(key)!
    return {
      id: { ...transaction.id },
      metadata: transaction.metadata,
      edits: transaction.edits.map((id) => ({ ...id })),
    }
  }

  private append(action: HistoryAction): void {
    this.actions.push(action)
    this.pending.set(editKey(action.id), action)
    const count = this.journalReferences.get(action.transaction) ?? 0
    this.journalReferences.set(action.transaction, count + 1)
  }

  private compact(): void {
    while (this.actionHead < this.actions.length) {
      const action = this.actions[this.actionHead]!
      // Rejecting an earlier action can change the traversal of later accepted commands.
      if ('status' in action && action.status === 'pending') break
      this.rebuild(action, this.checkpoint)
      this.actions[this.actionHead++] = null
      if (!('transaction' in action)) continue
      this.pending.delete(editKey(action.id))
      const references = this.journalReferences.get(action.transaction)! - 1
      if (references === 0) this.journalReferences.delete(action.transaction)
      else this.journalReferences.set(action.transaction, references)
      this.release(action.transaction)
    }
    if (this.actionHead === this.actions.length) {
      this.actions = []
      this.actionHead = 0
      return
    }
    // Halving bounds total suffix copies while consumed slots release their references immediately.
    if (this.actionHead >= this.actions.length / 2) {
      this.actions = this.actions.slice(this.actionHead)
      this.actionHead = 0
    }
  }

  private release(key: string): void {
    if (
      this.traversal.keys.has(key) ||
      this.checkpoint.keys.has(key) ||
      this.journalReferences.has(key)
    )
      return
    this.transactions.delete(key)
  }

  private clearStack(traversal: Traversal, kind: 'undo' | 'redo'): void {
    const discarded = traversal[kind]
    traversal[kind] = new HistoryStack()
    for (const key of discarded) {
      traversal.keys.delete(key)
      this.release(key)
    }
  }

  private rebuild(action: Action, traversal: Traversal): void {
    if (action.kind === 'clearUndo') {
      this.clearStack(traversal, 'undo')
      return
    }
    if (action.kind === 'clearRedo') {
      this.clearStack(traversal, 'redo')
      return
    }
    if (action.status === 'rejected') return
    if (action.kind === 'record') {
      this.clearStack(traversal, 'redo')
      if (!traversal.keys.has(action.transaction)) {
        traversal.undo.push(action.transaction)
        traversal.keys.add(action.transaction)
      }
      return
    }
    const from = action.kind === 'undo' ? traversal.undo : traversal.redo
    const to = action.kind === 'undo' ? traversal.redo : traversal.undo
    if (!from.delete(action.transaction)) return
    to.push(action.transaction)
  }
}

function affectedSpans(change: Change): readonly IdSpan[] {
  const insert = insertionOf(change)
  const spans = change.kind === 'delete' || change.kind === 'replace' ? change.spans : []
  return insert ? [...spans, { start: insert.start, count: insert.text.length }] : spans
}
function contains(span: IdSpan, id: CharId): boolean {
  return (
    span.start.bunch === id.bunch &&
    span.start.counter <= id.counter &&
    id.counter < span.start.counter + span.count
  )
}
function intersects(change: Change, region: readonly IdSpan[]): boolean {
  const insert = insertionOf(change)
  if (
    insert &&
    region.some(
      (span) =>
        (typeof insert.originLeft !== 'string' && contains(span, insert.originLeft)) ||
        (typeof insert.originRight !== 'string' && contains(span, insert.originRight)),
    )
  )
    return true
  return spansIntersect(affectedSpans(change), region)
}
function spansIntersect(targets: readonly IdSpan[], region: readonly IdSpan[]): boolean {
  return targets.some((target) =>
    region.some(
      (span) =>
        target.start.bunch === span.start.bunch &&
        target.start.counter < span.start.counter + span.count &&
        span.start.counter < target.start.counter + target.count,
    ),
  )
}
