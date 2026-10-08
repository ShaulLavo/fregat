// loro-dev/loro @ c00c9fa501f8d32f68d6255eacb7035a67fb6ab6.
// loro-js/tests/fugue-index.test.ts, older-origin and concurrent-root regressions.
// Loro expects AXYBN under its Fugue order; the pinned FugueMax oracle gives AYXBN.
// crates/loro-internal/src/container/richtext/tracker/crdt_rope.rs,
// should_ignore_future_spans_when_getting_origin_left.
// Adapted to Singapore ID-space edits. Copyright (c) 2023 Loro.
// MIT; see ../../THIRD_PARTY_TEST_NOTICES.md.
import { describe, expect, test } from 'vitest'
import { causalAuthor, mergeCausal } from './adapter'
import { fugueMaxAuthor } from './fixtures/fugue-max-oracle'

function olderOrigin() {
  const a = causalAuthor('1'),
    b = causalAuthor('2'),
    y = causalAuthor('3'),
    n = causalAuthor('4')
  a.insert(0, 'A')
  b.insert(0, 'B')
  n.insert(0, 'N')
  y.observe([...a.edits, ...n.edits])
  expect(y.engine.text()).toBe('AN')
  const insertedY = y.insert(1, 'Y')
  a.observe([...b.edits, ...n.edits])
  expect(a.engine.text()).toBe('ABN')
  const insertedX = a.insert(1, 'X')
  expect(insertedY.change).toMatchObject({
    originLeft: { bunch: '1:1', counter: 0 },
    originRight: { bunch: '4:1', counter: 0 },
  })
  expect(insertedX.change).toMatchObject({
    originLeft: { bunch: '1:1', counter: 0 },
    originRight: { bunch: '2:1', counter: 0 },
  })
  return [a.edits, b.edits, y.edits, n.edits]
}

function concurrentRoot() {
  const x = causalAuthor('1'),
    b = causalAuthor('2'),
    n = causalAuthor('4')
  x.insert(0, 'x')
  b.observe(x.edits)
  x.insert(1, 'aaaa')
  n.insert(0, 'n')
  b.insert(1, 'b')
  expect(b.engine.text()).toBe('xb')
  return [x.edits, b.edits, n.edits]
}

describe('portable Loro regression assertions', () => {
  test('older-origin workload keeps every character across causal delivery orders', () => {
    const groups = olderOrigin()
    const forward = mergeCausal(groups).text()
    expect([...forward].sort().join('')).toBe('ABNXY')
    expect(mergeCausal([...groups].reverse()).text()).toBe(forward)
    expect(mergeCausal([groups[3]!, groups[1]!, groups[2]!, groups[0]!]).text()).toBe(forward)
  })

  test('concurrent-root workload preserves the typed run and all characters', () => {
    const groups = concurrentRoot()
    const forward = mergeCausal(groups).text()
    expect(forward).toContain('aaaa')
    expect([...forward].sort().join('')).toBe('aaaabnx')
    for (const order of [
      [0, 2, 1],
      [1, 2, 0],
      [2, 0, 1],
    ]) {
      expect(mergeCausal(order.map((index) => groups[index]!)).text()).toBe(forward)
    }
  })

  test('unobserved future insertion supplies neither origin at authoring time', () => {
    const base = causalAuthor('0'),
      future = causalAuthor('1'),
      author = causalAuthor('2')
    base.insert(0, '0123456789')
    future.observe(base.edits)
    future.insert(5, 'abcdefghij')
    author.observe(base.edits)
    const edit = author.insert(5, 'z')
    expect(edit.change).toMatchObject({
      originLeft: { bunch: '0:1', counter: 4 },
      originRight: { bunch: '0:1', counter: 5 },
    })
    expect(mergeCausal([future.edits, author.edits]).text()).toContain('z')
  })
})

describe('FugueMax literal orders for the Loro regression workloads', () => {
  test('AXYBN workload becomes AYXBN under FugueMax', () => {
    const a = fugueMaxAuthor('1'),
      b = fugueMaxAuthor('2'),
      y = fugueMaxAuthor('3'),
      n = fugueMaxAuthor('4')
    a.insert(0, 'A')
    b.insert(0, 'B')
    n.insert(0, 'N')
    y.observe([...a.edits, ...n.edits])
    expect(y.text()).toBe('AN')
    y.insert(1, 'Y')
    a.observe([...b.edits, ...n.edits])
    expect(a.text()).toBe('ABN')
    a.insert(1, 'X')
    a.observe(y.edits)
    // FugueMax orders A's right children by reverse right-origin order (N before B).
    expect(a.text()).toBe('AYXBN')
    expect(mergeCausal(olderOrigin()).text()).toBe(a.text())
  })
  test('xaaaabn', () => {
    expect(mergeCausal(concurrentRoot()).text()).toBe('xaaaabn')
  })
})
