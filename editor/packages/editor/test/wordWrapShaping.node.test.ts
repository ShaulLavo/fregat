import { expect, test, vi } from 'vitest'
import {
  appendWordWrapText,
  createWordWrapLine,
  finishWordWrapLine,
} from '../src/virtualization/wordWrap'

const measure = (text: string) => text.length - (text.match(/ii/g)?.length ?? 0) * 0.4

test.each([false, true])('keeps shaping across input chunks with words %s', (words) => {
  const text = 'iiii iiiii iii'
  const rules = { width: 4.4, words, tabSize: 4, advance: () => 1, measure }
  const whole = createWordWrapLine()
  appendWordWrapText(whole, text, 0, text.length, rules)
  finishWordWrapLine(whole, rules)
  const chunked = createWordWrapLine()
  for (let index = 0; index < text.length; index += 1) {
    appendWordWrapText(chunked, text, index, index + 1, rules)
  }
  finishWordWrapLine(chunked, rules)
  expect(chunked.ends).toEqual(whole.ends)
  expect(chunked.segmentVisual).toBeCloseTo(whole.segmentVisual)
  const rows = [0, ...whole.ends, text.length]
  for (let index = 0; index < rows.length - 1; index += 1) {
    expect(measure(text.slice(rows[index], rows[index + 1]).trimEnd())).toBeLessThanOrEqual(4.4)
  }
})

test('starts shaping and tab stops at each new row', () => {
  const rules = { width: 4.4, words: false, tabSize: 4, advance: () => 1, measure }
  const line = createWordWrapLine()
  const text = 'iiii\tiiiiii'
  appendWordWrapText(line, text, 0, text.length, rules)
  finishWordWrapLine(line, rules)
  expect(line.ends).toEqual([5, 10])
  expect(line.segmentVisual).toBe(1)
})

test('measures hanging spaces as a run', () => {
  const shaped = vi.fn(measure)
  const rules = { width: 4, words: true, tabSize: 4, advance: () => 1, measure: shaped }
  const line = createWordWrapLine()
  const text = 'i' + ' '.repeat(20_000) + 'i'
  appendWordWrapText(line, text, 0, text.length, rules)
  finishWordWrapLine(line, rules)
  expect(line.ends).toEqual([20_001])
  expect(shaped.mock.calls.length).toBeLessThan(10)
})
