// Adapted from mweidner037/fugue, fugue-max-simple/src/index.ts at 31e74fea67f23add13a5d10f781c0d78edcd14da.
// Copyright (c) 2023 Matthew Weidner and Martin Kleppmann. MIT; see THIRD_PARTY_LICENSES.
import { CollabFailure } from './failure'
import { Effects } from './effects'
import type { EffectsSnapshot } from './effects'
import { charKey, insertionOf } from './types'
import type {
  AuthorContext,
  CharId,
  CharacterIdentity,
  Engine,
  Envelope,
  Effect,
  IdSpan,
  Insert,
  LeftOrigin,
  OffsetEdit,
  RightOrigin,
} from './types'

type Node = {
  readonly id: CharId | 'start'
  readonly value: string
  readonly parent: Node | null
  readonly side: 'L' | 'R'
  readonly rightOrigin: Node | null
  readonly left: Node[]
  readonly right: Node[]
}
type SavedNode = {
  readonly id: CharId
  readonly value: string
  readonly parent: LeftOrigin
  readonly side: 'L' | 'R'
  readonly rightOrigin: RightOrigin
  readonly deleted: boolean
}
export type ReferenceSnapshot = {
  readonly nodes: readonly SavedNode[]
  readonly effects: EffectsSnapshot
}

export class ReferenceEngine implements Engine<ReferenceSnapshot> {
  private root = rootNode()
  private nodes = new Map<string, Node>()
  private effects = new Effects()

  changesBetween(snapshot: ReferenceSnapshot) {
    const previous = new ReferenceEngine()
    previous.restore(snapshot)
    const before = previous.text(),
      after = this.text()
    let from = 0
    while (
      from < before.length &&
      from < after.length &&
      before.charCodeAt(from) === after.charCodeAt(from)
    )
      from++
    if (from === before.length && from === after.length) return []
    let suffix = 0
    while (
      suffix < Math.min(before.length, after.length) - from &&
      before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
    )
      suffix++
    return [{ from, to: before.length - suffix, text: after.slice(from, after.length - suffix) }]
  }
  text(): string {
    return this.ordered()
      .filter((node) => this.effects.visible(node.id as CharId))
      .map((node) => node.value)
      .join('')
  }

  characters(): readonly CharacterIdentity[] {
    let offset = 0
    return this.ordered()
      .map((node) => {
        const id = node.id as CharId
        const identity = {
          id: { bunch: id.bunch, counter: id.counter },
          deleted: !this.effects.visible(id),
          offset,
        }
        if (this.effects.visible(id)) offset++
        return identity
      })
      .sort((a, b) => compareIds(a.id, b.id))
  }

  /** Retained IDs in placement order, including hidden characters. */
  orderedIds(): readonly CharId[] {
    return this.ordered().map((node) => ({ ...(node.id as CharId) }))
  }

  /** Hidden IDs resolve to their retained gap; only unknown IDs return null. */
  visibleOffset(id: CharId): number | null {
    let offset = 0
    for (const node of this.ordered()) {
      if (charKey(node.id as CharId) === charKey(id)) return offset
      if (this.effects.visible(node.id as CharId)) offset++
    }
    return null
  }

  origins(offset: number): { readonly originLeft: LeftOrigin; readonly originRight: RightOrigin } {
    const ordered = this.ordered()
    const visible = ordered.filter((node) => this.effects.visible(node.id as CharId))
    checkRange(offset, 0, visible.length)
    const left = offset === 0 ? this.root : visible[offset - 1]!
    const next = ordered[ordered.indexOf(left) + 1]
    return { originLeft: left.id, originRight: (next?.id as CharId | undefined) ?? 'end' }
  }

  author(edit: OffsetEdit, context: AuthorContext): Envelope {
    const text = this.text()
    checkRange(edit.offset, edit.deleteCount, text.length)
    checkBoundary(text, edit.offset)
    checkBoundary(text, edit.offset + edit.deleteCount)
    if (edit.deleteCount === 0 && edit.text.length === 0) throw new CollabFailure('empty-edit')
    const spans = this.spans(edit.offset, edit.deleteCount)
    if (edit.text.length === 0) return { ...metadata(context), change: { kind: 'delete', spans } }
    const origins = this.origins(edit.offset)
    const insert: Insert = {
      ...origins,
      start: context.allocate(origins.originLeft, edit.text.length),
      text: edit.text,
    }
    if (edit.deleteCount === 0)
      return { ...metadata(context), change: { kind: 'insert', ...insert } }
    return { ...metadata(context), change: { kind: 'replace', spans, insert } }
  }

  apply(envelope: Envelope): void {
    if (this.effects.applied(envelope.id)) return
    const change = envelope.change
    if (change.kind === 'setEffects') {
      if (change.command.actor !== envelope.id.actor || change.command.seq !== envelope.id.seq)
        throw new CollabFailure('invalid-effect-command')
      this.effects.set(envelope.id, change.effects)
      return
    }
    const insert = insertionOf(change)
    const spans = change.kind === 'insert' ? [] : change.spans
    // Validate the whole transaction before touching visibility or adding tree nodes.
    this.validateSpans(spans)
    if (insert) this.validateInsert(insert)
    if (insert) {
      this.insert(insert)
      this.effects.insert(envelope.id, { start: insert.start, count: insert.text.length })
    }
    if (change.kind !== 'insert') this.effects.delete(envelope.id, spans)
  }

  snapshot(): ReferenceSnapshot {
    // Creation order keeps parents and right origins before their dependants during restore.
    return {
      effects: this.effects.snapshot(),
      nodes: [...this.nodes.values()].map((node) => ({
        id: { ...(node.id as CharId) },
        value: node.value,
        parent: copyLeft(node.parent!.id),
        side: node.side,
        rightOrigin: node.rightOrigin ? { ...(node.rightOrigin.id as CharId) } : 'end',
        deleted: !this.effects.visible(node.id as CharId),
      })),
    }
  }

  projectEffects(effects: readonly Effect[]): ReferenceSnapshot {
    const snapshot = this.snapshot()
    const projected = new Effects()
    projected.restore(this.effects.project(effects))
    return {
      effects: projected.snapshot(),
      nodes: snapshot.nodes.map((node) => ({ ...node, deleted: !projected.visible(node.id) })),
    }
  }

  restore(snapshot: ReferenceSnapshot): void {
    this.root = rootNode()
    this.nodes = new Map()
    this.effects.restore(snapshot.effects)
    for (const saved of snapshot.nodes) {
      this.add(
        saved.id,
        saved.value,
        this.get(saved.parent),
        saved.side,
        saved.rightOrigin === 'end' ? null : this.get(saved.rightOrigin),
      )
    }
  }

  private spans(offset: number, count: number): readonly IdSpan[] {
    const selected = this.ordered()
      .filter((node) => this.effects.visible(node.id as CharId))
      .slice(offset, offset + count)
    const spans: { start: CharId; count: number }[] = []
    for (const node of selected) {
      const id = node.id as CharId
      const last = spans.at(-1)
      if (last && last.start.bunch === id.bunch && last.start.counter + last.count === id.counter) {
        last.count++
        continue
      }
      spans.push({ start: { ...id }, count: 1 })
    }
    return spans
  }

  private get(id: LeftOrigin): Node {
    if (id === 'start') return this.root
    const node = this.nodes.get(charKey(id))
    if (!node) throw new CollabFailure('unknown-character')
    return node
  }

  private validateSpans(spans: readonly IdSpan[]): void {
    for (const span of spans) {
      checkId(span.start)
      if (
        !Number.isSafeInteger(span.count) ||
        span.count <= 0 ||
        !Number.isSafeInteger(span.start.counter + span.count)
      ) {
        throw new CollabFailure('invalid-span')
      }
      for (let i = 0; i < span.count; i++)
        this.get({ bunch: span.start.bunch, counter: span.start.counter + i })
    }
  }

  private validateInsert(insert: Insert): void {
    checkId(insert.start)
    if (!insert.text.length || !Number.isSafeInteger(insert.start.counter + insert.text.length))
      throw new CollabFailure('invalid-insert')
    const left = this.get(insert.originLeft)
    const right = insert.originRight === 'end' ? null : this.get(insert.originRight)
    const order = [this.root, ...this.ordered()]
    if (right && order.indexOf(left) >= order.indexOf(right))
      throw new CollabFailure('reversed-origins')
    for (let i = 0; i < insert.text.length; i++) {
      if (
        this.nodes.has(charKey({ bunch: insert.start.bunch, counter: insert.start.counter + i }))
      ) {
        throw new CollabFailure('duplicate-character')
      }
    }
  }

  private insert(insert: Insert): void {
    let left = this.get(insert.originLeft)
    const right = insert.originRight === 'end' ? null : this.get(insert.originRight)
    for (let i = 0; i < insert.text.length; i++) {
      // The immutable right origin determines parent/side even after concurrent arrivals.
      const isLeft = right !== null && isAncestor(left, right)
      left = this.add(
        { bunch: insert.start.bunch, counter: insert.start.counter + i },
        insert.text[i]!,
        isLeft ? right! : left,
        isLeft ? 'L' : 'R',
        right,
      )
    }
  }

  private add(
    id: CharId,
    value: string,
    parent: Node,
    side: 'L' | 'R',
    rightOrigin: Node | null,
  ): Node {
    const node: Node = {
      id: { ...id },
      value,
      parent,
      side,
      rightOrigin,
      left: [],
      right: [],
    }
    const siblings = side === 'L' ? parent.left : parent.right
    const order = this.ordered()
    const rightRank = (origin: Node | null) =>
      origin === null ? order.length : order.indexOf(origin)
    const index = siblings.findIndex((sibling) => {
      if (side === 'L') return compareIds(id, sibling.id as CharId) < 0
      const difference = rightRank(sibling.rightOrigin) - rightRank(rightOrigin)
      return difference < 0 || (difference === 0 && compareIds(id, sibling.id as CharId) < 0)
    })
    siblings.splice(index === -1 ? siblings.length : index, 0, node)
    this.nodes.set(charKey(id), node)
    return node
  }

  private ordered(): Node[] {
    const result: Node[] = []
    const stack: { node: Node; visit: boolean }[] = [{ node: this.root, visit: false }]
    while (stack.length) {
      const { node, visit } = stack.pop()!
      if (visit) {
        if (node !== this.root) result.push(node)
        continue
      }
      for (let i = node.right.length - 1; i >= 0; i--)
        stack.push({ node: node.right[i]!, visit: false })
      stack.push({ node, visit: true })
      for (let i = node.left.length - 1; i >= 0; i--)
        stack.push({ node: node.left[i]!, visit: false })
    }
    return result
  }
}

function rootNode(): Node {
  return {
    id: 'start',
    value: '',
    parent: null,
    side: 'R',
    rightOrigin: null,
    left: [],
    right: [],
  }
}
function isAncestor(ancestor: Node, node: Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent === ancestor) return true
  return false
}
function compareIds(a: CharId, b: CharId): number {
  if (a.bunch !== b.bunch) return a.bunch < b.bunch ? -1 : 1
  return a.counter - b.counter
}
function copyLeft(id: LeftOrigin): LeftOrigin {
  return id === 'start' ? id : { ...id }
}
function checkId(id: CharId): void {
  if (!id.bunch || !Number.isSafeInteger(id.counter) || id.counter < 0)
    throw new CollabFailure('invalid-character-id')
}
function checkRange(offset: number, count: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(count) ||
    offset < 0 ||
    count < 0 ||
    offset + count > length
  ) {
    throw new CollabFailure('invalid-offset')
  }
}
function checkBoundary(text: string, offset: number): void {
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
    throw new CollabFailure('split-surrogate')
}
function metadata(context: AuthorContext): Omit<Envelope, 'change'> {
  return {
    document: context.document,
    epoch: context.epoch,
    id: { ...context.id },
    lamport: context.lamport,
    deps: context.deps.map((id) => ({ ...id })),
  }
}
