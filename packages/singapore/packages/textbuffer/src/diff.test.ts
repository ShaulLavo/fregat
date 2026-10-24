import { expect, test } from 'vitest'
import {
  createPieceTableSnapshot,
  insertIntoPieceTable,
  retainPieceTableSnapshot,
  materializePieceTableFullText,
} from './pieceTable'
import { diffPieceTableSnapshots } from './diff'
import type { PieceTreeNode } from './pieceTableTypes'

function minimal(before: string, after: string) {
  let from = 0
  while (from < Math.min(before.length, after.length) && before[from] === after[from]) from++
  if (from === before.length && from === after.length) return null
  let suffix = 0
  while (
    suffix < Math.min(before.length, after.length) - from &&
    before.at(-suffix - 1) === after.at(-suffix - 1)
  )
    suffix++
  return { from, to: before.length - suffix, text: after.slice(from, after.length - suffix) }
}

test.each([2000, 20_000])(
  'diff skips shared subtrees around an edit after %i inserts',
  (inserts) => {
    let before = createPieceTableSnapshot(`${'x'.repeat(80)}\n`.repeat(100_000))
    for (let n = 0; n < inserts; n++)
      before = insertIntoPieceTable(before, 1 + ((n * 7919) % 10_000) * 810, 'a')
    retainPieceTableSnapshot(before)
    const after = insertIntoPieceTable(before, 250_000, 'changed')
    const proxies = new WeakMap<PieceTreeNode, PieceTreeNode>()
    let visits = 0
    const observe = (node: PieceTreeNode | null): PieceTreeNode | null => {
      if (!node) return null
      const found = proxies.get(node)
      if (found) return found
      const proxy = new Proxy(node, {
        get(target, property) {
          if (property === 'left' || property === 'right') {
            visits++
            return observe(target[property])
          }
          return Reflect.get(target, property)
        },
      })
      proxies.set(node, proxy)
      return proxy
    }
    const edit = diffPieceTableSnapshots(
      { ...before, root: observe(before.root) },
      { ...after, root: observe(after.root) },
    )
    expect(edit).toEqual({ from: 250_000, to: 250_000, text: 'changed' })
    expect(visits).toBeLessThan(300)
  },
)

test('forked append storage and equal text keep minimal diff semantics', () => {
  const original = createPieceTableSnapshot('abc')
  const before = insertIntoPieceTable(original, 1, 'XYZ')
  const after = insertIntoPieceTable(original, 1, 'XQZ')
  expect(diffPieceTableSnapshots(before, after)).toEqual({ from: 2, to: 3, text: 'Q' })
  const equal = insertIntoPieceTable(original, 1, 'XYZ')
  expect(diffPieceTableSnapshots(before, equal)).toBeNull()
})

test('different tree shapes and sparse edits match the string-diff oracle', () => {
  let before = createPieceTableSnapshot('ab'.repeat(1000))
  for (let index = 0; index < 200; index++) {
    const position = (index * 7919) % before.length
    const after = insertIntoPieceTable(before, position, index % 2 ? 'a' : 'b')
    expect(diffPieceTableSnapshots(before, after)).toEqual(
      minimal(materializePieceTableFullText(before), materializePieceTableFullText(after)),
    )
    before = after
  }
})
