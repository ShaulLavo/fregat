import { characters } from '../engine-fixture'
// loro-dev/loro @ c00c9fa501f8d32f68d6255eacb7035a67fb6ab6.
// loro-js/tests/richtext-anchors.test.ts, positions convert across Unicode,
// UTF-16, and UTF-8 around anchors; runtime.test.ts, tracks stable cursors
// and replaces deleted anchors, keeps the lazy line index correct across fragmented edits.
// Adapted to Singapore ID-space edits: IDs count UTF-16 code units,
// edits use whole scalar boundaries; Loro IDs count Unicode scalars.
// Copyright (c) 2023 Loro. MIT; see ../../THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import { replica } from '../fixtures'
import { liveIds, network } from './adapter'
import type { OffsetEdit } from '../../src/index'

test('Loro Unicode workload allocates consecutive code-unit IDs', () => {
  const author = replica('0')
  const edit = author.insert(0, 'a😀b中c')
  if (edit.change.kind !== 'insert') throw new TypeError('Expected insert')
  expect(author.engine.text()).toHaveLength(6)
  const bunch = edit.change.start.bunch
  expect(liveIds(author.engine)).toEqual(
    Array.from({ length: 6 }, (_, counter) => ({ bunch, counter })),
  )
  expect(author.engine.visibleOffset({ bunch: edit.change.start.bunch, counter: 3 })).toBe(3)
  author.remove(1, 2)
  expect(author.engine.text()).toBe('ab中c')
  const deleted = characters(author.engine).filter((node) => node.deleted)
  expect(deleted.map((node) => node.id.counter)).toEqual([1, 2])
})

const splitting: readonly OffsetEdit[] = [
  { offset: 2, deleteCount: 0, text: 'x' },
  { offset: 1, deleteCount: 1, text: '' },
  { offset: 2, deleteCount: 1, text: '' },
  { offset: 1, deleteCount: 1, text: 'x' },
]
test.each(splitting)(
  'surrogate-splitting edit $offset/$deleteCount is rejected atomically',
  (edit) => {
    const author = replica('0')
    author.insert(0, 'a😀b中c')
    const before = author.engine.snapshot()
    const pending = author.participant.state().pending
    expect(() => author.participant.local(edit)).toThrow()
    expect(author.engine.snapshot()).toEqual(before)
    expect(author.participant.state().pending).toEqual(pending)
    author.replace(1, 2, '🙂')
    expect(author.engine.text()).toBe('a🙂b中c')
  },
)

test('whole-surrogate-pair replacement reconciles concurrent Unicode insertion', () => {
  const net = network(2)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'a😀b中c' })
  net.flushAll()
  net.disconnect(1)
  const replace = net.edit(0, { offset: 1, deleteCount: 2, text: '🙂' })
  expect(replace.change).toMatchObject({
    kind: 'replace',
    spans: [{ count: 2 }],
    insert: { text: '🙂' },
  })
  net.edit(1, { offset: 3, deleteCount: 0, text: '🚀' })
  const result = net.settle()
  expect(result).toContain('🙂')
  expect(result).toContain('🚀')
  expect(result).not.toContain('😀')
  expect([...result].sort()).toEqual([...'a🙂🚀b中c'].sort())
})

test('Loro stable cursor ID retains its gap after prepend and deletion', () => {
  const author = replica('0')
  author.insert(0, '123')
  const cursor = liveIds(author.engine)[0]!
  author.insert(0, 'abc')
  expect(author.engine.visibleOffset(cursor)).toBe(3)
  author.remove(3, 1)
  expect(author.engine.text()).toBe('abc23')
  expect(author.engine.visibleOffset(cursor)).toBe(3)
  expect(
    characters(author.engine).find(
      (node) => node.id.bunch === cursor.bunch && node.id.counter === cursor.counter,
    )?.deleted,
  ).toBe(true)
})
