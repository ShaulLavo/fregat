import type { Link, Nodes, Root } from 'mdast'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { describe, expect, test } from 'vitest'

import { remarkCjkAutolinkBoundaries } from '../cjk-autolinks'
import { remarkCodeMeta } from '../code-meta'
import { createRemarkProcessor } from '../processor'

function originalProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkCjkFriendly)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkCjkFriendlyGfmStrikethrough)
    .use(remarkCjkAutolinkBoundaries)
    .use(remarkCodeMeta)
}

function parse(source: string): Root {
  const processor = createRemarkProcessor()
  return processor.runSync(processor.parse(source))
}

function links(tree: Root): Link[] {
  const found: Link[] = []
  visit(tree, 'link', (link) => {
    found.push(link)
  })
  return found
}

function withoutPositions(node: Nodes): unknown {
  const { position: _position, ...rest } = node
  if (!('children' in node)) return rest
  return { ...rest, children: node.children.map(withoutPositions) }
}

const encodedUrl = 'https&colon;//example.test/a&amp;b\\_c&fjlig;'
const decodedUrl = 'https://example.test/a&b_cfj'
const prefix = '😀前 &amp; \\* [x('
const encodedSource = `${prefix}${encodedUrl})]`
const quotedPrefix = '> 😀 &amp; [x('
const repeatedLine = `${quotedPrefix}${encodedUrl})]`
const crlfSource = `${repeatedLine}\r\n${repeatedLine}`

describe('GFM fallback token positions', () => {
  test('escaped punctuation and entities map to their complete source tokens', () => {
    const [link] = links(parse(encodedSource))
    expect(link?.url).toBe(decodedUrl)
    expect(link?.position).toEqual({
      start: { line: 1, column: prefix.length + 1, offset: prefix.length },
      end: {
        line: 1,
        column: prefix.length + encodedUrl.length + 1,
        offset: prefix.length + encodedUrl.length,
      },
    })
    expect(link?.children[0]?.position).toEqual(link?.position)
    expect(
      link?.position && encodedSource.slice(link.position.start.offset, link.position.end.offset),
    ).toBe(encodedUrl)
  })

  test('CRLF and container prefixes retain separate identical decoded occurrences', () => {
    const found = links(parse(crlfSource))
    expect(found).toHaveLength(2)
    expect(found.map((link) => link.url)).toEqual([decodedUrl, decodedUrl])
    expect(found.map((link) => link.position)).toEqual(
      [0, 1].map((index) => ({
        start: {
          line: index + 1,
          column: quotedPrefix.length + 1,
          offset: index * (repeatedLine.length + 2) + quotedPrefix.length,
        },
        end: {
          line: index + 1,
          column: quotedPrefix.length + encodedUrl.length + 1,
          offset: index * (repeatedLine.length + 2) + quotedPrefix.length + encodedUrl.length,
        },
      })),
    )
  })

  test('UTF16 offsets preserve astral characters and lone surrogates', () => {
    const start = '😀\ud800 [x('
    const url = 'https&colon;//example.test/🦀'
    const source = `${start}${url})]`
    const [link] = links(parse(source))
    expect(link?.position?.start).toEqual({
      line: 1,
      column: start.length + 1,
      offset: start.length,
    })
    expect(link?.position?.end).toEqual({
      line: 1,
      column: start.length + url.length + 1,
      offset: start.length + url.length,
    })
    expect(link?.children).toEqual([
      { type: 'text', value: 'https://example.test/🦀', position: link?.position },
    ])
    expect(withoutPositions(parse(source))).toEqual(
      withoutPositions(originalProcessor().runSync(originalProcessor().parse(source))),
    )
  })

  test('identical fallback links in one text node retain their token occurrences', () => {
    const token = '[x(https&colon;//example.test/a)]'
    const source = `${token} ${token}`
    const found = links(parse(source))
    expect(found).toHaveLength(2)
    expect(found.map((link) => link.position)).toEqual(
      [0, token.length + 1].map((offset) => ({
        start: { line: 1, column: offset + 4, offset: offset + 3 },
        end: { line: 1, column: offset + token.length - 1, offset: offset + token.length - 2 },
      })),
    )
    expect(found.map((link) => link.children[0]?.position)).toEqual(
      found.map((link) => link.position),
    )
  })

  test.each([
    ['www.example.test/a', 'http://www.example.test/a'],
    ['user&commat;example.test', 'mailto:user@example.test'],
    ['https&#58;//example.test/a', 'https://example.test/a'],
    ['https&#x3a;//example.test/a', 'https://example.test/a'],
  ])('positions fallback URL and email tokens: %s', (token, url) => {
    const [link] = links(parse(`[x(${token})]`))
    expect(link?.url).toBe(url)
    expect(link?.position).toEqual({
      start: { line: 1, column: 4, offset: 3 },
      end: { line: 1, column: token.length + 4, offset: token.length + 3 },
    })
    expect(link?.children[0]?.position).toEqual(link?.position)
  })

  test('preexisting positioned Markdown, angle and literal links are unchanged', () => {
    const source = '[label](https://example.test/a) <https://example.test/b> https://example.test/c'
    const original = originalProcessor()
    expect(parse(source)).toEqual(original.runSync(original.parse(source)))
  })

  test.each([
    encodedSource,
    crlfSource,
    '[x(www.example.test/a)] [x(user&commat;example.test)]',
    '[x(https&colon;//example.test/a)] https://example.test/b',
    '**中文** https://example.test。后\n\n$$\nx+y\n$$\n\n~~删除~~',
    '| text |\n| --- |\n| [x(https&colon;//example.test/a\\|b)] |',
    'setext &amp; [x(https&colon;//example.test/a)]\n---',
    '[x(https&colon;//example.test/a)]  \nsecond\\\nthird\r\nfourth',
    '- [ref]: https://reference.test/\n  [https&colon;//example.test/a][ref] and [x(https&colon;//example.test/a)]\n  [label][ref]',
    '> - 😀 [x(https&colon;//example.test/a)]\r\n>   [x(https&colon;//example.test/a)]',
    '[x(https&colon;//example.test/a)]\r[x(https&colon;//example.test/a)]',
  ])('retains syntax, decoded values, URLs and every existing position: %j', (source) => {
    const original = originalProcessor()
    const before = original.runSync(original.parse(source))
    const after = parse(source)
    expect(withoutPositions(after)).toEqual(withoutPositions(before))
    const existing: Nodes[] = []
    const corrected: Nodes[] = []
    visit(before, (node) => {
      existing.push(node)
    })
    visit(after, (node) => {
      corrected.push(node)
    })
    expect(corrected).toHaveLength(existing.length)
    existing.forEach((node, index) => {
      if (node.position) expect(corrected[index]?.position).toEqual(node.position)
    })
  })
})
