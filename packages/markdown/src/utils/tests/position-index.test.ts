import { expect, test } from 'vitest'

import { projectPosition, resolvePositions, sourcePoint } from '../positions'
import { beginRepair, rewrite, copy, insert, toAuthoredOffset } from '../repair-origin'

type Point = ReturnType<typeof sourcePoint>

const bases: readonly Point[] = [
  { line: 1, column: 1, offset: 0 },
  { line: 7, column: 11, offset: 31 },
  { line: 2, column: 3, offset: 900 },
]

function scannedPoint(text: string, local: number, base: Point): Point {
  let line = base.line
  let column = base.column
  for (let index = 0; index < local; index += 1) {
    const character = text[index]
    if (character === '\r' && text[index + 1] === '\n' && index + 1 === local) {
      column += 1
      continue
    }
    if (character === '\r' && text[index + 1] === '\n') index += 1
    if (character === '\r' || character === '\n') {
      line += 1
      column = 1
      continue
    }
    column += 1
  }
  return { line, column, offset: base.offset + local }
}

function checkEveryPoint(text: string, base: Point): void {
  for (let local = 0; local <= text.length; local += 1) {
    const expected = scannedPoint(text, local, base)
    expect(sourcePoint(text, base.offset + local, base)).toEqual(expected)
    const point = { line: expected.line, column: expected.column }
    const tree = { position: { start: point, end: point } }
    resolvePositions(tree, text, base)
    expect(tree.position).toEqual({ start: expected, end: expected })
  }
}

test.each([
  '',
  'x',
  '\r',
  '\n',
  '\r\n',
  '\r\r\n\n\r',
  '\n\r\n',
  '\uFEFFa\r\nb\rc\n',
  '\ud800\r\n\udfff',
  '🧑‍💻e\u0301\n\uFEFF',
])('indexed UTF16 points and their inverse match the scanner for %j', (text) => {
  for (const base of bases) checkEveryPoint(text, base)
})

test('the interior CRLF offset remains on its preceding line', () => {
  expect(sourcePoint('a\r\nb', 2)).toEqual({ line: 1, column: 3, offset: 2 })
  expect(sourcePoint('a\r\nb', 3)).toEqual({ line: 2, column: 1, offset: 3 })
})

test('reusing a base with different text, offsets and columns cannot reuse stale coordinates', () => {
  const base = { line: 4, column: 6, offset: 20 }
  checkEveryPoint('a\r\nb', base)
  checkEveryPoint('ab\nc', base)
  checkEveryPoint('a\r\nb', base)
  base.line = 9
  base.column = 2
  base.offset = 72
  checkEveryPoint('a\r\nb', base)
  checkEveryPoint('abcd', base)
})

function repaired(text: string, start: number, base: Point) {
  const input = beginRepair({ text, start: toAuthoredOffset(start), point: base })
  return rewrite({
    input,
    owner: 'remend',
    site: 'position-index-test',
    parts: [copy(input, 0, 1), insert(input, '\nX', 1), copy(input, 1)],
    expected: text.slice(0, 1) + '\nX' + text.slice(1),
  })
}

function checkProjection(input: ReturnType<typeof repaired>, local: number): void {
  const point = sourcePoint(input.text, input.window.start + local, input.window.point)
  const projected = projectPosition(input, { start: point, end: point })
  const origin = input.project(local, 0)
  const offset = origin.kind === 'authored' ? origin.span.start : origin.at
  expect(projected.position.start).toEqual(
    sourcePoint(input.window.text, offset, input.window.point),
  )
  expect(projected.origin).toEqual(origin)
}

test('prepared and authored indexes stay separate across equal-length windows and projections', () => {
  const first = repaired('a\r\nb', 40, { line: 3, column: 5, offset: 40 })
  const second = repaired('ab\nc', 70, { line: 8, column: 2, offset: 70 })
  for (const input of [first, second, first]) {
    for (let local = 0; local <= input.text.length; local += 1) checkProjection(input, local)
  }
})

const malformed: readonly { line: number; column: number; offset?: number }[] = [
  { line: 0, column: 1, offset: 0 },
  { line: 1, column: 0, offset: 0 },
  { line: 1.5, column: 1, offset: 0 },
  { line: 1, column: NaN, offset: 0 },
  { line: Infinity, column: 1 },
  { line: 1, column: 1, offset: -1 },
  { line: 1, column: 1, offset: 0.5 },
  { line: 1, column: 1, offset: Number.MAX_SAFE_INTEGER + 1 },
  { line: 1, column: 2, offset: 0 },
  { line: 1, column: 5 },
  { line: 2, column: 3 },
  { line: 3, column: 1 },
]

test.each(malformed)('malformed coordinates remain rejected: %j', (point) => {
  expect(() => resolvePositions({ position: { start: point, end: point } }, 'a\r\nb')).toThrowError(
    expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
  )
})

test('reversed intervals remain rejected', () => {
  expect(() =>
    resolvePositions(
      { position: { start: sourcePoint('ab', 2), end: sourcePoint('ab', 1) } },
      'ab',
    ),
  ).toThrowError(expect.objectContaining({ code: 'MARKDOWN_POSITION' }))
})

test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'unsafe or out-of-domain offsets remain rejected: %s',
  (offset) => {
    expect(() => sourcePoint('abc', offset)).toThrowError(
      expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
    )
  },
)

test('invalid bases and coordinate overflow are rejected', () => {
  expect(() => sourcePoint('a', 1, { line: 1, column: 1, offset: -1 })).toThrow()
  expect(() => sourcePoint('a', 0, { line: 0, column: 1, offset: 0 })).toThrow()
  expect(() => sourcePoint('a', 0, { line: 1, column: 0.5, offset: 0 })).toThrow()
  expect(() =>
    sourcePoint('\n', 1, { line: Number.MAX_SAFE_INTEGER, column: 1, offset: 0 }),
  ).toThrow()
  expect(() =>
    sourcePoint('a', 1, { line: 1, column: Number.MAX_SAFE_INTEGER, offset: 0 }),
  ).toThrow()
})
