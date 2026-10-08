import { createHash } from 'node:crypto'
import {
  editKey,
  sameTip,
  type Checkpoint,
  type Confirmation,
  type DocumentEngine,
  type EditEnvelope,
  type EditId,
  type Outcome,
} from '../src/protocol'

export type ToyEdit = EditEnvelope<{ readonly text: string; readonly reject?: boolean }>
export const genesis = { depth: 0, hash: 'simulation-genesis' }

function hash(record: Omit<Confirmation<ToyEdit>, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}

/** Deliberately uses an ordered log, with no character-placement or text CRDT behavior. */
export class ToyEngine implements DocumentEngine<ToyEdit> {
  private history: Confirmation<ToyEdit>[] = []
  private readonly outcomes = new Map<string, Outcome>()
  get text(): string {
    return this.history
      .filter((record) => record.outcome.kind === 'accepted')
      .map((record) => record.edit.change.text)
      .join('')
  }
  checkpoint(): Checkpoint {
    const last = this.history.at(-1)
    return last ? { depth: last.depth, hash: last.hash } : genesis
  }
  outcome(id: EditId): Outcome | undefined {
    return this.outcomes.get(editKey(id))
  }
  sequence(edit: ToyEdit, rejection?: string): Confirmation<ToyEdit> {
    const existing = this.history.find((record) => editKey(record.id) === editKey(edit.id))
    if (existing) return existing
    const tip = this.checkpoint()
    const rejectedDependency = edit.deps.some((id) => this.outcome(id)?.kind === 'rejected')
    const outcome: Outcome =
      rejection || edit.change.reject || rejectedDependency
        ? { kind: 'rejected', reason: rejection ?? 'Unresolved reference' }
        : { kind: 'accepted' }
    const record = { depth: tip.depth + 1, predecessor: tip.hash, id: edit.id, edit, outcome }
    const confirmation = { ...record, hash: hash(record) }
    if (!this.apply(confirmation)) throw new TypeError('Invalid simulated sequence')
    return confirmation
  }
  apply(record: Confirmation<ToyEdit>): boolean {
    const tip = this.checkpoint()
    if (
      record.depth !== tip.depth + 1 ||
      record.predecessor !== tip.hash ||
      this.outcome(record.id)
    )
      return false
    const { hash: digest, ...body } = record
    if (digest !== hash(body) || editKey(record.id) !== editKey(record.edit.id)) return false
    if (
      record.outcome.kind === 'accepted' &&
      record.edit.deps.some((id) => this.outcome(id)?.kind !== 'accepted')
    )
      return false
    this.history.push(record)
    this.outcomes.set(editKey(record.id), record.outcome)
    return true
  }
  exportHistory(from: Checkpoint): readonly Confirmation<ToyEdit>[] | undefined {
    const checkpoint = from.depth === 0 ? genesis : this.history[from.depth - 1]
    if (!checkpoint || !sameTip(checkpoint, from)) return undefined
    return this.history.slice(from.depth)
  }
  verify(history: readonly Confirmation<ToyEdit>[], tip: Checkpoint): boolean {
    const engine = new ToyEngine()
    return history.every((record) => engine.apply(record)) && sameTip(engine.checkpoint(), tip)
  }
  install(history: readonly Confirmation<ToyEdit>[]): void {
    const tip = history.at(-1) ?? genesis
    if (!this.verify(history, tip)) throw new TypeError('Invalid simulated history')
    this.history = [...history]
    this.outcomes.clear()
    for (const record of history) this.outcomes.set(editKey(record.id), record.outcome)
  }
  uniquePending(history: readonly Confirmation<ToyEdit>[]): readonly ToyEdit[] {
    return history.filter((record) => !this.outcome(record.id)).map((record) => record.edit)
  }
}
