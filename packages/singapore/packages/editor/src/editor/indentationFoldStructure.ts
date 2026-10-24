import type { FoldFactBlock, FoldLineReference } from './indentationFoldFacts'
import { sameFoldLine } from './indentationFoldFacts'

export type IndentationRegion = {
  readonly start: FoldLineReference
  readonly end: FoldLineReference
  readonly endBefore: boolean
  readonly type: 'indent' | 'region'
}
export type IndentationStack = {
  readonly indent: number
  readonly endAbove: FoldLineReference
  readonly line: FoldLineReference
  readonly parent: IndentationStack | null
  readonly marker: IndentationStack | null
  readonly hash: number
}
export type AcceptedStack = {
  readonly fold: IndentationRegion
  readonly parent: AcceptedStack | null
}
export type IndentationBlock = {
  readonly facts: FoldFactBlock
  readonly below: IndentationStack | null
  readonly above: IndentationStack | null
  readonly candidates: readonly IndentationRegion[]
  readonly incoming: AcceptedStack | null
  readonly outgoing: AcceptedStack | null
  readonly accepted: readonly IndentationRegion[]
  readonly maxEnd: FoldLineReference | null
  readonly analyzed: boolean
}

export function unanalyzedBlock(facts: FoldFactBlock): IndentationBlock {
  return {
    facts,
    below: null,
    above: null,
    candidates: [],
    incoming: null,
    outgoing: null,
    accepted: [],
    maxEnd: null,
    analyzed: false,
  }
}

export function stackNode(
  indent: number,
  endAbove: FoldLineReference,
  line: FoldLineReference,
  parent: IndentationStack | null,
): IndentationStack {
  const hash =
    Math.imul((parent?.hash ?? 0) ^ indent, 31) ^
    Math.imul(endAbove.owner.id, 131) ^
    Math.imul(endAbove.slot, 8191) ^
    Math.imul(line.owner.id, 524287) ^
    line.slot
  return {
    indent,
    endAbove,
    line,
    parent,
    marker: parent?.indent === -2 ? parent : (parent?.marker ?? null),
    hash,
  }
}

export function* sameIndentationStack(
  left: IndentationStack | null,
  right: IndentationStack | null,
): Generator<void, boolean> {
  while (left !== right) {
    if (!left || !right || left.hash !== right.hash || left.indent !== right.indent) return false
    if (!sameFoldLine(left.endAbove, right.endAbove) || !sameFoldLine(left.line, right.line))
      return false
    left = left.parent
    right = right.parent
    yield
  }
  return true
}

export function* sameAcceptedStack(
  left: AcceptedStack | null,
  right: AcceptedStack | null,
): Generator<void, boolean> {
  while (left !== right) {
    if (!left || !right || !sameRegion(left.fold, right.fold)) return false
    left = left.parent
    right = right.parent
    yield
  }
  return true
}

function sameRegion(left: IndentationRegion, right: IndentationRegion): boolean {
  return (
    left === right ||
    (left.type === right.type &&
      left.endBefore === right.endBefore &&
      sameFoldLine(left.start, right.start) &&
      sameFoldLine(left.end, right.end))
  )
}

export type FoldBlockTree =
  | {
      readonly kind: 'leaf'
      readonly block: IndentationBlock
      readonly rows: number
      readonly length: number
      readonly count: number
      readonly leaves: number
      readonly maxEnd: FoldLineReference | null
    }
  | {
      readonly kind: 'branch'
      readonly left: FoldBlockTree
      readonly right: FoldBlockTree
      readonly rows: number
      readonly length: number
      readonly count: number
      readonly leaves: number
      readonly maxEnd: FoldLineReference | null
    }

type CompareFoldLines = (left: FoldLineReference, right: FoldLineReference) => number

function foldBlockLeaf(block: IndentationBlock): FoldBlockTree {
  return {
    kind: 'leaf',
    block,
    rows: block.facts.facts.length,
    length: block.facts.length,
    count: block.accepted.length,
    leaves: 1,
    maxEnd: block.maxEnd,
  }
}

function branch(
  left: FoldBlockTree,
  right: FoldBlockTree,
  compare: CompareFoldLines,
  previous?: Extract<FoldBlockTree, { kind: 'branch' }>,
): FoldBlockTree {
  // Stable line references keep their order when a block is replaced.
  const maxEnd =
    previous && left.maxEnd === previous.left.maxEnd && right.maxEnd === previous.right.maxEnd
      ? previous.maxEnd
      : maximumFoldLine(left.maxEnd, right.maxEnd, compare)
  return {
    kind: 'branch',
    left,
    right,
    rows: left.rows + right.rows,
    length: left.length + right.length,
    count: left.count + right.count,
    leaves: left.leaves + right.leaves,
    maxEnd,
  }
}

export function maximumFoldLine(
  left: FoldLineReference | null,
  right: FoldLineReference | null,
  compare: CompareFoldLines,
): FoldLineReference | null {
  if (!left) return right
  if (!right) return left
  return compare(left, right) >= 0 ? left : right
}

type FoldTreeFrame = { readonly from: number; readonly to: number; left: FoldBlockTree | null }

/** Each advance visits or constructs one tree node, so metadata cannot hide a whole pass in a slice. */
export class FoldBlockTreeBuilder {
  private readonly frames: FoldTreeFrame[]
  private pending: FoldBlockTree | null = null

  constructor(
    private readonly blocks: readonly IndentationBlock[],
    private readonly compare: CompareFoldLines,
  ) {
    this.frames = blocks.length === 0 ? [] : [{ from: 0, to: blocks.length, left: null }]
  }

  get result(): FoldBlockTree | null {
    return this.pending
  }

  step(): boolean {
    const frame = this.frames.at(-1)
    if (!frame) return true
    if (this.pending) return this.joinPending(frame, this.pending)
    if (frame.to - frame.from === 1) {
      this.pending = foldBlockLeaf(this.blocks[frame.from]!)
      this.frames.pop()
      return this.frames.length === 0
    }
    this.frames.push({ from: frame.from, to: (frame.from + frame.to) >>> 1, left: null })
    return false
  }

  private joinPending(frame: FoldTreeFrame, pending: FoldBlockTree): boolean {
    if (!frame.left) {
      frame.left = pending
      this.pending = null
      this.frames.push({ from: (frame.from + frame.to) >>> 1, to: frame.to, left: null })
      return false
    }
    this.pending = branch(frame.left, pending, this.compare)
    this.frames.pop()
    return this.frames.length === 0
  }
}

export function updateFoldBlockTree(
  tree: FoldBlockTree,
  index: number,
  block: IndentationBlock,
  compare: CompareFoldLines,
): FoldBlockTree {
  if (tree.kind === 'leaf') return foldBlockLeaf(block)
  if (index < tree.left.leaves)
    return branch(updateFoldBlockTree(tree.left, index, block, compare), tree.right, compare, tree)
  return branch(
    tree.left,
    updateFoldBlockTree(tree.right, index - tree.left.leaves, block, compare),
    compare,
    tree,
  )
}

export type LocatedFoldBlock = {
  readonly block: IndentationBlock
  readonly index: number
  readonly row: number
  readonly offset: number
}

export function locateFoldBlock(
  tree: FoldBlockTree,
  target: number,
  by: 'row' | 'index',
): LocatedFoldBlock {
  let node = tree
  let row = 0
  let offset = 0
  let index = 0
  while (node.kind === 'branch') {
    const amount = by === 'row' ? node.left.rows : node.left.leaves
    if (target < amount) {
      node = node.left
      continue
    }
    target -= amount
    row += node.left.rows
    offset += node.left.length
    index += node.left.leaves
    node = node.right
  }
  return { block: node.block, index, row, offset }
}
