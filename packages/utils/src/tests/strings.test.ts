import { expect, test } from 'vitest'
import { lineStartOffset } from '../strings'

test.each([
  ['', 0, 0],
  ['', 1, null],
  ['one\r\ntwo\n', 1, 5],
  ['one\r\ntwo\n', 2, 9],
  ['one\r\ntwo\n', 3, null],
  ['one\rtwo', 1, null],
] as const)('%j line %i preserves boundaries without caller clamping', (text, line, offset) => {
  expect(lineStartOffset(text, line)).toBe(offset)
})
