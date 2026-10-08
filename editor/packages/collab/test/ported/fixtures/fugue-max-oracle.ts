// mweidner037/fugue @ 31e74fea67f23add13a5d10f781c0d78edcd14da.
// fugue-max-simple/src/index.ts, Tree and FugueMaxSimple.insertOne.
// Adapted to Singapore ID-space edits as an independent test oracle.
// Transport/serialization are removed; tree placement and traversal are retained.
// Copyright (c) 2023 Matthew Weidner and Martin Kleppmann. MIT;
// see ../../../THIRD_PARTY_TEST_NOTICES.md.
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
