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
type Action =
  | { readonly kind: 'record'; readonly edit: EditId; readonly transaction: string }
  | { readonly kind: 'undo' | 'redo'; readonly command: EditId; readonly transaction: string }
  | { readonly kind: 'clearUndo' }
  | { readonly kind: 'clearRedo' }

/** Local history captures user work once; host replay only reports rejected IDs. */
export class UndoManager {
  private transactions = new Map<string, Transaction>()
  private undoStack: string[] = []
  private redoStack: string[] = []
  private actions: Action[] = []
  private rejected = new Set<string>()
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
      undo: this.undoStack.map((key) => this.transaction(key)),
      redo: this.redoStack.map((key) => this.transaction(key)),
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
    this.undoStack = []
    this.actions.push({ kind: 'clearUndo' })
  }

  clearRedo(): void {
    this.seal()
    this.redoStack = []
    this.actions.push({ kind: 'clearRedo' })
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
      this.undoStack.push(key)
    }
    this.transactions.get(key)!.edits.push({ ...envelope.id })
    this.actions.push({ kind: 'record', edit: { ...envelope.id }, transaction: key })
    this.redoStack = []
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
    if (!this.group || envelope.id.actor === this.actor) return
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
    for (const id of ids) this.rejected.add(editKey(id))
    this.seal()
    this.undoStack = []
    this.redoStack = []
    for (const action of this.actions) this.rebuild(action)
    const retained = (key: string) => this.transaction(key).edits.length > 0
    this.undoStack = this.undoStack.filter(retained)
    this.redoStack = this.redoStack.filter(retained)
  }

  private move(kind: 'undo' | 'redo'): Envelope | null {
    const from = kind === 'undo' ? this.undoStack : this.redoStack
    const to = kind === 'undo' ? this.redoStack : this.undoStack
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
      this.actions.push({ kind, command: { ...envelope.id }, transaction: key })
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
      edits: transaction.edits
        .filter((id) => !this.rejected.has(editKey(id)))
        .map((id) => ({ ...id })),
    }
  }

  private rebuild(action: Action): void {
    if (action.kind === 'clearUndo') {
      this.undoStack = []
      return
    }
    if (action.kind === 'clearRedo') {
      this.redoStack = []
      return
    }
    if (action.kind === 'record') {
      if (this.rejected.has(editKey(action.edit))) return
      if (!this.undoStack.includes(action.transaction)) this.undoStack.push(action.transaction)
      this.redoStack = []
      return
    }
    if (this.rejected.has(editKey(action.command))) return
    const from = action.kind === 'undo' ? this.undoStack : this.redoStack
    const to = action.kind === 'undo' ? this.redoStack : this.undoStack
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
