import type {
  Piece,
  PieceTableEdit,
  PieceTableTreeSnapshot,
  PieceTreeNode,
} from './pieceTableTypes'
import { bufferSpanAt, bufferStorageIdentity } from './buffers'
import { readPieceTableTextRange } from './reads'

type Segment =
  | { readonly kind: 'tree'; readonly node: PieceTreeNode; readonly length: number }
  | { readonly kind: 'piece'; readonly piece: Piece; from: number; to: number; length: number }

class DiffCursor {
  readonly stack: Segment[] = []
  constructor(
    readonly snapshot: PieceTableTreeSnapshot,
    readonly reverse: boolean,
  ) {
    this.tree(snapshot.root)
  }
  top(): Segment | undefined {
    return this.stack.at(-1)
  }
  expand(): void {
    const segment = this.stack.pop()!
    if (segment.kind !== 'tree') return
    const { node } = segment
    this.tree(this.reverse ? node.left : node.right)
    if (node.piece.visible && node.piece.length)
      this.stack.push({
        kind: 'piece',
        piece: node.piece,
        from: node.piece.start,
        to: node.piece.start + node.piece.length,
        length: node.piece.length,
      })
    this.tree(this.reverse ? node.right : node.left)
  }
  skip(count: number): void {
    const segment = this.top()!
    if (count === segment.length) {
      this.stack.pop()
      return
    }
    if (segment.kind !== 'piece') throw new RangeError('partial subtree skip requires expansion')
    if (this.reverse) segment.to -= count
    else segment.from += count
    segment.length -= count
  }
  private tree(node: PieceTreeNode | null): void {
    if (node?.subtreeVisibleLength)
      this.stack.push({ kind: 'tree', node, length: node.subtreeVisibleLength })
  }
}

function sharedStorage(
  left: DiffCursor,
  right: DiffCursor,
  a: Segment & { kind: 'piece' },
  b: Segment & { kind: 'piece' },
): boolean {
  if (a.piece.buffer !== b.piece.buffer) return false
  const sameLineage = left.snapshot.buffers.identity === right.snapshot.buffers.identity
  const original =
    a.piece.buffer === left.snapshot.buffers.original &&
    b.piece.buffer === right.snapshot.buffers.original
  return (
    sameLineage &&
    (original ||
      bufferStorageIdentity(left.snapshot.buffers) ===
        bufferStorageIdentity(right.snapshot.buffers))
  )
}

function matchingUnits(
  left: DiffCursor,
  right: DiffCursor,
  a: Segment & { kind: 'piece' },
  b: Segment & { kind: 'piece' },
  count: number,
): number {
  const aUnit = left.reverse ? a.to - 1 : a.from
  const bUnit = right.reverse ? b.to - 1 : b.from
  if (aUnit === bUnit && sharedStorage(left, right, a, b)) return count
  const step = left.reverse ? -1 : 1
  let matched = 0
  while (matched < count) {
    const x = aUnit + step * matched,
      y = bUnit + step * matched
    const aSpan = bufferSpanAt(left.snapshot.buffers, a.piece.buffer, x)
    const bSpan = bufferSpanAt(right.snapshot.buffers, b.piece.buffer, y)
    const available = left.reverse
      ? Math.min(x - aSpan.start + 1, y - bSpan.start + 1)
      : Math.min(aSpan.end - x, bSpan.end - y)
    const length = Math.min(count - matched, available)
    const aFrom = left.reverse ? x - length + 1 : x
    const bFrom = right.reverse ? y - length + 1 : y
    const aText = aSpan.text.slice(aFrom - aSpan.start, aFrom - aSpan.start + length)
    const bText = bSpan.text.slice(bFrom - bSpan.start, bFrom - bSpan.start + length)
    if (aText === bText) {
      matched += length
      continue
    }
    for (let index = 0; index < length; index++) {
      const at = left.reverse ? length - index - 1 : index
      if (aText.charCodeAt(at) !== bText.charCodeAt(at)) return matched + index
    }
  }
  return matched
}

function commonLength(
  previous: PieceTableTreeSnapshot,
  next: PieceTableTreeSnapshot,
  reverse: boolean,
  limit: number,
): number {
  const left = new DiffCursor(previous, reverse),
    right = new DiffCursor(next, reverse)
  let matched = 0
  while (matched < limit) {
    const a = left.top(),
      b = right.top()
    if (!a || !b) break
    if (
      a.kind === 'tree' &&
      b.kind === 'tree' &&
      a.node === b.node &&
      a.length <= limit - matched
    ) {
      matched += a.length
      left.skip(a.length)
      right.skip(b.length)
      continue
    }
    if (a.kind === 'tree' && (b.kind === 'piece' || a.length >= b.length)) {
      left.expand()
      continue
    }
    if (b.kind === 'tree') {
      right.expand()
      continue
    }
    if (a.kind !== 'piece') continue
    const count = Math.min(a.length, b.length, limit - matched)
    const length = matchingUnits(left, right, a, b, count)
    matched += length
    if (length !== count) break
    left.skip(count)
    right.skip(count)
  }
  return matched
}

/** Single minimal effective edit. Shared subtrees and storage ranges skip unchanged text. */
export const diffPieceTableSnapshots = (
  previous: PieceTableTreeSnapshot,
  next: PieceTableTreeSnapshot,
): PieceTableEdit | null => {
  if (previous === next) return null
  if (previous.length === next.length && previous.root === next.root) return null
  const prefix = commonLength(previous, next, false, Math.min(previous.length, next.length))
  if (prefix === previous.length && prefix === next.length) return null
  const suffix = commonLength(previous, next, true, Math.min(previous.length, next.length) - prefix)
  return {
    from: prefix,
    to: previous.length - suffix,
    text: readPieceTableTextRange(next, prefix, next.length - suffix),
  }
}
