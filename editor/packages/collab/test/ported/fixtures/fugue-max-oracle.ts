// mweidner037/fugue @ 31e74fea67f23add13a5d10f781c0d78edcd14da.
// fugue-max-simple/src/index.ts, Tree and FugueMaxSimple.insertOne.
// Adapted to Singapore ID-space edits as an independent test oracle.
// Transport/serialization are removed; tree placement and traversal are retained.
// Copyright (c) 2023 Matthew Weidner and Martin Kleppmann. MIT;
// see ../../../THIRD_PARTY_TEST_NOTICES.md.
import { charKey, editKey, insertionOf } from '../../../src/types'
import type { CharId, Envelope } from '../../../src/types'

interface ID {
  sender: string
  counter: number
}

interface Node<T> {
  id: ID
  value: T | null
  isDeleted: boolean

  parent: Node<T> | null
  side: 'L' | 'R'

  leftChildren: Node<T>[]
  rightChildren: Node<T>[]

  size: number

  rightOrigin?: Node<T> | null
}

interface InsertMessage<T> {
  type: 'insert'
  id: ID
  value: T
  parent: ID
  side: 'L' | 'R'
  rightOrigin?: ID | null
}

class Tree<T> {
  readonly root: Node<T>

  private readonly nodesByID = new Map<string, Node<T>[]>()

  constructor() {
    this.root = {
      id: { sender: '', counter: 0 },
      value: null,
      isDeleted: true,
      parent: null,
      side: 'R',
      leftChildren: [],
      rightChildren: [],
      size: 0,
    }
    this.nodesByID.set('', [this.root])
  }

  addNode(id: ID, value: T, parent: Node<T>, side: 'L' | 'R', rightOriginID?: ID | null) {
    const node: Node<T> = {
      id,
      value,
      isDeleted: false,
      parent,
      side,
      leftChildren: [],
      rightChildren: [],
      size: 0,
    }
    if (rightOriginID !== undefined) {
      node.rightOrigin = rightOriginID === null ? null : this.getByID(rightOriginID)
    }

    let bySender = this.nodesByID.get(id.sender)
    if (bySender === undefined) {
      bySender = []
      this.nodesByID.set(id.sender, bySender)
    }
    bySender.push(node)

    this.insertIntoSiblings(node)

    this.updateSize(node, 1)
  }

  private insertIntoSiblings(node: Node<T>) {
    const parent = node.parent!
    if (node.side === 'R') {
      const rightSibs = parent.rightChildren

      let i = 0
      for (; i < rightSibs.length; i++) {
        if (
          !(
            this.isLess(node.rightOrigin!, rightSibs[i]!.rightOrigin!) ||
            (node.rightOrigin === rightSibs[i]!.rightOrigin &&
              node.id.sender > rightSibs[i]!.id.sender)
          )
        )
          break
      }
      rightSibs.splice(i, 0, node)
    } else {
      const leftSibs = parent.leftChildren

      let i = 0
      for (; i < leftSibs.length; i++) {
        if (!(node.id.sender > leftSibs[i]!.id.sender)) break
      }
      leftSibs.splice(i, 0, node)
    }
  }

  private isLess(a: Node<T> | null, b: Node<T> | null): boolean {
    if (a === b) return false
    if (a === null) return false
    if (b === null) return true

    const aDepth = this.depth(a)
    const bDepth = this.depth(b)
    let aAnc = a
    let bAnc = b
    if (aDepth > bDepth) {
      let lastSide: 'L' | 'R'
      for (let i = aDepth; i > bDepth; i--) {
        lastSide = aAnc.side
        aAnc = aAnc.parent!
      }
      if (aAnc === b) {
        return lastSide! === 'L'
      }
    }
    if (bDepth > aDepth) {
      let lastSide: 'L' | 'R'
      for (let i = bDepth; i > aDepth; i--) {
        lastSide = bAnc.side
        bAnc = bAnc.parent!
      }
      if (bAnc === a) {
        return lastSide! === 'R'
      }
    }

    while (aAnc.parent !== bAnc.parent) {
      aAnc = aAnc.parent!
      bAnc = bAnc.parent!
    }

    if (aAnc.side !== bAnc.side) return aAnc.side === 'L'
    const siblings = aAnc.side === 'L' ? aAnc.parent!.leftChildren : aAnc.parent!.rightChildren
    return siblings.indexOf(aAnc) < siblings.indexOf(bAnc)
  }

  private depth(node: Node<T>): number {
    let depth = 0
    for (let current = node; current.parent !== null; current = current.parent) {
      depth++
    }
    return depth
  }

  updateSize(node: Node<T>, delta: number) {
    for (let anc: Node<T> | null = node; anc !== null; anc = anc.parent) {
      anc.size += delta
    }
  }

  getByID(id: ID): Node<T> {
    const bySender = this.nodesByID.get(id.sender)
    if (bySender !== undefined) {
      const node = bySender[id.counter]
      if (node !== undefined) return node
    }
    throw new TypeError('Unknown ID: ' + JSON.stringify(id))
  }

  getByIndex(node: Node<T>, index: number): Node<T> {
    if (index < 0 || index >= node.size) {
      throw new TypeError('Index out of range: ' + index + ' (size: ' + node.size + ')')
    }

    let remaining = index
    recurse: while (true) {
      for (const child of node.leftChildren) {
        if (remaining < child.size) {
          node = child
          continue recurse
        }
        remaining -= child.size
      }
      if (!node.isDeleted) {
        if (remaining === 0) return node
        remaining--
      }
      for (const child of node.rightChildren) {
        if (remaining < child.size) {
          node = child
          continue recurse
        }
        remaining -= child.size
      }
      throw new TypeError('Index in range but not found')
    }
  }

  leftmostDescendant(node: Node<T>): Node<T> {
    let desc = node
    for (; desc.leftChildren.length !== 0; desc = desc.leftChildren[0]!) {}
    return desc
  }

  nextNonDescendant(node: Node<T>): Node<T> | null {
    let current = node
    while (current.parent !== null) {
      const siblings =
        current.side === 'L' ? current.parent.leftChildren : current.parent.rightChildren
      const index = siblings.indexOf(current)
      if (index < siblings.length - 1) {
        const nextSibling = siblings[index + 1]!
        return this.leftmostDescendant(nextSibling)
      }
      if (current.side === 'L') return current.parent
      current = current.parent
    }

    return null
  }

  *retained(): IterableIterator<Node<T>> {
    const stack = [{ node: this.root, emit: false }]
    while (stack.length) {
      const entry = stack.pop()!
      if (entry.emit) {
        if (entry.node !== this.root) yield entry.node
        continue
      }
      for (const node of entry.node.rightChildren.toReversed()) stack.push({ node, emit: false })
      stack.push({ node: entry.node, emit: true })
      for (const node of entry.node.leftChildren.toReversed()) stack.push({ node, emit: false })
    }
  }

  *traverse(node: Node<T>): IterableIterator<T> {
    let current = node

    const stack: { side: 'L' | 'R'; childIndex: number }[] = [{ side: 'L', childIndex: 0 }]
    while (true) {
      const top = stack[stack.length - 1]!
      const children = top.side === 'L' ? current.leftChildren : current.rightChildren
      if (top.childIndex < children.length) {
        const child = children[top.childIndex++]!
        if (child.size > 0) {
          current = child
          stack.push({ side: 'L', childIndex: 0 })
        }
        continue
      }
      if (top.side === 'L') {
        if (!current.isDeleted) yield current.value!
        top.side = 'R'
        top.childIndex = 0
        continue
      }
      if (current.parent === null) return
      current = current.parent
      stack.pop()
    }
  }
}

export function fugueMaxAuthor(actor: string) {
  const tree = new Tree<string>()
  const edits: InsertMessage<string>[] = []
  const seen = new Set<string>()
  let counter = 0
  function receive(message: InsertMessage<string>) {
    const key = JSON.stringify(message.id)
    if (seen.has(key)) return
    tree.addNode(
      message.id,
      message.value,
      tree.getByID(message.parent),
      message.side,
      message.rightOrigin,
    )
    seen.add(key)
    edits.push(message)
  }
  return {
    edits,
    observe(messages: readonly InsertMessage<string>[]) {
      for (const message of messages) receive(message)
    },
    text: () => [...tree.traverse(tree.root)].join(''),
    insert(index: number, value: string) {
      const id = { sender: actor, counter: counter++ }
      const leftOrigin = index === 0 ? tree.root : tree.getByIndex(tree.root, index - 1)
      let message: InsertMessage<string>
      if (leftOrigin.rightChildren.length === 0) {
        const rightOrigin = tree.nextNonDescendant(leftOrigin)
        message = {
          type: 'insert',
          id,
          value,
          parent: leftOrigin.id,
          side: 'R',
          rightOrigin: rightOrigin === null ? null : rightOrigin.id,
        }
      } else {
        const rightOrigin = tree.leftmostDescendant(leftOrigin.rightChildren[0]!)
        message = { type: 'insert', id, value, parent: rightOrigin.id, side: 'L' }
      }
      receive(message)
    },
  }
}

type Value = {
  readonly id: CharId
  readonly text: string
  readonly insert: string
  readonly deletes: Set<string>
}
export type OracleEdit = {
  readonly envelope: Envelope
  readonly inserts: readonly InsertMessage<Value>[]
}

/** Parent/side messages are generated on the author's tree, never on the receiving tree. */
export function fugueMaxReplica() {
  const tree = new Tree<Value>()
  const active = new Map<string, boolean>()
  const seen = new Set<string>()
  const idOf = (id: CharId): ID => ({ sender: id.bunch, counter: id.counter })
  const visible = (value: Value) =>
    active.get(value.insert) === true && [...value.deletes].every((key) => !active.get(key))
  function settle() {
    for (const node of tree.retained()) {
      const deleted = !visible(node.value!)
      if (node.isDeleted === deleted) continue
      node.isDeleted = deleted
      tree.updateSize(node, deleted ? -1 : 1)
    }
  }
  function apply(edit: OracleEdit) {
    const { envelope, inserts } = edit
    const key = editKey(envelope.id)
    if (seen.has(key)) return
    const change = envelope.change
    if (change.kind === 'setEffects') {
      for (const effect of change.effects) active.set(editKey(effect.op), effect.active)
    } else {
      active.set(key, true)
      for (const message of inserts)
        tree.addNode(
          message.id,
          { ...message.value, deletes: new Set() },
          tree.getByID(message.parent),
          message.side,
          message.rightOrigin,
        )
      if (change.kind !== 'insert') {
        for (const span of change.spans) {
          for (let unit = 0; unit < span.count; unit++)
            tree
              .getByID({ sender: span.start.bunch, counter: span.start.counter + unit })
              .value!.deletes.add(key)
        }
      }
    }
    seen.add(key)
    settle()
  }
  function author(envelope: Envelope, offset: number): OracleEdit {
    const insertion = insertionOf(envelope.change)
    const inserts: InsertMessage<Value>[] = []
    if (!insertion) {
      const edit = { envelope, inserts }
      apply(edit)
      return edit
    }
    active.set(editKey(envelope.id), true)
    for (let unit = 0; unit < insertion.text.length; unit++) {
      const index = offset + unit
      const left = index === 0 ? tree.root : tree.getByIndex(tree.root, index - 1)
      const right =
        left.rightChildren.length === 0
          ? tree.nextNonDescendant(left)
          : tree.leftmostDescendant(left.rightChildren[0]!)
      if (unit === 0) {
        const leftId = left === tree.root ? 'start' : left.value!.id
        const rightId = right === null ? 'end' : right.value!.id
        if (JSON.stringify(leftId) !== JSON.stringify(insertion.originLeft))
          throw new TypeError('Author left origin differs from upstream FugueMax')
        if (JSON.stringify(rightId) !== JSON.stringify(insertion.originRight))
          throw new TypeError(
            `Author tombstone right origin differs from upstream FugueMax: ${JSON.stringify({ id: envelope.id, offset, expected: rightId, actual: insertion.originRight })}`,
          )
      }
      const id = { bunch: insertion.start.bunch, counter: insertion.start.counter + unit }
      const message: InsertMessage<Value> = {
        type: 'insert',
        id: idOf(id),
        value: {
          id,
          text: insertion.text[unit]!,
          insert: editKey(envelope.id),
          deletes: new Set(),
        },
        parent: left.rightChildren.length === 0 ? left.id : right!.id,
        side: left.rightChildren.length === 0 ? 'R' : 'L',
        ...(left.rightChildren.length === 0 ? { rightOrigin: right?.id ?? null } : {}),
      }
      tree.addNode(
        message.id,
        message.value,
        tree.getByID(message.parent),
        message.side,
        message.rightOrigin,
      )
      inserts.push(message)
    }
    // Insert messages already affected the author's tree. Apply only deletion/effect bookkeeping.
    const edit = { envelope, inserts }
    apply({ envelope, inserts: [] })
    return edit
  }
  return {
    author,
    apply,
    text: () => [...tree.traverse(tree.root)].map((value) => value.text).join(''),
    ids: () => [...tree.retained()].map((node) => charKey(node.value!.id)),
    visibleIds: () => [...tree.traverse(tree.root)].map((value) => charKey(value.id)),
  }
}
