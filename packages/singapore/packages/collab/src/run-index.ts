import type { CharId } from './types'

export type Index<T> = {
  readonly key: CharId
  readonly value: T
  readonly left: Index<T> | null
  readonly right: Index<T> | null
  readonly height: number
}
export function compareId(a: CharId, b: CharId): number {
  if (a.bunch !== b.bunch) return a.bunch < b.bunch ? -1 : 1
  return a.counter - b.counter
}
function height<T>(root: Index<T> | null): number {
  return root?.height ?? 0
}
function node<T>(key: CharId, value: T, left: Index<T> | null, right: Index<T> | null): Index<T> {
  return { key, value, left, right, height: 1 + Math.max(height(left), height(right)) }
}
function rotateLeft<T>(root: Index<T>): Index<T> {
  const right = root.right!
  return node(
    right.key,
    right.value,
    node(root.key, root.value, root.left, right.left),
    right.right,
  )
}
function rotateRight<T>(root: Index<T>): Index<T> {
  const left = root.left!
  return node(left.key, left.value, left.left, node(root.key, root.value, left.right, root.right))
}
function balance<T>(root: Index<T>): Index<T> {
  if (height(root.left) > height(root.right) + 1) {
    const left = root.left!
    const next = height(left.right) > height(left.left) ? rotateLeft(left) : left
    return rotateRight(node(root.key, root.value, next, root.right))
  }
  if (height(root.right) > height(root.left) + 1) {
    const right = root.right!
    const next = height(right.left) > height(right.right) ? rotateRight(right) : right
    return rotateLeft(node(root.key, root.value, root.left, next))
  }
  return root
}
export function put<T>(root: Index<T> | null, key: CharId, value: T): Index<T> {
  if (!root) return node(key, value, null, null)
  const direction = compareId(key, root.key)
  if (direction === 0) return node(key, value, root.left, root.right)
  if (direction < 0)
    return balance(node(root.key, root.value, put(root.left, key, value), root.right))
  return balance(node(root.key, root.value, root.left, put(root.right, key, value)))
}
export function floor<T>(root: Index<T> | null, key: CharId): Index<T> | null {
  let candidate: Index<T> | null = null
  while (root) {
    const direction = compareId(key, root.key)
    if (direction === 0) return root
    if (direction < 0) {
      root = root.left
      continue
    }
    candidate = root
    root = root.right
  }
  return candidate
}
export function ceiling<T>(root: Index<T> | null, key: CharId): Index<T> | null {
  let candidate: Index<T> | null = null
  while (root) {
    const direction = compareId(key, root.key)
    if (direction === 0) return root
    if (direction > 0) {
      root = root.right
      continue
    }
    candidate = root
    root = root.left
  }
  return candidate
}
export function get<T>(root: Index<T> | null, key: CharId): T | null {
  const found = floor(root, key)
  return found && compareId(found.key, key) === 0 ? found.value : null
}
