// yjs/yjs @ d01eefc997cf12d29d5aabea804df5f69c659a79.
// tests/relativePositions.tests.js, testRelativePositionCase1 through Case7,
// checkRelativePositions and testRelativePositionAssociationDifference.
// Adapted to Singapore ID-space edits, asserting ID-to-offset anchors;
// Yjs encoding and follow-redone are outside the package's contract.
// MIT, Copyright (c) 2023 Kevin Jahns and RWTH Aachen University, Germany,
// Chair of Computer Science 5. See ../../THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import { ReferenceEngine } from '../../src/index'
import { replica } from '../fixtures'
import { liveIds } from './adapter'

const cases = [
  { number: 1, insertions: ['1', 'abc', 'z', 'y', 'x'], text: 'xyzabc1' },
  { number: 2, insertions: ['abc'], text: 'abc' },
  { number: 3, insertions: ['abc', '1', 'xyz'], text: 'xyz1abc' },
  { number: 4, insertions: ['1'], text: '1' },
  { number: 5, insertions: ['2', '1'], text: '12' },
  { number: 6, insertions: [], text: '' },
  { number: 7, insertions: ['abcde'], text: 'abcde' },
]

test.each(cases)('Yjs relative-position case $number', ({ number, insertions, text }) => {
  const author = replica('0')
  for (const value of insertions) author.insert(0, value)
  expect(author.engine.text()).toBe(text)
  const restored = new ReferenceEngine()
  restored.restore(author.engine.snapshot())
  const ids = liveIds(author.engine)
  for (let index = 0; index <= text.length; index++) {
    for (const engine of [author.engine, restored]) {
      const left = index === 0 ? 0 : engine.visibleOffset(ids[index - 1]!)! + 1
      const right = index === text.length ? engine.text().length : engine.visibleOffset(ids[index]!)
      expect(left).toBe(index)
      expect(right).toBe(index)
    }
  }
  if (number === 6) expect(restored.origins(0)).toEqual({ originLeft: 'start', originRight: 'end' })
  if (number === 7) expect(restored.visibleOffset(ids[2]!)).toBe(2)
})

test('Yjs left and right anchor associations straddle a new insertion', () => {
  const author = replica('0')
  author.insert(0, '2')
  author.insert(0, '1')
  const [left, right] = liveIds(author.engine)
  author.insert(1, 'x')
  expect(author.engine.text()).toBe('1x2')
  expect(author.engine.visibleOffset(left!)! + 1).toBe(1)
  expect(author.engine.visibleOffset(right!)).toBe(2)
})
