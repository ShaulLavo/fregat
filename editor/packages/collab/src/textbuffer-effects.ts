import { CollabFailure } from './failure'
import { compareId, floor, get, put } from './run-index'
import type { Index } from './run-index'
import type { CharId, EditId, Effect, IdSpan } from './types'

type Provenance = IdSpan & {
  readonly insertion: EditId | null
  readonly deletions: readonly EditId[]
}
type Operation =
  | { readonly kind: 'edit'; readonly active: boolean; readonly spans: readonly IdSpan[] }
  | { readonly kind: 'command' }
export type TextbufferEffects = {
  readonly provenance: Index<Provenance> | null
  readonly operations: Index<Operation> | null
}
export type VisibilityChange = IdSpan & { readonly visible: boolean }
const operationKey = (id: EditId): CharId => ({ bunch: id.actor, counter: id.seq })

export function initialEffects(span?: IdSpan): TextbufferEffects {
  return {
    provenance: span ? put(null, span.start, { ...span, insertion: null, deletions: [] }) : null,
    operations: null,
  }
}
/** Every retained provenance span remains addressable by a future effect command. */
export function effectPayloads(state: TextbufferEffects): Iterable<IdSpan> {
  const { provenance } = state
  return {
    *[Symbol.iterator]() {
      const stack: Index<Provenance>[] = provenance ? [provenance] : []
      while (stack.length) {
        const node = stack.pop()!
        yield node.value
        if (node.left) stack.push(node.left)
        if (node.right) stack.push(node.right)
      }
    },
  }
}

export function appliedEffect(state: TextbufferEffects, id: EditId): boolean {
  return get(state.operations, operationKey(id)) !== null
}

function provenanceAt(state: TextbufferEffects, id: CharId): Provenance {
  const span = floor(state.provenance, id)?.value
  if (!span || span.start.bunch !== id.bunch || id.counter >= span.start.counter + span.count)
    throw new CollabFailure('unknown-character')
  return span
}
function active(state: TextbufferEffects, id: EditId): boolean {
  const operation = get(state.operations, operationKey(id))
  return operation?.kind === 'edit' && operation.active
}
function visible(state: TextbufferEffects, span: Provenance): boolean {
  return (
    (span.insertion === null || active(state, span.insertion)) &&
    !span.deletions.some((id) => active(state, id))
  )
}
function copySpan(span: IdSpan): IdSpan {
  return { start: { ...span.start }, count: span.count }
}

/** Placement can coalesce freely: operation boundaries live in this separate persistent index. */
export function recordEffects(
  state: TextbufferEffects,
  id: EditId,
  insertion: IdSpan | null,
  deletions: readonly IdSpan[],
): TextbufferEffects {
  const op = { ...id }
  let next: TextbufferEffects = {
    ...state,
    operations: put(state.operations, operationKey(op), {
      kind: 'edit',
      active: true,
      spans: [...(insertion ? [copySpan(insertion)] : []), ...deletions.map(copySpan)],
    }),
  }
  if (insertion) {
    const span = { ...copySpan(insertion), insertion: op, deletions: [] }
    next = { ...next, provenance: put(next.provenance, span.start, span) }
  }
  for (const target of mergeSpans(deletions)) next = recordDeletion(next, op, target)
  return next
}
function recordDeletion(state: TextbufferEffects, id: EditId, target: IdSpan): TextbufferEffects {
  let next = state
  const end = target.start.counter + target.count
  let counter = target.start.counter
  while (counter < end) {
    const span = provenanceAt(next, { bunch: target.start.bunch, counter })
    const stop = Math.min(end, span.start.counter + span.count)
    if (span.start.counter < counter)
      next = {
        ...next,
        provenance: put(next.provenance, span.start, {
          ...span,
          count: counter - span.start.counter,
        }),
      }
    const middle: Provenance = {
      ...span,
      start: { bunch: target.start.bunch, counter },
      count: stop - counter,
      deletions: [...span.deletions, id],
    }
    next = { ...next, provenance: put(next.provenance, middle.start, middle) }
    if (stop < span.start.counter + span.count) {
      const tail = {
        ...span,
        start: { bunch: target.start.bunch, counter: stop },
        count: span.start.counter + span.count - stop,
      }
      next = { ...next, provenance: put(next.provenance, tail.start, tail) }
    }
    counter = stop
  }
  return next
}

export function setEffectStates(
  state: TextbufferEffects,
  command: EditId,
  effects: readonly Effect[],
): { readonly state: TextbufferEffects; readonly visibility: readonly VisibilityChange[] } {
  const desired = new Map<
    string,
    { readonly id: EditId; readonly active: boolean; readonly spans: readonly IdSpan[] }
  >()
  for (const effect of effects) {
    const key = JSON.stringify([effect.op.actor, effect.op.seq])
    if (effect.op.actor !== command.actor) throw new CollabFailure('foreign-effect')
    const operation = get(state.operations, operationKey(effect.op))
    if (operation?.kind !== 'edit') throw new CollabFailure('unknown-effect')
    if (typeof effect.active !== 'boolean') throw new CollabFailure('invalid-effect-state')
    if (desired.has(key) && desired.get(key)!.active !== effect.active)
      throw new CollabFailure('conflicting-effects')
    desired.set(key, { id: { ...effect.op }, active: effect.active, spans: operation.spans })
  }
  if (!desired.size) throw new CollabFailure('empty-effects')
  let operations = state.operations
  const affected: IdSpan[] = []
  for (const operation of desired.values()) {
    operations = put(operations, operationKey(operation.id), {
      kind: 'edit',
      active: operation.active,
      spans: operation.spans,
    })
    affected.push(...operation.spans)
  }
  operations = put(operations, operationKey(command), { kind: 'command' })
  const next = { ...state, operations }
  const visibility: VisibilityChange[] = []
  for (const target of mergeSpans(affected)) {
    let counter = target.start.counter
    const end = counter + target.count
    while (counter < end) {
      const span = provenanceAt(state, { bunch: target.start.bunch, counter })
      const stop = Math.min(end, span.start.counter + span.count)
      const live = visible(next, span)
      if (live !== visible(state, span))
        visibility.push({
          start: { bunch: target.start.bunch, counter },
          count: stop - counter,
          visible: live,
        })
      counter = stop
    }
  }
  return { state: next, visibility }
}
function mergeSpans(spans: readonly IdSpan[]): readonly IdSpan[] {
  const result: IdSpan[] = []
  for (const span of spans.toSorted((a, b) => compareId(a.start, b.start))) {
    const previous = result.at(-1)
    if (
      previous &&
      previous.start.bunch === span.start.bunch &&
      span.start.counter <= previous.start.counter + previous.count
    ) {
      result[result.length - 1] = {
        start: previous.start,
        count:
          Math.max(previous.start.counter + previous.count, span.start.counter + span.count) -
          previous.start.counter,
      }
      continue
    }
    result.push(span)
  }
  return result
}
