import type { Nodes } from 'hast'
import type { InlineCode, Link, Nodes as MdastNodes } from 'mdast'
import { beforeAll, describe, expect, test } from 'vitest'

import { blockToHast, createHastProcessor } from '../hast'
import { createMarkdownSession, type MarkdownSessionFactory } from '../session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../tree-sitter-session'

const cases = [
  { name: 'open fence', source: '```\na\r\nb\n', value: 'a\r\nb\n' },
  { name: 'closed fence', source: '```\na\r\nb\n```', value: 'a\r\nb\n' },
  { name: 'mixed endings', source: '```\r\na\nb\r\nc\r', value: 'a\nb\r\nc\n' },
  { name: 'bare carriage return', source: '```\na\rb\n```', value: 'a\rb\n' },
  { name: 'blank lines', source: '```\na\r\n\r\nb\n```', value: 'a\r\n\r\nb\n' },
  { name: 'leading blank line', source: '```\n\r\na\r\nb\n```', value: '\r\na\r\nb\n' },
  { name: 'empty fence', source: '```\n\r\n```', value: '' },
  { name: 'fence indentation', source: '  ```\na\r\n b\r\nc\n  ```', value: 'a\r\nb\r\nc\n' },
  { name: 'indented code', source: '    a\r\n    b\n', value: 'a\r\nb\n' },
  { name: 'tab-indented code', source: '\ta\r\n\tb\r', value: 'a\r\nb\n' },
  { name: 'indented blank line', source: '    a\r\n\r\n    b\n', value: 'a\r\n\r\nb\n' },
  { name: 'blank before indent', source: '\r\n    a\r\n    b\n', value: 'a\r\nb\n' },
  { name: 'quoted fence', source: '> ```\n> a\r\n> b\n', value: 'a\r\nb\n' },
  { name: 'quoted indent', source: '>     a\r\n>     b\n', value: 'a\r\nb\n' },
  { name: 'list fence', source: '- ```\n  a\r\n  b\n', value: 'a\r\nb\n' },
  {
    name: 'nested list and quote',
    source: '- > ```\r\n  > a\r\n  > b\n  > ```',
    value: 'a\r\nb\n',
  },
  {
    name: 'container-looking contents',
    source: '> ```\n> > a\r\n> -  b\n> ```',
    value: '> a\r\n-  b\n',
  },
  { name: 'CR-only quoted fence', source: '> ```\r> a\r> b\r> ```', value: 'a\rb\n' },
  { name: 'CR-only list fence', source: '- ```\r  a\r  b\r', value: 'a\rb\n' },
  { name: 'CR-only quoted indent', source: '>     a\r>     b\r', value: 'a\rb\n' },
  { name: 'CR-only list indent', source: '-     a\r      b\r', value: 'a\rb\n' },
  { name: 'list indent', source: '-     a\r\n      b\r\n', value: 'a\r\nb\n' },
  {
    name: 'CR-only nested fence',
    source: '- > ```\r  > a\r  > b\r  > ```',
    value: 'a\rb\n',
  },
  { name: 'single line inline code', source: '`a  b`', value: 'a  b' },
] satisfies readonly { name: string; source: string; value: string }[]

const containers = [
  ['paragraph', 'a', '  b'],
  ['quote', '> a', '>   b'],
  ['nested quotes', '> > a', '> >   b'],
  ['list', '- a', '    b'],
  ['quote in list', '- > a', '  >   b'],
  ['list in quote', '> - a', '>     b'],
] satisfies readonly [string, string, string][]

const processor = createHastProcessor({ raw: null, math: null })

beforeAll(() => initializeTreeSitterMarkdown())

describe('tree-sitter literal source fidelity', () => {
  test.each(cases)(
    '$name preserves the exact code text painted by the renderer',
    ({ source, value }) => {
      expect(renderCode(createMarkdownSession, source)).toEqual([value])
      expect(renderCode(createTreeSitterMarkdownSession, source)).toEqual([value])
    },
  )

  test.each(['\r', '\r\n', '\n'])(
    'softbreak %j excludes container syntax and indentation',
    (ending) => {
      for (const [name, first, second] of containers) {
        const source = first + ending + second
        const expected = renderText(createMarkdownSession, source)
        expect(expected, name).toContain('a' + ending + 'b')
        expect(renderText(createTreeSitterMarkdownSession, source), name).toBe(expected)
      }
    },
  )
})

function renderText(factory: MarkdownSessionFactory, source: string): string {
  return factory()
    .update(source, { heal: false })
    .map((block) => textContent(blockToHast(block, processor)))
    .join('')
}

function textContent(node: Nodes): string {
  if (node.type === 'text') return node.value
  if (!('children' in node)) return ''
  return node.children.map(textContent).join('')
}

function renderCode(factory: MarkdownSessionFactory, source: string): string[] {
  return factory()
    .update(source, { heal: false })
    .flatMap((block) => blockToHast(block, processor).children)
    .flatMap(codeText)
}

function codeText(node: Nodes): string[] {
  if (node.type === 'element' && node.tagName === 'code') {
    return [node.children.map((child) => (child.type === 'text' ? child.value : '')).join('')]
  }
  if (!('children' in node)) return []
  return node.children.flatMap(codeText)
}

const inlineCodeCases = [
  ['LF', '`a\n b`', 'a\n b', 'a b'],
  ['CRLF', '`a\r\n b`', 'a\r\n b', 'a b'],
  ['CR', '`a\r b`', 'a\r b', 'a b'],
  ['blockquote', '> `a\n>  b`', 'a\n b', 'a b'],
  ['list', '- `a\n   b`', 'a\n b', 'a b'],
  ['nested container', '> - `a\r\n>    b`', 'a\r\n b', 'a b'],
] satisfies readonly [string, string, string, string][]

describe('tree-sitter inline source metadata', () => {
  test.each(inlineCodeCases)(
    '%s preserves inline code source spelling across line endings and containers',
    (_, source, sourceValue, canonicalValue) => {
      const code = firstNode(createTreeSitterMarkdownSession, source, isInlineCode)
      expect(code?.value).toBe(sourceValue)
      expect(code?.value).not.toBe(canonicalValue)
    },
  )

  test.each([
    ['LF', '[^x]: `a\n b`', 'a\n b'],
    ['CRLF', '[^x]: `a\r\n b`', 'a\r\n b'],
    ['CR', '[^x]: `a\r b`', 'a\r b'],
  ] as const)('%s preserves inline code source spelling in footnotes', (_, source, sourceValue) => {
    const code = firstNode(createTreeSitterMarkdownSession, source, isInlineCode)
    expect(code?.value).toBe(sourceValue)
  })

  test('preserves the escaped pipe in an inline code table cell', () => {
    const source = '| a |\n|---|\n| `x\\|y` |'
    const code = firstNode(createTreeSitterMarkdownSession, source, isInlineCode)

    expect(code?.value).toBe('x|y')
    expect(code?.position).toEqual({
      start: { offset: 14, line: 3, column: 3 },
      end: { offset: 20, line: 3, column: 9 },
    })
  })

  test.each([
    [
      'https://example.test/a?a=1&amp;b=2',
      'https://example.test/a?a=1&amp;b=2',
      'https://example.test/a?a=1&amp;b=2',
    ],
    [
      'www.example.test/a?a=1&amp;b=2',
      'http://www.example.test/a?a=1&amp;b=2',
      'www.example.test/a?a=1&amp;b=2',
    ],
    ['person@example.test', 'mailto:person@example.test', 'person@example.test'],
  ] as const)('uses literal GFM link source text and URL for %s', (source, url, text) => {
    const link = firstNode(createTreeSitterMarkdownSession, source, isLink)

    expect(link?.url).toBe(url)
    expect(link?.children[0]).toMatchObject({ type: 'text', value: text })
  })

  test.each([
    ['[x](https://example.test/a?a=1&amp;b=2)', 'https://example.test/a?a=1&b=2', 'x'],
    [
      '<https://example.test/a?a=1&amp;b=2>',
      'https://example.test/a?a=1&b=2',
      'https://example.test/a?a=1&b=2',
    ],
  ] as const)('keeps canonical URL and text for %s', (source, url, text) => {
    const link = firstNode(createTreeSitterMarkdownSession, source, isLink)

    expect(link?.url).toBe(url)
    expect(link?.children[0]).toMatchObject({ type: 'text', value: text })
  })

  test('keeps authored positions for a GFM link inside unmatched brackets', () => {
    const source = '[https://example.test/a]'
    const link = firstNode(createTreeSitterMarkdownSession, source, isLink)

    expect(link?.position).toEqual({
      start: { offset: 1, line: 1, column: 2 },
      end: { offset: 23, line: 1, column: 24 },
    })
    expect(link?.children[0]?.position).toEqual(link?.position)
  })
})

function firstNode<T extends MdastNodes>(
  factory: MarkdownSessionFactory,
  source: string,
  predicate: (node: MdastNodes) => node is T,
): T | undefined {
  const nodes = factory()
    .update(source, { heal: false })
    .flatMap((block) => block.nodes)
  return findNode(nodes, predicate)
}

function findNode<T extends MdastNodes>(
  nodes: readonly MdastNodes[],
  predicate: (node: MdastNodes) => node is T,
): T | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node
    if (!('children' in node)) continue

    const found = findNode(node.children, predicate)
    if (found) return found
  }
  return undefined
}

function isInlineCode(node: MdastNodes): node is InlineCode {
  return node.type === 'inlineCode'
}

function isLink(node: MdastNodes): node is Link {
  return node.type === 'link'
}
