import type { PieceTreeNode, PieceTableTreeSnapshot } from './pieceTableTypes'
import { bufferSpanAt } from './buffers'
import { collectTextInRange } from './tree'
import { getPieceVisibleLength, getSubtreeVisibleLength } from './node'

// Stateful forward cursor over the visible text of an immutable snapshot.
// Sequential reads are amortized O(1) per char; seek() is one O(log n) descent.
// A next() crossing a piece boundary is worst-case O(k + depth) where k is the
// number of interleaved tombstones at that boundary (fully invisible subtrees
// are pruned via subtreeVisibleLength) — see the tombstone-compaction TODO.

export type PieceTableWalkerChunk = {
  readonly text: string
  readonly start: number
  readonly end: number
}

export type PieceTableWalker = {
  offset(): number
  exhausted(): boolean
  remaining(): number
  charCode(): number
  next(): number
  codePoint(): number
  skip(count: number): void
  seek(offset: number): void
  chunk(): PieceTableWalkerChunk | null
  nextChunk(): boolean
}

const EXHAUSTED_CHAR = -1
const HIGH_SURROGATE_FIRST = 0xd800
const HIGH_SURROGATE_LAST = 0xdbff
const LOW_SURROGATE_FIRST = 0xdc00
const LOW_SURROGATE_LAST = 0xdfff

class PrototypePieceTableWalker implements PieceTableWalker {
  private readonly root: PieceTableTreeSnapshot['root']
  private readonly buffers: PieceTableTreeSnapshot['buffers']
  private readonly totalLength: number

  // The stack holds the current node plus exactly those ancestors entered via
  // a left turn (they are emitted after their left subtree). Not exhausted iff
  // the stack is non-empty; the top node's piece is visible with length > 0.
  // textIndex/textEnd are absolute indexes into pieceText so the hot path
  // reads chars with a single index instead of recomputing start + local.
  private readonly stack: PieceTreeNode[] = []
  private pieceText = ''
  private spanStart = 0
  private textIndex = 0
  private textEnd = 0
  private offsetValue = 0

  public constructor(snapshot: PieceTableTreeSnapshot, startOffset: number) {
    this.root = snapshot.root
    this.buffers = snapshot.buffers
    this.totalLength = snapshot.length
    this.seek(startOffset)
  }

  public offset(): number {
    return this.offsetValue
  }

  public exhausted(): boolean {
    return this.stack.length === 0
  }

  public remaining(): number {
    return this.totalLength - this.offsetValue
  }

  public charCode(): number {
    return this.stack.length === 0 ? EXHAUSTED_CHAR : this.pieceText.charCodeAt(this.textIndex)
  }

  public next(): number {
    if (this.textIndex >= this.textEnd) return EXHAUSTED_CHAR

    const code = this.pieceText.charCodeAt(this.textIndex)
    this.textIndex += 1
    this.offsetValue += 1
    if (this.textIndex === this.textEnd) this.advanceSpan()
    return code
  }

  public codePoint(): number {
    const first = this.charCode()
    if (first < HIGH_SURROGATE_FIRST || first > HIGH_SURROGATE_LAST) return first
    if (this.offsetValue + 1 >= this.totalLength) return first

    const second =
      this.textIndex + 1 < this.textEnd
        ? this.pieceText.charCodeAt(this.textIndex + 1)
        : this.lookAheadCharCode()
    if (second < LOW_SURROGATE_FIRST || second > LOW_SURROGATE_LAST) return first
    return (first - HIGH_SURROGATE_FIRST) * 0x400 + (second - LOW_SURROGATE_FIRST) + 0x10000
  }

  public skip(count: number): void {
    if (count < 0 || this.offsetValue + count > this.totalLength) {
      throw new RangeError('invalid count')
    }

    let remaining = count
    while (remaining > 0) {
      const available = this.textEnd - this.textIndex
      if (remaining < available) {
        this.textIndex += remaining
        this.offsetValue += remaining
        return
      }
      remaining -= available
      this.offsetValue += available
      this.advanceSpan()
    }
  }

  public seek(target: number): void {
    if (target < 0 || target > this.totalLength) throw new RangeError('invalid offset')

    if (
      this.stack.length > 0 &&
      target >= this.offsetValue &&
      target - this.offsetValue < this.textEnd - this.textIndex
    ) {
      this.textIndex += target - this.offsetValue
      this.offsetValue = target
      return
    }

    this.stack.length = 0
    this.offsetValue = target
    if (target === this.totalLength) {
      this.clearCurrentPiece()
      return
    }

    let node = this.root
    let remaining = target
    while (node) {
      const leftLength = getSubtreeVisibleLength(node.left)
      if (remaining < leftLength) {
        this.stack.push(node)
        node = node.left
        continue
      }
      remaining -= leftLength

      const nodeLength = getPieceVisibleLength(node.piece)
      if (remaining < nodeLength) {
        this.stack.push(node)
        this.bindCurrentPiece(node, node.piece.start + remaining)
        return
      }
      remaining -= nodeLength
      node = node.right
    }

    throw new RangeError('invalid offset')
  }

  public chunk(): PieceTableWalkerChunk | null {
    if (this.stack.length === 0) return null
    return {
      text: this.pieceText.slice(this.textIndex, this.textEnd),
      start: this.offsetValue,
      end: this.offsetValue + (this.textEnd - this.textIndex),
    }
  }

  public nextChunk(): boolean {
    if (this.stack.length === 0) return false
    this.offsetValue += this.textEnd - this.textIndex
    return this.advanceSpan()
  }

  private bindCurrentPiece(node: PieceTreeNode, at = node.piece.start): void {
    const span = bufferSpanAt(this.buffers, node.piece.buffer, at)
    this.pieceText = span.text
    this.spanStart = span.start
    this.textIndex = at - span.start
    this.textEnd = Math.min(span.end, node.piece.start + node.piece.length) - span.start
  }

  private advanceSpan(): boolean {
    const node = this.stack[this.stack.length - 1]
    const at = this.spanStart + this.textEnd
    if (node && at < node.piece.start + node.piece.length) {
      this.bindCurrentPiece(node, at)
      return true
    }
    return this.advancePiece()
  }

  private clearCurrentPiece(): void {
    this.pieceText = ''
    this.textIndex = 0
    this.textEnd = 0
  }

  private pushLeftSpine(start: PieceTreeNode): void {
    let node: PieceTreeNode | null = start
    while (node) {
      this.stack.push(node)
      node = node.left && getSubtreeVisibleLength(node.left) > 0 ? node.left : null
    }
  }

  private settleOnVisibleTop(): boolean {
    while (this.stack.length > 0) {
      const node = this.stack[this.stack.length - 1]
      if (!node) break
      if (node.piece.visible && node.piece.length > 0) {
        this.bindCurrentPiece(node)
        return true
      }
      this.stack.pop()
      if (node.right && getSubtreeVisibleLength(node.right) > 0) {
        this.pushLeftSpine(node.right)
      }
    }
    this.clearCurrentPiece()
    return false
  }

  private advancePiece(): boolean {
    const node = this.stack.pop()
    if (node?.right && getSubtreeVisibleLength(node.right) > 0) {
      this.pushLeftSpine(node.right)
    }
    return this.settleOnVisibleTop()
  }

  private lookAheadCharCode(): number {
    const acc: string[] = []
    collectTextInRange(this.root, this.buffers, this.offsetValue + 1, this.offsetValue + 2, acc)
    const text = acc[0]
    return text && text.length > 0 ? text.charCodeAt(0) : EXHAUSTED_CHAR
  }
}

export const createPieceTableWalker = (
  snapshot: PieceTableTreeSnapshot,
  startOffset = 0,
): PieceTableWalker => new PrototypePieceTableWalker(snapshot, startOffset)
