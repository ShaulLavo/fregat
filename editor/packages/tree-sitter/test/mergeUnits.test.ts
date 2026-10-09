import { expect, it } from 'vitest'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { lineMergeUnit } from '../src/treeSitter/mergeUnits'

it.each([
  { text: '', range: { startIndex: 0, endIndex: 0 }, startIndex: 0, endIndex: 0 },
  { text: 'amber\nviolet\n', range: { startIndex: 8, endIndex: 9 }, startIndex: 6, endIndex: 12 },
  { text: 'amber\nviolet\n', range: { startIndex: 1, endIndex: 6 }, startIndex: 0, endIndex: 5 },
  { text: 'amber\nviolet\n', range: { startIndex: 1, endIndex: 7 }, startIndex: 0, endIndex: 12 },
  {
    text: 'amber\nviolet\n',
    range: { startIndex: 13, endIndex: 13 },
    startIndex: 13,
    endIndex: 13,
  },
  { text: '😀 violet', range: { startIndex: 3, endIndex: 9 }, startIndex: 0, endIndex: 9 },
])('uses enclosing lines for $range in $text', ({ text, range, startIndex, endIndex }) => {
  expect(lineMergeUnit(createStringTextSnapshot(text), range)).toEqual({
    source: 'line',
    type: 'line',
    startIndex,
    endIndex,
    parent: null,
    signature: null,
  })
})
