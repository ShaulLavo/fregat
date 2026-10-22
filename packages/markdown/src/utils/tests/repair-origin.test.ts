import { describe, expect, it } from 'vitest'
import {
  beginRepair,
  copy,
  insert,
  localSpan,
  rewrite,
  toAuthoredOffset,
  toPreparedOffset,
  type TrackedText,
} from '../repair-origin'

function authored(text: string, start = 0): TrackedText {
  return beginRepair({
    text,
    start: toAuthoredOffset(start),
    point: { line: 1, column: start + 1, offset: start },
  })
}
function replace(
  input: TrackedText,
  parts: Parameters<typeof rewrite>[0]['parts'],
  expected: string,
  owner: Parameters<typeof rewrite>[0]['owner'] = 'remend',
): TrackedText {
  return rewrite({ input, parts, expected, owner, site: 'witness' })
}

describe('producer origin tape', () => {
  it('initializes readonly candidate and span fields before freezing them', () => {
    const input = authored('abc', 7)
    const span = localSpan(input, 1, 2)
    expect(span.input).toBe(input)
    expect(span.start).toBe(1)
    expect(span.length).toBe(2)
    expect(span.belongsTo(input)).toBe(true)
    expect(Object.isFrozen(span)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(span, 'input')).toEqual({
      value: input,
      writable: false,
      enumerable: true,
      configurable: false,
    })
    expect(input.text).toBe('abc')
    expect(input.window.text).toBe(input.text)
    expect(input.runs).toEqual([{ kind: 'copy', source: { start: 7, length: 3 } }])
    expect(input.receipts).toEqual([])
    expect(typeof input.token).toBe('symbol')
    expect(input.boundary(0)).toEqual({ left: 7, right: 7 })
    expect(Object.isFrozen(input)).toBe(true)
  })

  it('keeps exact UTF-16 intervals including isolated surrogates and the authored base', () => {
    const text = '\ufeff\ud800a\udc00\r\n👩‍💻é'
    const input = authored(text, 37)
    expect(input.text).toBe(text)
    expect(input.runs).toEqual([{ kind: 'copy', source: { start: 37, length: text.length } }])
    expect(input.project(1, 2)).toEqual({
      kind: 'authored',
      span: { start: 38, length: 2 },
      runs: [{ kind: 'copy', source: { start: 38, length: 2 } }],
    })
    expect(input.project(0, 0)).toEqual({ kind: 'boundary', at: 37, gap: { left: 37, right: 37 } })
    expect(toPreparedOffset(37)).toBe(37)
  })

  it('does not select equal occurrences by content', () => {
    const input = authored('same same same')
    const result = replace(input, [copy(input, 0, 4), copy(input, 10, 4)], 'samesame')
    expect(result.runs).toEqual([
      { kind: 'copy', source: { start: 0, length: 4 } },
      { kind: 'copy', source: { start: 10, length: 4 } },
    ])
    expect(result.receipts[0].deletions).toEqual([{ start: 4, length: 6 }])
    expect(result.project(4, 0)).toEqual({ kind: 'boundary', at: 4, gap: { left: 4, right: 10 } })
    expect(result.project(4, 1)).toMatchObject({ kind: 'authored', span: { start: 10, length: 1 } })
    expect(result.project(3, 1)).toMatchObject({ kind: 'authored', span: { start: 3, length: 1 } })
  })

  it('keeps copied and inserted equal characters distinct', () => {
    const input = authored('*')
    const result = replace(input, [copy(input), insert(input, '*', 1)], '**')
    expect(result.slice(0, 1)).toEqual([{ kind: 'copy', source: { start: 0, length: 1 } }])
    expect(result.project(1, 1)).toEqual({
      kind: 'synthetic',
      at: 1,
      runs: [{ kind: 'insert', text: '*', owner: 'remend', gap: { left: 1, right: 1 } }],
    })
  })

  it('inherits the gap but gives insertions inside synthetic text their own owner', () => {
    const input = authored('abDELETEDcd', 20)
    const removed = replace(input, [copy(input, 0, 2), copy(input, 9, 2)], 'abcd')
    const emitted = replace(
      removed,
      [copy(removed, 0, 2), insert(removed, '**', 2), copy(removed, 2)],
      'ab**cd',
    )
    const nested = replace(
      emitted,
      [copy(emitted, 0, 3), insert(emitted, '_', 3), copy(emitted, 3)],
      'ab*_*cd',
      'nestedStrongRepair',
    )
    expect(nested.slice(2, 3)).toEqual([
      { kind: 'insert', text: '*', owner: 'remend', gap: { left: 22, right: 29 } },
      { kind: 'insert', text: '_', owner: 'nestedStrongRepair', gap: { left: 22, right: 29 } },
      { kind: 'insert', text: '*', owner: 'remend', gap: { left: 22, right: 29 } },
    ])
    expect(nested.project(2, 3)).toMatchObject({ kind: 'synthetic', at: 22 })
  })

  it('represents consumed replacements, empty tails and synthetic-only candidates explicitly', () => {
    const input = authored('removed', 90)
    const empty = replace(input, [], '', 'hold')
    expect(empty.project(0, 0)).toEqual({ kind: 'boundary', at: 90, gap: { left: 90, right: 97 } })
    const emitted = replace(empty, [insert(empty, '***', 0)], '***')
    expect(emitted.project(0, 3)).toEqual({
      kind: 'synthetic',
      at: 90,
      runs: [{ kind: 'insert', text: '***', owner: 'remend', gap: { left: 90, right: 97 } }],
    })
    const replacement = replace(input, [insert(input, 'x', 0, 7)], 'x')
    expect(replacement.runs).toEqual([
      { kind: 'insert', text: 'x', owner: 'remend', gap: { left: 90, right: 97 } },
    ])
    const pristineEmpty = authored('', 90)
    expect(pristineEmpty.project(0, 0)).toEqual({
      kind: 'boundary',
      at: 90,
      gap: { left: 90, right: 90 },
    })
  })

  it('retains a nonempty deletion gap at every boundary between synthetic pieces', () => {
    const input = authored('deleted', 30)
    const emitted = replace(input, [insert(input, '**', 0, 7)], '**')
    const nested = replace(
      emitted,
      [copy(emitted, 0, 1), insert(emitted, '_', 1), copy(emitted, 1)],
      '*_*',
      'nestedStrongRepair',
    )
    expect(nested.boundary(0)).toEqual({ left: 30, right: 37 })
    expect(nested.boundary(1)).toEqual({ left: 30, right: 37 })
    expect(nested.boundary(2)).toEqual({ left: 30, right: 37 })
    expect(nested.boundary(3)).toEqual({ left: 30, right: 37 })
    const extended = replace(
      nested,
      [copy(nested, 0, 1), insert(nested, '!', 1), copy(nested, 1)],
      '*!_*',
    )
    expect(extended.project(1, 1)).toMatchObject({
      kind: 'synthetic',
      at: 30,
      runs: [{ kind: 'insert', text: '!', owner: 'remend', gap: { left: 30, right: 37 } }],
    })
    expect(extended.receipts.at(-1)?.input).toBe(nested.token)
    expect(extended.receipts.at(-1)?.output).toBe(extended.token)
  })

  it('keeps distinct synthetic causes and owners in a synthetic-only projection', () => {
    const input = authored('abcdef')
    const first = replace(input, [insert(input, '**', 0, 2), copy(input, 4, 2)], '**ef')
    const result = replace(first, [copy(first, 0, 2), insert(first, '__', 2, 2)], '**__', 'hold')
    expect(result.project(0, 4)).toEqual({
      kind: 'synthetic',
      at: 0,
      runs: [
        { kind: 'insert', text: '**', owner: 'remend', gap: { left: 0, right: 2 } },
        { kind: 'insert', text: '__', owner: 'hold', gap: { left: 4, right: 6 } },
      ],
    })
  })

  it('maps held EOF to the cut and preserves the original authored window', () => {
    const input = authored('visible hidden', 10)
    const held = replace(input, [copy(input, 0, 7)], 'visible', 'hold')
    expect(held.boundary(7)).toEqual({ left: 17, right: 17 })
    expect(held.window).toBe(input.window)
    expect(held.receipts[0].deletions).toEqual([{ start: 7, length: 7 }])
  })

  it('rejects mixed candidate spans even when their text and origins are equal', () => {
    const input = authored('same')
    const sibling = authored('same')
    expect(() => replace(input, [copy(sibling)], 'same')).toThrow('Invalid repair construction')
    expect(() => replace(input, [insert(sibling, '*', 0)], '*')).toThrow(
      'Invalid repair construction',
    )
    expect(input.token).not.toBe(sibling.token)
  })

  it('rejects reconstruction, copy reordering, overlap, and invalid intervals', () => {
    const input = authored('abcd')
    expect(() => replace(input, [copy(input)], 'abce')).toThrow()
    expect(() => replace(input, [copy(input, 2, 2), copy(input, 0, 2)], 'cdab')).toThrow()
    expect(() => replace(input, [copy(input, 0, 3), copy(input, 2, 2)], 'abccd')).toThrow()
    expect(() => localSpan(input, -1, 1)).toThrow()
    expect(() => localSpan(input, 3, 2)).toThrow()
    expect(() => localSpan(input, 0.5, 1)).toThrow()
    expect(() => toAuthoredOffset(Infinity)).toThrow()
    expect(() => input.project(4, 1)).toThrow()
  })

  it('rejects speculative branches atomically and leaves immutable no-op provenance explicit', () => {
    const input = authored('same')
    const accepted = replace(input, [copy(input)], 'same')
    const rejected = replace(input, [insert(input, 'same', 0, 4)], 'same')
    expect(accepted.text).toBe(rejected.text)
    expect(accepted.runs).not.toEqual(rejected.runs)
    expect(input.receipts).toEqual([])
    expect(input.runs).toEqual([{ kind: 'copy', source: { start: 0, length: 4 } }])
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(accepted.receipts[0].copies[0])).toBe(true)
    expect(Object.isFrozen(accepted.runs[0])).toBe(true)
    expect(accepted.token).not.toBe(input.token)
  })
})
