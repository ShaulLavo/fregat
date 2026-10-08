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
type Traversal = { undo: string[]; redo: string[]; keys: Set<string> }

/** Local history captures user work once; host outcomes settle its replay journal. */
export class UndoManager {
  private transactions = new Map<string, Transaction>()
  private traversal: Traversal = { undo: [], redo: [], keys: new Set() }
  private checkpoint: Traversal = { undo: [], redo: [], keys: new Set() }
  private actions: Action[] = []
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

  state(): UndoState {
    return {
      undo: this.traversal.undo.map((key) => this.transaction(key)),
      redo: this.traversal.redo.map((key) => this.transaction(key)),
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
    for (const id of ids) {
      const key = editKey(id)
      const action = this.pending.get(key)
      if (!action || action.status !== 'pending') continue
      action.status = 'rejected'
      if (action.kind !== 'record') continue
      const transaction = this.transactions.get(action.transaction)!
      transaction.edits = transaction.edits.filter((edit) => editKey(edit) !== key)
    }
    this.seal()
    const previous = this.traversal.keys
    this.traversal = {
      undo: [...this.checkpoint.undo],
      redo: [...this.checkpoint.redo],
      keys: new Set(this.checkpoint.keys),
    }
    for (const action of this.actions) this.rebuild(action, this.traversal)
    for (const key of previous) this.release(key)
    this.compact()
  }

  private move(kind: 'undo' | 'redo'): Envelope | null {
    const from = kind === 'undo' ? this.traversal.undo : this.traversal.redo
    const to = kind === 'undo' ? this.traversal.redo : this.traversal.undo
    const key = from.at(-1)
    if (!key) return null
    this.seal()
    const transaction = this.transaction(key)
    const previous = this.current
    this.current = transaction
    from.pop()
    to.push(key)
    let envelope: Envelope | null = null
    try {
      envelope = this.emit(transaction.edits.map((op) => ({ op, active: kind === 'redo' })))
      this.append({ kind, id: { ...envelope.id }, transaction: key, status: 'pending' })
      try {
        this.options.onEvent?.({ kind, transaction })
      } finally {
        this.publish?.()
      }
      return envelope
    } catch (failure) {
      if (!envelope) {
        to.pop()
        from.push(key)
      }
      throw failure
    } finally {
      this.current = previous
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
    let count = 0
    for (const action of this.actions) {
      // Rejecting an earlier action can change the traversal of later accepted commands.
      if ('status' in action && action.status === 'pending') break
      this.rebuild(action, this.checkpoint)
      count++
      if (!('transaction' in action)) continue
      this.pending.delete(editKey(action.id))
      const references = this.journalReferences.get(action.transaction)! - 1
      if (references === 0) this.journalReferences.delete(action.transaction)
      else this.journalReferences.set(action.transaction, references)
      this.release(action.transaction)
    }
    this.actions.splice(0, count)
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
    traversal[kind] = []
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
    const index = from.indexOf(action.transaction)
    if (index < 0) return
    from.splice(index, 1)
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
