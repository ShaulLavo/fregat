import type { PieceTreeNode } from './pieceTableTypes'
import { own, summarize } from './node'

// AVL balance through the join of Blelloch, Ferizovic and Sun, "Just Join for
// Parallel Ordered Sets". `join` is the only function that knows the rule;
// an edit rejoins each node on its path, which is constant work per level.

const heightOf = (node: PieceTreeNode | null): number => (node ? node.height : 0)
const link = (
  middle: PieceTreeNode,
  left: PieceTreeNode | null,
  right: PieceTreeNode | null,
): PieceTreeNode => {
  middle.left = left
  middle.right = right
  return summarize(middle)
}

// Both rotations take an owned node and own the pivot they lift.
const rotateLeft = (node: PieceTreeNode, epoch: number): PieceTreeNode => {
  const pivot = own(node.right!, epoch)
  node.right = pivot.left
  summarize(node)
  pivot.left = node
  return summarize(pivot)
}

const rotateRight = (node: PieceTreeNode, epoch: number): PieceTreeNode => {
  const pivot = own(node.left!, epoch)
  node.left = pivot.right
  summarize(node)
  pivot.right = node
  return summarize(pivot)
}

const joinRight = (
  left: PieceTreeNode,
  middle: PieceTreeNode,
  right: PieceTreeNode | null,
  epoch: number,
): PieceTreeNode => {
  const top = own(left, epoch)
  const inner = top.right
  if (heightOf(inner) > heightOf(right) + 1) {
    top.right = joinRight(inner!, middle, right, epoch)
    if (top.right.height <= heightOf(top.left) + 1) return summarize(top)
    return rotateLeft(top, epoch)
  }

  link(middle, inner, right)
  if (middle.height <= heightOf(top.left) + 1) {
    top.right = middle
    return summarize(top)
  }
  top.right = rotateRight(middle, epoch)
  return rotateLeft(top, epoch)
}

const joinLeft = (
  left: PieceTreeNode | null,
  middle: PieceTreeNode,
  right: PieceTreeNode,
  epoch: number,
): PieceTreeNode => {
  const top = own(right, epoch)
  const inner = top.left
  if (heightOf(inner) > heightOf(left) + 1) {
    top.left = joinLeft(left, middle, inner!, epoch)
    if (top.left.height <= heightOf(top.right) + 1) return summarize(top)
    return rotateRight(top, epoch)
  }

  link(middle, left, inner)
  if (middle.height <= heightOf(top.right) + 1) {
    top.left = middle
    return summarize(top)
  }
  top.left = rotateLeft(middle, epoch)
  return rotateRight(top, epoch)
}

// `middle` must be owned by the caller: a fresh node or the result of `own`.
export const join = (
  left: PieceTreeNode | null,
  middle: PieceTreeNode,
  right: PieceTreeNode | null,
  epoch: number,
): PieceTreeNode => {
  const difference = heightOf(left) - heightOf(right)
  if (difference > 1) return joinRight(left!, middle, right, epoch)
  if (difference < -1) return joinLeft(left, middle, right!, epoch)
  return link(middle, left, right)
}
