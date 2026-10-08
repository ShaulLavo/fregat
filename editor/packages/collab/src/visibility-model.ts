import { CollabFailure } from './failure'
import type { ReferenceEngine } from './reference'
import { charKey, editKey, insertionOf } from './types'
import type { Envelope } from './types'

type Character = {
  readonly value: string
  readonly insertion: string
  readonly deletions: readonly string[]
}

/** Scalar verification model, independent of the engine's span provenance and visibility. */
export class VisibilityModel {
  private characters = new Map<string, Character>()
  private states = new Map<string, boolean>()
  private applied = new Set<string>()

  fork(): VisibilityModel {
    const model = new VisibilityModel()
    model.characters = new Map(this.characters)
    model.states = new Map(this.states)
    model.applied = new Set(this.applied)
    return model
  }

  apply(envelope: Envelope): void {
    const operation = editKey(envelope.id)
    if (this.applied.has(operation)) return
    this.applied.add(operation)
    const change = envelope.change
    if (change.kind === 'setEffects') {
      for (const effect of change.effects) this.states.set(editKey(effect.op), effect.active)
      return
    }
    this.states.set(operation, true)
    const insert = insertionOf(change)
    if (insert) {
      for (let index = 0; index < insert.text.length; index++) {
        const id = { bunch: insert.start.bunch, counter: insert.start.counter + index }
        this.characters.set(charKey(id), {
          value: insert.text[index]!,
          insertion: operation,
          deletions: [],
        })
      }
    }
    if (change.kind === 'insert') return
    for (const span of change.spans)
      this.delete(span.start.bunch, span.start.counter, span.count, operation)
  }

  check(engine: ReferenceEngine, context: string): void {
    const nodes = engine.snapshot().nodes
    if (nodes.length !== this.characters.size)
      throw new CollabFailure(`oracle-identities-${context}`)
    const visible = new Map<string, string>()
    for (const node of nodes) {
      const key = charKey(node.id)
      const character = this.characters.get(key)
      if (!character) throw new CollabFailure(`oracle-missing-id-${context}-${key}`)
      const live =
        this.states.get(character.insertion) === true &&
        !character.deletions.some((deletion) => this.states.get(deletion) === true)
      if (node.deleted !== !live) throw new CollabFailure(`oracle-visibility-${context}-${key}`)
      if (!live) continue
      visible.set(key, character.value)
    }
    // Placement has its own oracle; this model independently decides which IDs contribute text.
    const ordered = engine.orderedIds().map(charKey)
    if (
      ordered.length !== this.characters.size ||
      new Set(ordered).size !== this.characters.size ||
      ordered.some((key) => !this.characters.has(key))
    )
      throw new CollabFailure(`oracle-order-identities-${context}`)
    if (engine.text() !== ordered.map((key) => visible.get(key) ?? '').join(''))
      throw new CollabFailure(`oracle-text-${context}`)
  }

  private delete(bunch: string, start: number, count: number, operation: string): void {
    for (let counter = start; counter < start + count; counter++) {
      const key = charKey({ bunch, counter })
      const character = this.characters.get(key)
      if (!character) throw new CollabFailure('oracle-unknown-delete')
      if (character.deletions.includes(operation)) continue
      this.characters.set(key, { ...character, deletions: [...character.deletions, operation] })
    }
  }
}
