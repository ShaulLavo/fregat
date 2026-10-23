import { hash } from 'node:crypto'
import { expect, test } from 'vitest'
import type { blockToHast } from '../../packages/markdown/src/utils/hast'
import { inspectSourceCorrespondence } from './paired-native'

type Root = ReturnType<typeof blockToHast>
type Point = NonNullable<Root['position']>['start']

const sources = [
  { source: '', starts: [0] },
  { source: 'abc', starts: [0] },
  { source: '\r', starts: [0, 1] },
  { source: '\n', starts: [0, 1] },
  { source: '\r\n', starts: [0, 2] },
  { source: 'a\rb\nc\r\nd', starts: [0, 2, 4, 7] },
  { source: '\r\n\r\n', starts: [0, 2, 4] },
  { source: '😀\r\né\nאב\r\ud800x\udc00', starts: [0, 4, 7, 10] },
]

function positionedRoot(point: Point): Root {
  return {
    type: 'root',
    children: [{ type: 'text', value: 'observed', position: { start: point, end: point } }],
  }
}

function coordinateDigest(root: Root) {
  const node = root.children[0]
  return hash(
    'sha256',
    JSON.stringify([{ path: 'root.0', type: node.type, position: node.position }]),
    'hex',
  )
}

function expectPoint(point: Point, source: string, accepted: boolean, invalidOffset = false) {
  const root = positionedRoot(point)
  const reason = invalidOffset
    ? 'source offset is absent or outside projection text.'
    : 'UTF-16 offset disagrees with its source line or column.'
  const failures = accepted ? [] : [`root.0.start: ${reason}`, `root.0.end: ${reason}`]
  expect(inspectSourceCorrespondence(root, source)).toEqual({
    sourceCoordinatesDigest: coordinateDigest(root),
    sourceCoordinateFailures: failures,
    positionedNodes: 1,
  })
}

test.each(sources)(
  'coordinate checks preserve every UTF-16 boundary in $source',
  ({ source, starts }) => {
    for (let offset = 0; offset <= source.length; offset += 1) {
      const lineIndex = starts.findLastIndex((start) => start <= offset)
      const point = { line: lineIndex + 1, column: offset - starts[lineIndex] + 1, offset }
      expectPoint(point, source, true)
      expectPoint({ ...point, line: point.line + 1 }, source, false)
      expectPoint({ ...point, line: point.line - 1 }, source, false)
      expectPoint({ ...point, column: point.column + 1 }, source, false)
      expectPoint({ ...point, column: point.column - 1 }, source, false)
    }
  },
)

test.each([0, -1, 0.5, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER])(
  'coordinate checks reject invalid line %s with the original failures',
  (line) => expectPoint({ line, column: 1, offset: 0 }, 'x\r\ny\nz', false),
)

test.each([undefined, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER])(
  'coordinate checks reject invalid offset %s with the original failures',
  (offset) => expectPoint({ line: 1, column: 1, offset }, 'x\r\ny\nz', false, true),
)

test.each([0, -1, 0.5, NaN, Infinity, -Infinity])(
  'coordinate checks reject invalid column %s with the original failures',
  (column) => expectPoint({ line: 1, column, offset: 0 }, 'x\r\ny\nz', false),
)

test('source indexes belong to the exact current string through edits and surrogate changes', () => {
  const point = { line: 2, column: 1, offset: 2 }
  for (const source of ['a\nb', 'ab\n', 'a\rb', 'a\r\nb', '\ud800\nb', '\udc00\nb']) {
    expectPoint(point, source, source !== 'ab\n' && source !== 'a\r\nb')
  }
  const surrogateBoundary = { line: 1, column: 2, offset: 1 }
  for (const source of ['😀', '\ud800', '\udc00', '\ufffd']) {
    expectPoint(surrogateBoundary, source, true)
  }
})

test('reversed bounds and published source-line mismatches remain independent failures', () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: { dataSourceLine: 1, dataSourceEndLine: 2 },
        children: [],
        position: {
          start: { line: 2, column: 2, offset: 3 },
          end: { line: 1, column: 2, offset: 1 },
        },
      },
    ],
  }
  expect(inspectSourceCorrespondence(root, 'a\nb')).toEqual({
    sourceCoordinatesDigest: coordinateDigest(root),
    sourceCoordinateFailures: [
      'root.0: reversed source bounds.',
      'root.0: published source-line mapping disagrees with node coordinates.',
    ],
    positionedNodes: 1,
  })
})

test.each([undefined, null, true, '1', [], [1], {}, Symbol('line')])(
  'coordinate checks reject a nonnumeric line without coercion',
  (line) => {
    const point = { line: 1, column: 1, offset: 0 }
    Reflect.set(point, 'line', line)
    expectPoint(point, 'a\nb', false)
  },
)
