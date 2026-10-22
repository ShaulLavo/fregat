import { createHash } from 'node:crypto'

import type { Nodes as HastNodes } from 'hast'
import type { Nodes, Root } from 'mdast'
import { toHast } from 'mdast-util-to-hast'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, test } from 'vitest'

import { createRemarkProcessor } from '../processor'

import { independentAttentionCases, type AttentionCore } from './attention-commonmark'

function parse(source: string): Root {
  const processor = createRemarkProcessor()
  return processor.runSync(processor.parse(source))
}

function inline(node: Nodes): string {
  if (node.type === 'text') return node.value
  if (node.type === 'inlineCode') return `<code>${node.value}</code>`
  if (node.type === 'inlineMath') return `<math>${node.value}</math>`
  if (!('children' in node)) return ''
  const children = node.children.map(inline).join('')
  if (node.type === 'emphasis') return `<em>${children}</em>`
  if (node.type === 'strong') return `<strong>${children}</strong>`
  if (node.type === 'delete') return `<del>${children}</del>`
  return children
}

// Exact independent current-CommonMark receipts: r74 new-10 through new-13 and new-01.
describe('attention uses original delimiter-run lengths', () => {
  test.each([
    ['A ****sd** me**ssage.\n\n', 'A **<strong>sd</strong> me**ssage.'],
    ['A ****sd** me**ssage.\n\n\n\n', 'A **<strong>sd</strong> me**ssage.'],
    ['A ****sd*e**ssage.\n\n\n\n', 'A ***<em>sd</em>e**ssage.'],
    ['A ****sd*```\ne**ssage.\n\n\n\n', 'A ***<em>sd</em>```\ne**ssage.'],
    ['A **`*s]de**-` d*$x$$*_x$*```', 'A *<em><code>*s]de**-</code> d</em>$x$$<em>_x$</em>```'],
  ])('preserves independent allocation for %j', (source, expected) => {
    expect(inline(parse(source))).toBe(expected)
  })
})

describe('adjacent attention markers', () => {
  test.each(['a*_b*', 'a**_b**', '*a_*b'])('keeps %s literal', (source) => {
    expect(inline(parse(source))).toBe(source)
  })

  test('retains GFM tilde participation and ordinary mixed-marker nesting', () => {
    expect(inline(parse('*~~a~~*'))).toBe('<em><del>a</del></em>')
    expect(inline(parse('*_a_*'))).toBe('<em><em>a</em></em>')
  })
})

describe('CJK scalar tokenizer behavior', () => {
  test.each([
    ['日本語**強調。**続き', '日本語<strong>強調。</strong>続き'],
    ['中文**（强调）**文字', '中文<strong>（强调）</strong>文字'],
    ['**강조(괄호)**문장', '<strong>강조(괄호)</strong>문장'],
    ['𠮷**（字）**続き', '𠮷<strong>（字）</strong>続き'],
    ['漢\u{e0100}**（字）**続き', '漢\u{e0100}<strong>（字）</strong>続き'],
    ['a**b**🧑', 'a<strong>b</strong>🧑'],
    ['🧑**b**a', '🧑<strong>b</strong>a'],
    ['日本語~~古い。~~続き', '日本語<del>古い。</del>続き'],
  ])('preserves %j', (source, expected) => {
    expect(inline(parse(source))).toBe(expected)
  })
})

describe('token ownership and source fidelity', () => {
  test.each([
    ['A \\****sd** me**ssage.', 'A *<em><strong>sd</strong> me</em>*ssage.'],
    ['*a\\**', '<em>a*</em>'],
    ['日本語\\*\\*強調。\\*\\*続き', '日本語**強調。**続き'],
    ['`A ****sd** me**ssage.`', '<code>A ****sd** me**ssage.</code>'],
    ['**$$x*y$$**', '<strong><math>x*y</math></strong>'],
  ])('preserves escaping and occlusion for %j', (source, expected) => {
    expect(inline(parse(source))).toBe(expected)
  })

  test('accurate UTF16 source anchors survive CRLF, scalar pairs and malformed units', () => {
    const source = '> 😀\ud800 A ****sd**\r\n> me**ssage.'
    const tree = parse(source)
    const allocations: Nodes[] = []
    collect(tree, allocations)
    expect(allocations).toHaveLength(1)
    expect(allocations[0]?.position).toEqual({
      start: { line: 1, column: 11, offset: 10 },
      end: { line: 1, column: 17, offset: 16 },
    })
    const text = allocations[0]?.position
    expect(text && source.slice(text.start.offset, text.end.offset)).toBe('**sd**')
    expect(inline(tree)).toBe('😀\ud800 A **<strong>sd</strong>\r\nme**ssage.')
  })
})

function collect(node: Nodes, allocations: Nodes[]): void {
  if (node.type === 'strong' || node.type === 'emphasis') allocations.push(node)
  if ('children' in node) node.children.forEach((child) => collect(child, allocations))
}

describe('saved independent current-CommonMark paragraph expectations', () => {
  test.each(independentAttentionCases)('$id explicit scalar/LF control', (control) => {
    expect(coreParagraph(parse(control.scalarLfSource), control.paragraph)).toEqual(
      control.expected,
    )
  })

  test.each(independentAttentionCases)(
    '$id original units retain their source identity',
    (control) => {
      expect(
        createHash('sha256').update(Buffer.from(control.source, 'utf16le')).digest('hex'),
      ).toBe(control.sourceUtf16LeSha256)
      const tree = parse(control.source)
      expect(tree.position?.end.offset).toBe(control.source.length)
    },
  )
})

function coreChildren(nodes: readonly HastNodes[]): AttentionCore[] {
  const result: AttentionCore[] = []
  for (const node of nodes) {
    const projected = coreNode(node)
    for (const child of projected) appendCore(result, child)
  }
  return result
}

function appendCore(result: AttentionCore[], child: AttentionCore): void {
  const previous = result.at(-1)
  if (previous?.type === 'text' && child.type === 'text') {
    previous.value += child.value
    return
  }
  result.push(child)
}

function coreNode(node: HastNodes): AttentionCore[] {
  if (node.type === 'text') return [{ type: 'text', value: node.value }]
  if (node.type !== 'element') return expect.unreachable(`Unexpected core node ${node.type}`)
  if (node.tagName === 'a') return coreChildren(node.children)
  if (node.tagName === 'em') return [{ type: 'emphasis', children: coreChildren(node.children) }]
  if (node.tagName === 'strong') return [{ type: 'strong', children: coreChildren(node.children) }]
  if (node.tagName !== 'code') return expect.unreachable(`Unexpected core element ${node.tagName}`)
  const value = node.children
    .map((child) => {
      if (child.type === 'text') return child.value
      return expect.unreachable('Expected code text')
    })
    .join('')
  return [{ type: 'inlineCode', value }]
}

function coreParagraph(tree: Root, index: number): AttentionCore[] {
  const hast = toHast(tree)
  if (hast.type !== 'root') return expect.unreachable('Expected the rendered root')
  const paragraphs = hast.children.filter((node) => node.type === 'element' && node.tagName === 'p')
  const node = paragraphs[index]
  if (!node || node.type !== 'element') return expect.unreachable('Expected the saved paragraph')
  return coreChildren(node.children)
}

describe('processor-local attention ownership', () => {
  test('retains installed constructs and independent processors unchanged', () => {
    const original = unified().use(remarkParse).use(remarkCjkFriendly).freeze()
    const originalAttention = original.data().micromarkExtensions?.[0]?.text?.[42]
    if (!originalAttention || Array.isArray(originalAttention))
      return expect.unreachable('Expected the installed attention construct')
    const tokenize = originalAttention.tokenize
    const resolveAll = originalAttention.resolveAll
    const source = 'A ****sd** me**ssage.'
    const before = original.parse(source)
    const processor = createRemarkProcessor()
    for (let index = 0; index < 3; index++) {
      expect(inline(processor.parse(source))).toBe('A **<strong>sd</strong> me**ssage.')
      expect(inline(processor.parse('日本語**強調。**続き'))).toBe(
        '日本語<strong>強調。</strong>続き',
      )
    }
    expect(originalAttention.tokenize).toBe(tokenize)
    expect(originalAttention.resolveAll).toBe(resolveAll)
    expect(original.parse(source)).toEqual(before)
  })

  test('original runs remain owned inside link labels and nested emphasis', () => {
    expect(inline(parse('[A ****sd** me**ssage.](https://example.test)'))).toBe(
      'A **<strong>sd</strong> me**ssage.',
    )
    expect(inline(parse('a***b***c'))).toBe('a<em><strong>b</strong></em>c')
  })

  test('the rendered-core observation handles ordinary multiline code', () => {
    expect(coreParagraph(parse('`a\nb`'), 0)).toEqual([{ type: 'inlineCode', value: 'a b' }])
  })
})
