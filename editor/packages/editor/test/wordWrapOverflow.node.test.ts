import { expect, test } from 'vitest'
import {
  appendWordWrapText,
  createWordWrapLine,
  finishWordWrapLine,
} from '../src/virtualization/wordWrap'

test('rechecks an oversized word after moving it to a fresh row', () => {
  const text = ' bbb'
  const rules = {
    width: 4,
    words: true,
    tabSize: 4,
    advance: (point: number) => (point === 32 ? 1 : 1.5),
  }
  const line = createWordWrapLine()
  appendWordWrapText(line, text, 0, text.length, rules)
  finishWordWrapLine(line, rules)
  expect(line.ends).toEqual([1, 3])
})
