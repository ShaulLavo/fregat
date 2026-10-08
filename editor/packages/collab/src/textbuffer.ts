// FugueMax ordering adapted from mweidner037/fugue at 31e74fea67f23add13a5d10f781c0d78edcd14da.
// Copyright (c) 2023 Matthew Weidner and Martin Kleppmann. MIT; see THIRD_PARTY_LICENSES.
import {
  applyCharIdEdit,
  charIdAt,
  charIdSpansInRange,
  createPieceTableSnapshot,
  locateCharId,
  materializePieceTableFullText,
  retainPieceTableSnapshot,
  retainCharIdPayloads,
  ReclaimedTextError,
  setCharIdVisibility,
} from '@singapore-editor/textbuffer'
import type { CharIdBoundary, PieceTableSnapshot } from '@singapore-editor/textbuffer'
import { CollabFailure } from './failure'
import { ceiling, compareId, floor, get, put } from './run-index'
import type { Index } from './run-index'
import { insertionOf, sameChar } from './types'
import {
  appliedEffect,
  effectPayloads,
  initialEffects,
  recordEffects,
  setEffectStates,
} from './textbuffer-effects'
import type { TextbufferEffects } from './textbuffer-effects'
import type {
  AuthorContext,
  CharId,
  CharacterIdentity,
  Engine,
  Envelope,
  Insert,
  LeftOrigin,
  OffsetEdit,
  RightOrigin,
} from './types'

type Side = 'L' | 'R'
export type PlacementRun = {
  readonly start: CharId
  readonly count: number
  readonly parent: LeftOrigin
  readonly side: Side
  readonly rightOrigin: RightOrigin
}
type Children = { readonly L: readonly CharId[]; readonly R: readonly CharId[] }
export type TextbufferSnapshot = {
  readonly buffer: PieceTableSnapshot
  readonly effects: TextbufferEffects
  readonly runs: Index<PlacementRun> | null
  readonly forks: Index<Children> | null
  readonly roots: Children
}
const emptyChildren: Children = { L: [], R: [] }
const endId = (run: PlacementRun): CharId => ({
  bunch: run.start.bunch,
  counter: run.start.counter + run.count - 1,
})

/** Text lives only in the piece table. Runs compress implicit right-child chains. */
export class TextbufferEngine implements Engine<TextbufferSnapshot> {
  private state: TextbufferSnapshot

  /** Bootstrap accepts a fresh, identity-enabled snapshot with one contiguous ID run. */
  constructor(
    buffer = createPieceTableSnapshot('', {
      normalized: true,
      charIds: { bunch: 'bootstrap:0', counter: 0 },
    }),
  ) {
    if (!buffer.charIds || buffer.consumed) throw new CollabFailure('invalid-bootstrap')
    retainPieceTableSnapshot(buffer)
    const spans = charIdSpansInRange(buffer, 0, buffer.length)
    if (
      spans.length > 1 ||
      buffer.buffers.nextBufferSequence !== 1 ||
      (buffer.root?.subtreeOriginalLength ?? 0) !== buffer.length
    )
      throw new CollabFailure('invalid-bootstrap')
    const span = spans[0]
    const run: PlacementRun | null = span
      ? { start: span.start, count: span.count, parent: 'start', side: 'R', rightOrigin: 'end' }
      : null
    this.state = {
      buffer,
      effects: initialEffects(span),
      runs: run ? put(null, run.start, run) : null,
      forks: null,
      roots: run ? { L: [], R: [run.start] } : emptyChildren,
    }
    this.retainPayloads(this.state)
  }

  text(): string {
    return materializePieceTableFullText(this.state.buffer)
  }
  characters(): readonly CharacterIdentity[] {
    const { buffer, runs } = this.state
    const result: CharacterIdentity[] = []
    const stack: Index<PlacementRun>[] = runs ? [runs] : []
    while (stack.length) {
      const node = stack.pop()!
      if (node.left) stack.push(node.left)
      if (node.right) stack.push(node.right)
      for (let unit = 0; unit < node.value.count; unit++) {
        const id = {
          bunch: node.value.start.bunch,
          counter: node.value.start.counter + unit,
        }
        const location = locateCharId(buffer, id)!
        result.push({ id, deleted: location.liveness === 'deleted', offset: location.offset })
      }
    }
    return result.sort((a, b) => compareId(a.id, b.id))
  }
  snapshot(): TextbufferSnapshot {
    retainPieceTableSnapshot(this.state.buffer)
    return this.state
  }
  restore(snapshot: TextbufferSnapshot): void {
    retainPieceTableSnapshot(snapshot.buffer)
    this.retainPayloads(snapshot)
    this.state = snapshot
  }
  visibleOffset(id: CharId): number | null {
    return locateCharId(this.state.buffer, id)?.offset ?? null
  }
  origins(offset: number): { readonly originLeft: LeftOrigin; readonly originRight: RightOrigin } {
    this.checkRange(offset, 0)
    const left = offset === 0 ? 'start' : charIdAt(this.state.buffer, offset - 1)!
    return { originLeft: left, originRight: this.successor(left) ?? 'end' }
  }
  author(edit: OffsetEdit, context: AuthorContext): Envelope {
    this.checkRange(edit.offset, edit.deleteCount)
    let spans
    try {
      spans = charIdSpansInRange(this.state.buffer, edit.offset, edit.offset + edit.deleteCount)
    } catch (cause) {
      if (cause instanceof RangeError) throw new CollabFailure('split-surrogate')
      throw cause
    }
    if (edit.deleteCount === 0 && edit.text.length === 0) throw new CollabFailure('empty-edit')
    const metadata = {
      document: context.document,
      epoch: context.epoch,
      id: { ...context.id },
      lamport: context.lamport,
      deps: context.deps.map((id) => ({ ...id })),
    }
    if (!edit.text.length) return { ...metadata, change: { kind: 'delete', spans } }
    const origins = this.origins(edit.offset)
    const insert = {
      ...origins,
      start: context.allocate(origins.originLeft, edit.text.length),
      text: edit.text,
    }
    if (edit.deleteCount === 0) return { ...metadata, change: { kind: 'insert', ...insert } }
    return { ...metadata, change: { kind: 'replace', spans, insert } }
  }

  apply(envelope: Envelope): void {
    if (appliedEffect(this.state.effects, envelope.id)) return
    const change = envelope.change
    const saved = this.state
    retainPieceTableSnapshot(saved.buffer)
    if (change.kind === 'setEffects') {
      if (change.command.actor !== envelope.id.actor || change.command.seq !== envelope.id.seq)
        throw new CollabFailure('invalid-effect-command')
      const result = setEffectStates(saved.effects, envelope.id, change.effects)
      let buffer
      try {
        buffer = setCharIdVisibility(saved.buffer, result.visibility)
      } catch (cause) {
        if (cause instanceof ReclaimedTextError)
          throw new CollabFailure('expired-character-payload')
        throw cause
      }
      const next = { ...saved, buffer, effects: result.state }
      this.retainPayloads(next)
      this.state = next
      return
    }
    const insert = insertionOf(change)
    this.validate(envelope)
    const deletions = change.kind === 'insert' ? [] : change.spans
    try {
      const at = insert ? this.integrate(insert) : null
      const effects = recordEffects(
        saved.effects,
        envelope.id,
        insert ? { start: insert.start, count: insert.text.length } : null,
        deletions,
      )
      const buffer = applyCharIdEdit(saved.buffer, {
        delete: deletions,
        ...(insert && at ? { insert: { start: insert.start, text: insert.text, at } } : {}),
      })
      const next = { ...this.state, buffer, effects }
      this.retainPayloads(next)
      this.state = next
    } catch (cause) {
      this.state = saved
      throw cause
    }
  }

  private retainPayloads(snapshot: TextbufferSnapshot): void {
    retainCharIdPayloads(snapshot.buffer, effectPayloads(snapshot.effects))
  }

  private checkRange(offset: number, count: number): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(count) ||
      offset < 0 ||
      count < 0 ||
      offset + count > this.state.buffer.length
    )
      throw new CollabFailure('invalid-offset')
  }
  private run(id: CharId): PlacementRun {
    const found = floor(this.state.runs, id)?.value
    if (!found || found.start.bunch !== id.bunch || id.counter >= found.start.counter + found.count)
      throw new CollabFailure('unknown-character')
    return found
  }
  private children(id: LeftOrigin): Children {
    return id === 'start' ? this.state.roots : (get(this.state.forks, id) ?? emptyChildren)
  }
  private setChildren(id: LeftOrigin, children: Children): void {
    if (id === 'start') {
      this.state = { ...this.state, roots: children }
      return
    }
    this.state = { ...this.state, forks: put(this.state.forks, id, children) }
  }
  private saveRun(run: PlacementRun): void {
    this.state = { ...this.state, runs: put(this.state.runs, run.start, run) }
  }

  /** Split an implicit chain only where an explicit child needs its own boundary. */
  private splitBefore(id: CharId): void {
    const run = this.run(id)
    if (sameChar(id, run.start)) return
    const count = id.counter - run.start.counter
    const prefix = { ...run, count }
    const parent = endId(prefix)
    const start = { ...id }
    this.saveRun(prefix)
    this.saveRun({ ...run, start, count: run.count - count, parent, side: 'R' })
    this.setChildren(parent, { L: [], R: [start] })
  }
  private isolate(id: LeftOrigin): void {
    if (id === 'start') return
    this.splitBefore(id)
    const run = this.run(id)
    if (run.count > 1) this.splitBefore({ bunch: id.bunch, counter: id.counter + 1 })
  }
  private comparePosition(a: LeftOrigin | RightOrigin, b: LeftOrigin | RightOrigin): number {
    if (sameChar(a, b)) return 0
    if (a === 'start' || b === 'end') return -1
    if (a === 'end' || b === 'start') return 1
    const left = locateCharId(this.state.buffer, a)
    const right = locateCharId(this.state.buffer, b)
    if (!left || !right) throw new CollabFailure('unknown-character')
    return left.piece.order - right.piece.order || left.unit - right.unit
  }
  private ancestor(ancestor: LeftOrigin, descendant: CharId): boolean {
    if (ancestor === 'start') return true
    let current: LeftOrigin = descendant
    while (current !== 'start') {
      const run = this.run(current)
      if (
        ancestor.bunch === current.bunch &&
        ancestor.counter >= run.start.counter &&
        ancestor.counter < current.counter
      )
        return true
      if (sameChar(ancestor, run.parent)) return true
      current = run.parent
    }
    return false
  }
  private first(id: CharId): CharId {
    let current = id
    while (this.children(current).L.length) current = this.children(current).L[0]!
    return current
  }
  private last(id: CharId): CharId {
    let current = endId(this.run(id))
    while (this.children(current).R.length)
      current = endId(this.run(this.children(current).R.at(-1)!))
    return current
  }
  private successor(id: LeftOrigin): CharId | null {
    if (id === 'start') {
      const child = this.state.roots.R[0]
      return child ? this.first(child) : null
    }
    const initial = this.run(id)
    if (id.counter < endId(initial).counter) return { bunch: id.bunch, counter: id.counter + 1 }
    const child = this.children(id).R[0]
    if (child) return this.first(child)
    let run = initial
    while (true) {
      const siblings = this.children(run.parent)[run.side]
      const index = siblings.findIndex((sibling) => sameChar(sibling, run.start))
      const next = siblings[index + 1]
      if (next) return this.first(next)
      if (run.side === 'L' && run.parent !== 'start') return run.parent
      if (run.parent === 'start') return null
      run = this.run(run.parent)
    }
  }

  private integrate(insert: Insert): CharIdBoundary {
    const side: Side =
      insert.originRight !== 'end' && this.ancestor(insert.originLeft, insert.originRight)
        ? 'L'
        : 'R'
    const selected = side === 'L' ? (insert.originRight as CharId) : insert.originLeft
    const parent = selected === 'start' ? selected : { ...selected }
    const start = { ...insert.start }
    const previous = parent === 'start' ? null : this.run(parent)
    const children = this.children(parent)
    const extendsRun =
      side === 'R' &&
      parent !== 'start' &&
      previous &&
      sameChar(parent, endId(previous)) &&
      children.L.length === 0 &&
      children.R.length === 0 &&
      sameChar(previous.rightOrigin, insert.originRight) &&
      insert.start.bunch === parent.bunch &&
      insert.start.counter === parent.counter + 1
    if (extendsRun) {
      this.saveRun({ ...previous, count: previous.count + insert.text.length })
      return { after: parent }
    }
    this.isolate(parent)
    const siblings = this.children(parent)[side]
    const index = siblings.findIndex((sibling) => {
      if (side === 'L') return compareId(insert.start, sibling) < 0
      const difference = this.comparePosition(this.run(sibling).rightOrigin, insert.originRight)
      return difference < 0 || (difference === 0 && compareId(insert.start, sibling) < 0)
    })
    const position = index === -1 ? siblings.length : index
    const at = this.boundary(parent, side, siblings, position)
    this.setChildren(parent, {
      ...this.children(parent),
      [side]: [...siblings.slice(0, position), start, ...siblings.slice(position)],
    })
    this.saveRun({
      start,
      count: insert.text.length,
      parent,
      side,
      rightOrigin: insert.originRight === 'end' ? 'end' : { ...insert.originRight },
    })
    return at
  }

  private boundary(
    parent: LeftOrigin,
    side: Side,
    siblings: readonly CharId[],
    position: number,
  ): CharIdBoundary {
    const next = siblings[position]
    if (next) return { before: this.first(next) }
    if (side === 'L' && parent !== 'start') return { before: parent }
    return { after: position ? this.last(siblings[position - 1]!) : parent }
  }

  private validate(envelope: Envelope): void {
    const change = envelope.change
    if (change.kind === 'setEffects') return
    for (const span of change.kind === 'insert' ? [] : change.spans) {
      checkId(span.start)
      if (
        !Number.isSafeInteger(span.count) ||
        span.count <= 0 ||
        !Number.isSafeInteger(span.start.counter + span.count)
      )
        throw new CollabFailure('invalid-span')
      let counter = span.start.counter
      while (counter < span.start.counter + span.count) {
        const run = this.run({ bunch: span.start.bunch, counter })
        counter = Math.min(span.start.counter + span.count, run.start.counter + run.count)
      }
    }
    const insert = insertionOf(change)
    if (!insert) return
    checkId(insert.start)
    if (!insert.text.length || !Number.isSafeInteger(insert.start.counter + insert.text.length))
      throw new CollabFailure('invalid-insert')
    if (insert.originLeft !== 'start') this.run(insert.originLeft)
    if (insert.originRight !== 'end') this.run(insert.originRight)
    if (this.comparePosition(insert.originLeft, insert.originRight) >= 0)
      throw new CollabFailure('reversed-origins')
    const previous = floor(this.state.runs, insert.start)?.value
    const next = ceiling(this.state.runs, insert.start)?.value
    if (
      (previous &&
        previous.start.bunch === insert.start.bunch &&
        endId(previous).counter >= insert.start.counter) ||
      (next &&
        next.start.bunch === insert.start.bunch &&
        next.start.counter < insert.start.counter + insert.text.length)
    )
      throw new CollabFailure('duplicate-character')
  }
}
function checkId(id: CharId): void {
  if (!id.bunch || !Number.isSafeInteger(id.counter) || id.counter < 0)
    throw new CollabFailure('invalid-character-id')
}
