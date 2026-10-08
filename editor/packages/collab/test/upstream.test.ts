// Workloads ported from loro-dev/loro at c00c9fa501f8d32f68d6255eacb7035a67fb6ab6.
// crates/loro-internal/tests/fugue.rs and src/container/richtext/tracker/crdt_rope.rs.
// Copyright (c) 2023 Loro. MIT; see THIRD_PARTY_LICENSES.
// Three-replica ab case from mweidner037/fugue, yjs-interleave/index.js at 31e74fea67f23add13a5d10f781c0d78edcd14da.
// Copyright (c) 2023 Matthew Weidner and Martin Kleppmann. MIT; see THIRD_PARTY_LICENSES.
import { expect, test } from 'vitest'
import { ReferenceEngine } from '../src/index'
import { accept, replica } from './fixtures'

function merged(...replicas: ReturnType<typeof replica>[]) {
  const engine = new ReferenceEngine()
  for (const author of replicas) for (const edit of author.edits) engine.apply(edit)
  return engine.text()
}

test('Loro forward interleaving', () => {
  const a = replica('0'),
    b = replica('1')
  a.insert(0, 'Hello')
  b.insert(0, ' World!')
  expect(merged(a, b)).toBe('Hello World!')
  expect(merged(b, a)).toBe('Hello World!')
})

test('Loro backward interleaving', () => {
  const a = replica('0'),
    b = replica('1')
  for (const char of 'olleH') a.insert(0, char)
  for (const char of '!dlroW ') b.insert(0, char)
  expect(merged(a, b)).toBe('Hello World!')
  expect(merged(b, a)).toBe('Hello World!')
})

test('Loro mixed forward and backward', () => {
  const a = replica('0'),
    b = replica('1')
  a.insert(0, 'll')
  a.insert(0, 'He')
  a.insert(4, 'o')
  b.insert(0, ' !')
  b.insert(1, 'W')
  b.insert(2, 'd')
  for (const char of 'lro') b.insert(2, char)
  expect(merged(a, b)).toBe('Hello World!')
  expect(merged(b, a)).toBe('Hello World!')
})

test('Loro three-replica Yjs interleave case', () => {
  const a = replica('0'),
    b = replica('1'),
    c = replica('2')
  c.insert(0, '2')
  accept(a.participant, c.edits)
  a.insert(0, '1')
  b.insert(0, 'b')
  expect(merged(c, a, b)).toBe('b12')
  expect(merged(b, c, a)).toBe('b12')
})

test('Fugue three-replica counterexample preserves ab adjacency', () => {
  const a = replica('1'),
    b = replica('2'),
    c = replica('3')
  c.insert(0, 'b')
  accept(a.participant, c.edits)
  a.insert(0, 'a')
  b.insert(0, 'x')
  expect(merged(c, a, b)).toBe('xab')
  expect(merged(b, c, a)).toBe('xab')
  expect(merged(c, b, a)).toContain('ab')
})

test('Loro origins on a live insertion boundary', () => {
  const a = replica('0')
  const initial = a.insert(0, '0123456789')
  if (initial.change.kind !== 'insert') throw new TypeError('Expected insertion')
  const insert = replica('1')
  accept(insert.participant, a.edits)
  expect(insert.insert(5, 'abcdefghij').change).toMatchObject({
    originLeft: { bunch: initial.change.start.bunch, counter: 4 },
    originRight: { bunch: initial.change.start.bunch, counter: 5 },
  })
})

test('Loro origins among tombstones preserve the first hidden right neighbour', () => {
  const a = replica('0')
  const initial = a.insert(0, '0123456789')
  if (initial.change.kind !== 'insert') throw new TypeError('Expected insertion')
  a.remove(5, 2)
  expect(a.participant.text()).toBe('01234789')
  const b = replica('1')
  accept(b.participant, a.edits)
  expect(b.insert(6, 'abcdefghij').change).toMatchObject({
    originLeft: { bunch: initial.change.start.bunch, counter: 7 },
    originRight: { bunch: initial.change.start.bunch, counter: 8 },
  })
  expect(b.insert(5, 'z').change).toMatchObject({
    originLeft: { bunch: initial.change.start.bunch, counter: 4 },
    originRight: { bunch: initial.change.start.bunch, counter: 5 },
  })
})

test('Loro content insertion ignores a hidden run in visible offsets', () => {
  const a = replica('0')
  a.insert(0, '0123456789')
  a.insert(5, 'abcdefghij')
  a.remove(5, 10)
  a.insert(10, 'ABCDEFGHIJ')
  expect(a.participant.text()).toBe('0123456789ABCDEFGHIJ')
  expect(a.engine.snapshot().nodes.filter((node) => node.deleted)).toHaveLength(10)
})

test('Loro deleted inserted run supplies the structural right origin', () => {
  const a = replica('0')
  const base = a.insert(0, '0123456789')
  const run = a.insert(5, 'abcdefghij')
  if (base.change.kind !== 'insert' || run.change.kind !== 'insert')
    throw new TypeError('Expected insertion')
  a.remove(5, 10)
  expect(a.engine.origins(5)).toEqual({
    originLeft: { bunch: base.change.start.bunch, counter: 4 },
    originRight: run.change.start,
  })
  a.insert(5, 'z')
  expect(a.participant.text()).toBe('01234z56789')
})
