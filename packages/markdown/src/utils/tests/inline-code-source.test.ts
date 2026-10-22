import type { InlineCode, Nodes } from 'mdast'
import type { Element, Root as HastRoot } from 'hast'
import { beforeAll, expect, test } from 'vitest'
import {
  attachInlineCodeSource,
  decodeCodeLines,
  encodeCodeLines,
  inlineCodeSource,
  publishInlineCodeLines,
  retainInlineCode,
  type CodeOccurrences,
} from '../inline-code-source'
import { createRemarkProcessor } from '../processor'
import { initializeTreeSitterMarkdown, parseTreeSitterMarkdown } from '../tree-sitter-session'
import {
  beginRepair,
  copy,
  insert,
  rewrite,
  toAuthoredOffset,
  type TrackedText,
} from '../repair-origin'

beforeAll(() => initializeTreeSitterMarkdown())
const remark = createRemarkProcessor()
const parsers = [remark.parse.bind(remark), parseTreeSitterMarkdown]
function codes(node: Nodes): InlineCode[] {
  if (node.type === 'inlineCode') return [node]
  return 'children' in node ? node.children.flatMap(codes) : []
}
function parsed(source: string): InlineCode[] {
  return parsers.flatMap((parse) => codes(parse(source)))
}
function input(text: string): TrackedText {
  return beginRepair({ text, start: toAuthoredOffset(0), point: { line: 1, column: 1, offset: 0 } })
}
function emitted(node: InlineCode, prepared: TrackedText) {
  const occurrences: CodeOccurrences = new Map()
  retainInlineCode(node, prepared, occurrences)
  const element: Element = {
    type: 'element',
    tagName: 'code',
    properties: {},
    children: [{ type: 'text', value: node.value.replace(/\r?\n|\r/g, ' ') }],
    position: node.position,
  }
  const root: HastRoot = { type: 'root', children: [element] }
  publishInlineCodeLines(root, occurrences)
  return decodeCodeLines(
    String(element.properties.dataSourceCodeLines),
    element.children[0]?.type === 'text' ? element.children[0].value.length : 0,
  )
}

test.each(['\n', '\r\n', '\r'])('records actual literal token contributions for %j', (eol) => {
  const source = `\`one${eol}two\``
  for (const node of parsed(source)) {
    expect(inlineCodeSource(node)).toEqual({
      value: `one${eol}two`,
      tokenLength: source.length,
      runs: [{ kind: 'copy', valueStart: 0, length: 6 + eol.length, tokenOffset: 1 }],
    })
    expect(emitted(node, input(source))).toEqual({
      length: 7,
      runs: [
        { from: 0, to: 3, firstLine: 1, lastLine: 1 },
        { from: 3, to: 4, firstLine: 1, lastLine: 2 },
        { from: 4, to: 7, firstLine: 2, lastLine: 2 },
      ],
    })
  }
})

test.each([
  ['`\none\ntwo\n`', 2, 3],
  ['> `one\n> two`', 1, 2],
  ['- `one\n  two`', 1, 2],
  ['> - `one\n>   two`', 1, 2],
  ['> `one\ntwo`', 1, 2],
  ['ref[^x]\n\n[^x]: `one\n    two`', 3, 4],
] as const)('omits invisible padding and container units in %j', (source, firstLine, lastLine) => {
  for (const node of parsed(source)) {
    const lines = emitted(node, input(source))
    expect(lines?.length).toBe(7)
    expect(lines?.runs[0]).toMatchObject({ from: 0, to: 3, firstLine })
    expect(lines?.runs.at(-1)).toMatchObject({ from: 4, to: 7, lastLine })
  }
})

test('records table escaped pipes as local atoms', () => {
  const source = '| a |\n| - |\n| `a\\|b` |'
  for (const node of parsed(source)) {
    expect(node.value).toBe('a|b')
    expect(inlineCodeSource(node)?.runs).toContainEqual({
      kind: 'atom',
      valueStart: 1,
      valueLength: 1,
      tokenOffset: 2,
      sourceLength: 2,
    })
    expect(emitted(node, input(source))).toEqual({
      length: 3,
      runs: [{ from: 0, to: 3, firstLine: 3, lastLine: 3 }],
    })
  }
})

test.each([
  '`a\tb`',
  '`a\0b`',
  '`😀e\u0301\ud800\n\udfff🧑‍💻`',
  '``a`b\nc``',
  '`   `',
  '` &amp; \\x `',
])('retains complete UTF16 coverage for %j', (source) => {
  for (const node of parsed(source)) {
    const map = inlineCodeSource(node)
    expect(map).not.toBeNull()
    expect(emitted(node, input(source))?.length).toBe(node.value.replace(/\r?\n|\r/g, ' ').length)
  }
})

function mappedLiteral(prepared: TrackedText, value: string): InlineCode {
  const node: InlineCode = {
    type: 'inlineCode',
    value,
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: prepared.text.length + 1, offset: prepared.text.length },
    },
  }
  attachInlineCodeSource(node, {
    value,
    tokenLength: prepared.text.length,
    runs: [{ kind: 'copy', valueStart: 0, length: value.length, tokenOffset: 1 }],
  })
  return node
}

test('composes synthetic holes and deletion seams from exact repair runs', () => {
  const original = input('`ab`')
  const changed = rewrite({
    input: original,
    owner: 'remend',
    site: 'test.literal',
    parts: [copy(original, 0, 2), insert(original, 'XY', 2), copy(original, 2)],
    expected: '`aXYb`',
  })
  expect(emitted(mappedLiteral(changed, 'aXYb'), changed)).toEqual({
    length: 4,
    runs: [
      { from: 0, to: 1, firstLine: 1, lastLine: 1 },
      { from: 3, to: 4, firstLine: 1, lastLine: 1 },
    ],
  })
  const multiline = input('`a\nb`')
  const deleted = rewrite({
    input: multiline,
    owner: 'remend',
    site: 'test.seam',
    parts: [copy(multiline, 0, 2), copy(multiline, 3)],
    expected: '`ab`',
  })
  expect(emitted(mappedLiteral(deleted, 'ab'), deleted)).toEqual({
    length: 2,
    runs: [
      { from: 0, to: 1, firstLine: 1, lastLine: 1 },
      { from: 1, to: 2, firstLine: 2, lastLine: 2 },
    ],
  })
})

test('synthetic-only literals carry an exact empty authored view', () => {
  const original = input('``')
  const changed = rewrite({
    input: original,
    owner: 'remend',
    site: 'test.synthetic',
    parts: [copy(original, 0, 1), insert(original, 'word', 1), copy(original, 1)],
    expected: '`word`',
  })
  expect(emitted(mappedLiteral(changed, 'word'), changed)).toEqual({ length: 4, runs: [] })
})

test('stale values and corrupt interval coverage remain unmapped', () => {
  const prepared = input('`ab`')
  const node = mappedLiteral(prepared, 'ab')
  node.value = 'XY'
  expect(emitted(node, prepared)).toBeNull()
  attachInlineCodeSource(node, {
    value: 'XY',
    tokenLength: 4,
    runs: [{ kind: 'copy', valueStart: 1, length: 2, tokenOffset: 1 }],
  })
  expect(emitted(node, prepared)).toBeNull()
})

test('line codec validates coverage bounds and exact rendered length', () => {
  const lines = { length: 5, runs: [{ from: 1, to: 4, firstLine: 2, lastLine: 2 }] }
  expect(decodeCodeLines(encodeCodeLines(lines), 5)).toEqual(lines)
  for (const value of [
    '0',
    '{}',
    '[5,0,6,1,1]',
    '[5,2,1,1,1]',
    '[5,0,2,0,1]',
    '[5,0,3,1,1,2,4,1,1]',
    '[5,0,3,2,1]',
    '[5,0,3,1.5,2]',
  ])
    expect(decodeCodeLines(value, 5)).toBeNull()
  expect(decodeCodeLines(encodeCodeLines(lines), 4)).toBeNull()
})

test('virtual tab padding and NUL are local atoms with independent source-unit witnesses', () => {
  for (const node of parsed('>\t`a\n>\tb`')) {
    expect(inlineCodeSource(node)?.runs).toContainEqual({
      kind: 'atom',
      valueStart: 2,
      valueLength: 2,
      tokenOffset: 4,
      sourceLength: 1,
    })
    expect(inlineCodeSource(node)?.runs.at(-1)).toEqual({
      kind: 'copy',
      valueStart: 4,
      length: 1,
      tokenOffset: 5,
    })
  }
  for (const node of parsed('`a\0b`'))
    expect(inlineCodeSource(node)?.runs).toContainEqual({
      kind: 'atom',
      valueStart: 1,
      valueLength: 1,
      tokenOffset: 2,
      sourceLength: 1,
    })
})

test('rejects mismatched copy witnesses and prepared windows as unknown', () => {
  const original = input('`ab`')
  const node = mappedLiteral(original, 'ab')
  expect(emitted(node, input('`XY`'))).toBeNull()
  expect(emitted(node, input('`a'))).toBeNull()
})

function measuredCodeComposition(lines: number) {
  const source = '> `x' + '\n> x'.repeat(lines - 1) + '`'
  const node = codes(remark.parse(source))[0]!
  const map = inlineCodeSource(node)
  if (!map) throw new TypeError('Expected literal source runs')
  let visits = 0
  for (const run of map.runs) {
    const valueStart = run.valueStart
    Object.defineProperty(run, 'valueStart', {
      configurable: true,
      get() {
        visits += 1
        return valueStart
      },
    })
  }
  const result = emitted(node, input(source))
  return { visits, result }
}

test.each([128, 256, 512, 1024])(
  'ordered composition bounds source-run work for %i lines',
  (lines) => {
    const { visits, result } = measuredCodeComposition(lines)
    expect(result?.length).toBe(2 * lines - 1)
    const expected = Array.from({ length: lines }, (_, index) =>
      [{ from: 2 * index, to: 2 * index + 1, firstLine: index + 1, lastLine: index + 1 }].concat(
        index + 1 < lines
          ? [{ from: 2 * index + 1, to: 2 * index + 2, firstLine: index + 1, lastLine: index + 2 }]
          : [],
      ),
    ).flat()
    expect(result?.runs).toEqual(expected)
    expect(visits).toBeLessThanOrEqual(24 * lines)
  },
)

test('ordered pipe slices retain each local atom and the final literal tail', () => {
  const source = '| a |\n| - |\n| `a\\|b\\|c` |'
  for (const node of parsed(source)) {
    expect(node.value).toBe('a|b|c')
    expect(inlineCodeSource(node)?.runs).toEqual([
      { kind: 'copy', valueStart: 0, length: 1, tokenOffset: 1 },
      { kind: 'atom', valueStart: 1, valueLength: 1, tokenOffset: 2, sourceLength: 2 },
      { kind: 'copy', valueStart: 2, length: 1, tokenOffset: 4 },
      { kind: 'atom', valueStart: 3, valueLength: 1, tokenOffset: 5, sourceLength: 2 },
      { kind: 'copy', valueStart: 4, length: 1, tokenOffset: 7 },
    ])
    expect(emitted(node, input(source))).toEqual({
      length: 5,
      runs: [{ from: 0, to: 5, firstLine: 3, lastLine: 3 }],
    })
  }
})
