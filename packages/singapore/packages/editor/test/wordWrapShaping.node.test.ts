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

test.each([1, 257, 4096])('settles hanging tab runs across %i-unit input chunks', (chunkSize) => {
  for (const count of [1000, 2000, 4000]) {
    const shaped = vi.fn(measure)
    const rules = { width: 4, words: true, tabSize: 4, advance: () => 1, measure: shaped }
    const line = createWordWrapLine()
    const text = 'i' + '\t'.repeat(count) + 'i'
    for (let start = 0; start < text.length; start += chunkSize) {
      appendWordWrapText(line, text, start, Math.min(text.length, start + chunkSize), rules)
    }
    finishWordWrapLine(line, rules)
    expect(line.ends).toEqual([count + 1])
    expect(shaped.mock.calls.length).toBeLessThan(text.length * 4)
    expect(shaped.mock.calls.reduce((total, [run]) => total + run.length, 0)).toBeLessThan(
      text.length * 4,
    )
  }
})

test('moves a shaped tab to the following stop below its native half-ch minimum', () => {
  const rules = {
    width: 12,
    words: false,
    tabSize: 4,
    advance: () => 1,
    measure: (text: string) => text.length * 0.7,
    minimumTabAdvance: 0.5,
  }
  const line = createWordWrapLine()
  appendWordWrapText(line, 'iiiii\t', 0, 6, rules)
  finishWordWrapLine(line, rules)
  expect(line.visual).toBe(4)
  const below = createWordWrapLine()
  appendWordWrapText(below, 'iiiiii\t', 0, 7, { ...rules, measure: (text) => text.length * 0.6 })
  finishWordWrapLine(below, { ...rules, measure: (text) => text.length * 0.6 })
  expect(below.visual).toBe(8)
})
