import { CollabFailure } from './failure'
import { editKey } from './types'
import type { CharId, EditId, Effect, IdSpan } from './types'

type ProvenanceSpan = {
  readonly start: number
  readonly count: number
  readonly insert: string
  readonly deletes: readonly string[]
}
export type EffectsSnapshot = {
  readonly runs: readonly (readonly [string, readonly ProvenanceSpan[]])[]
  readonly states: readonly (readonly [string, boolean])[]
  readonly commands: readonly string[]
}

/** Provenance splits only at edit boundaries, independently of the placement tree. */
export class Effects {
  private runs = new Map<string, readonly ProvenanceSpan[]>()
  private states = new Map<string, boolean>()
  private commands = new Set<string>()

  applied(id: EditId): boolean {
    const key = editKey(id)
    return this.states.has(key) || this.commands.has(key)
  }

  visible(id: CharId): boolean {
    const spans = this.runs.get(id.bunch) ?? []
    const span = spans.find(
      (item) => item.start <= id.counter && id.counter < item.start + item.count,
    )
    return (
      span !== undefined &&
      this.states.get(span.insert) === true &&
      span.deletes.every((key) => this.states.get(key) === false)
    )
  }

  insert(id: EditId, span: IdSpan): void {
    const key = editKey(id)
    this.states.set(key, true)
    const spans = this.runs.get(span.start.bunch) ?? []
    this.runs.set(
      span.start.bunch,
      [
        ...spans,
        {
          start: span.start.counter,
          count: span.count,
          insert: key,
          deletes: [],
        },
      ].sort((a, b) => a.start - b.start),
    )
  }

  delete(id: EditId, targets: readonly IdSpan[]): void {
    const key = editKey(id)
    this.states.set(key, true)
    for (const target of targets) {
      const spans = this.runs.get(target.start.bunch) ?? []
      this.runs.set(
        target.start.bunch,
        spans.flatMap((span) => deleteSpan(span, target, key)),
      )
    }
  }

  set(command: EditId, effects: readonly Effect[]): void {
    const targets = new Map<string, boolean>()
    for (const effect of effects) {
      const key = editKey(effect.op)
      if (effect.op.actor !== command.actor) throw new CollabFailure('foreign-effect')
      if (!this.states.has(key)) throw new CollabFailure('unknown-effect')
      if (typeof effect.active !== 'boolean') throw new CollabFailure('invalid-effect-state')
      if (targets.has(key) && targets.get(key) !== effect.active)
        throw new CollabFailure('conflicting-effects')
      targets.set(key, effect.active)
    }
    if (targets.size === 0) throw new CollabFailure('empty-effects')
    for (const [key, active] of targets) this.states.set(key, active)
    this.commands.add(editKey(command))
  }

  snapshot(): EffectsSnapshot {
    return {
      runs: [...this.runs].map(([bunch, spans]) => [
        bunch,
        spans.map((span) => ({ ...span, deletes: [...span.deletes] })),
      ]),
      states: [...this.states],
      commands: [...this.commands],
    }
  }

  restore(snapshot: EffectsSnapshot): void {
    this.runs = new Map(
      snapshot.runs.map(([bunch, spans]) => [
        bunch,
        spans.map((span) => ({ ...span, deletes: [...span.deletes] })),
      ]),
    )
    this.states = new Map(snapshot.states)
    this.commands = new Set(snapshot.commands)
  }
}

function deleteSpan(span: ProvenanceSpan, target: IdSpan, key: string): readonly ProvenanceSpan[] {
  const start = Math.max(span.start, target.start.counter)
  const end = Math.min(span.start + span.count, target.start.counter + target.count)
  if (start >= end || span.deletes.includes(key)) return [span]
  const result: ProvenanceSpan[] = []
  if (span.start < start) result.push({ ...span, count: start - span.start })
  result.push({ ...span, start, count: end - start, deletes: [...span.deletes, key] })
  if (end < span.start + span.count)
    result.push({ ...span, start: end, count: span.start + span.count - end })
  return result
}
