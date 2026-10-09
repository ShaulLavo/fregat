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

export type BrowserEdit = EditEnvelope<{ readonly text: string }>
export const browserGenesis = { depth: 0, hash: 'browser-genesis' }

/** A test-only ordered text log isolates transport behavior from character placement. */
export class BrowserEngine implements DocumentEngine<BrowserEdit> {
  private history: Confirmation<BrowserEdit>[] = []
  get text(): string {
    return this.history
      .filter((record) => record.outcome.kind === 'accepted')
      .map((record) => record.edit.change.text)
      .join('')
  }
  checkpoint(): Checkpoint {
    return this.history.at(-1) ?? browserGenesis
  }
  outcome(id: EditId): Outcome | undefined {
    return this.history.find((record) => editKey(record.id) === editKey(id))?.outcome
  }
  sequence(edit: BrowserEdit, rejection?: string): Confirmation<BrowserEdit> {
    const tip = this.checkpoint()
    const record: Confirmation<BrowserEdit> = {
      depth: tip.depth + 1,
      predecessor: tip.hash,
      hash: `${tip.hash}/${editKey(edit.id)}`,
      id: edit.id,
      edit,
      outcome: rejection ? { kind: 'rejected', reason: rejection } : { kind: 'accepted' },
    }
    this.apply(record)
    return record
  }
  apply(record: Confirmation<BrowserEdit>): boolean {
    const tip = this.checkpoint()
    if (
      this.outcome(record.id) ||
      record.depth !== tip.depth + 1 ||
      record.predecessor !== tip.hash
    )
      return false
    this.history.push(record)
    return true
  }
  sequenceBatch(
    edits: readonly { readonly edit: BrowserEdit; readonly rejection?: string }[],
  ): readonly Confirmation<BrowserEdit>[] {
    return edits.map(({ edit, rejection }) => this.sequence(edit, rejection))
  }
  applyBatch(records: readonly Confirmation<BrowserEdit>[]): boolean {
    return records.every((record) => this.apply(record))
  }
  exportHistory(from: Checkpoint): readonly Confirmation<BrowserEdit>[] | undefined {
    if (
      !sameTip(
        from,
        from.depth === 0 ? browserGenesis : (this.history[from.depth - 1] ?? browserGenesis),
      )
    )
      return undefined
    return this.history.slice(from.depth)
  }
  verify(history: readonly Confirmation<BrowserEdit>[], tip: Checkpoint): boolean {
    const engine = new BrowserEngine()
    return history.every((record) => engine.apply(record)) && sameTip(engine.checkpoint(), tip)
  }
  install(history: readonly Confirmation<BrowserEdit>[]): void {
    this.history = [...history]
  }
  uniquePending(history: readonly Confirmation<BrowserEdit>[]): readonly BrowserEdit[] {
    return history.filter((record) => !this.outcome(record.id)).map((record) => record.edit)
  }
}
