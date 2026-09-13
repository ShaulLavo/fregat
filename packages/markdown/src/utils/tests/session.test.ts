import type { RootContent } from 'mdast'
import { describe, expect, test } from 'vitest'

import type { MarkdownBlock } from '../blocks'
import { createMarkdownSession } from '../session'

const PREFIX = '# Before\n\n```ts\nconst values = [1, 2];\n```\n\n'

/** Documents whose every prefix must parse the same incrementally as from scratch. */
const CORPUS = [
  'a\n===\n\nb\n---\n',
  '- first\n\n  continued\n\n- next\n',
  '> quoted\n>\n> ```js\n> abc\n> ```\n\nend',
  '<div>\nhello\n\n</div>\n\nend',
  '<details>\n<summary>More</summary>\n\nHidden **bold** text\n\n</details>\n\nafter',
  '[ref]\n\n[ref]: /later',
  'a[^x]\n\n[^x]: note',
  'a | b\n--|--\na | b\n',
  '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n~~gone~~\n',
  '```\na\n```\n\nnext\n\n~~~\nb\n~~~\n\nmore',
  '\n\n\tcode\n\nmore',
  'text <https://example.com> *bold*',
  '- [ ] task\n- [x] done\n\n1. one\n2. two\n',
  '-       aligned bullet\n\n        ```ts\n        const nested = 1;\n        ```\n\n        tail',
  'Inline $$x$$ and a block:\n\n$$\n\\int_0^1 f(x) dx\n$$\n\nmore *math $$y$$ here*',
  '日本語の**強調**とhttps://example.com。リンク\n\n段落',
  'para one\r\n\r\npara two\r\n',
  'line\n\n```ts\nconst open = true\n',
  'See [the docs](https://example.com/guide) and ![img](x.png).\n\n---\n\n## Heading\n\ntext',
]

function fullParse(text: string) {
  return nodesOf(createMarkdownSession().update(text, { heal: false }))
}

function nodesOf(blocks: readonly MarkdownBlock[]): readonly RootContent[] {
  return blocks.flatMap((block) => block.nodes)
}

describe('incremental parsing', () => {
  test.each(CORPUS)('every prefix of %j matches a parse from scratch', (tail) => {
    const source = PREFIX + tail
    const session = createMarkdownSession()

    for (let length = 1; length <= source.length; length += 1) {
      const text = source.slice(0, length)
      expect(nodesOf(session.update(text, { heal: false }))).toEqual(fullParse(text))
    }
  })

  test('settled blocks keep their identity while the stream appends', () => {
    const session = createMarkdownSession()
    const first = session.update(PREFIX + 'one', { heal: false })
    const second = session.update(PREFIX + 'one two', { heal: false })

    expect(first.length).toBe(3)
    expect(first[0]?.settled).toBe(true)
    expect(first[1]?.settled).toBe(true)
    expect(first[2]?.settled).toBe(false)
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).not.toBe(first[2])
    expect(second[2]?.key).toBe(first[2]?.key)
  })

  test('a settled block is dropped once the text no longer starts with it', () => {
    const session = createMarkdownSession()
    session.update('# A\n\ntext', { heal: false })
    const blocks = session.update('# B\n\ntext', { heal: false })

    expect(nodesOf(blocks)).toEqual(fullParse('# B\n\ntext'))
  })

  test('the same text and mode returns the same blocks', () => {
    const session = createMarkdownSession()
    const first = session.update('hello **world**', { heal: false })

    expect(session.update('hello **world**', { heal: false })).toBe(first)
  })

  test('a definition anywhere keeps the whole document in one unsettled block', () => {
    const session = createMarkdownSession()
    const blocks = session.update('[ref]\n\nmore\n\n[ref]: /later\n\ntail', { heal: false })

    expect(blocks.length).toBe(1)
    expect(blocks[0]?.settled).toBe(false)
  })

  test('raw HTML left open keeps the following blocks in the same group', () => {
    const session = createMarkdownSession()
    const blocks = session.update('<details>\n\npara\n\n</details>\n\nafter\n\nlast', {
      heal: false,
    })

    expect(blocks.map((block) => block.nodes.length)).toEqual([3, 1, 1])
  })
})

describe('the streaming tail', () => {
  test('an open fence is flagged on its code node and on the block', () => {
    const session = createMarkdownSession()
    const [block] = session.update('```ts\nconst answer = 42\nconst other =', { heal: true })

    expect(block?.openFence).toBe(true)
    expect(block?.nodes[0]).toMatchObject({
      data: { hProperties: { dataIncomplete: 'true' } },
      type: 'code',
    })
  })

  test('a closed fence is not flagged', () => {
    const session = createMarkdownSession()
    const [block] = session.update('```ts\nconst answer = 42\n```\n', { heal: true })

    expect(block?.openFence).toBe(false)
    expect(block?.nodes[0]?.data).toBeUndefined()
  })

  test('a link without a destination yet is marked, not dropped', () => {
    const session = createMarkdownSession()
    const [block] = session.update('Read the [docs](https://exa', { heal: true })

    expect(block?.nodes[0]).toMatchObject({
      children: [
        { type: 'text', value: 'Read the ' },
        { data: { hProperties: { dataIncomplete: 'true' } }, type: 'link', url: '' },
      ],
      type: 'paragraph',
    })
  })

  test('unfinished emphasis renders as emphasis', () => {
    const session = createMarkdownSession()
    const [block] = session.update('Read **the docs', { heal: true })

    expect(block?.nodes[0]).toMatchObject({
      children: [{ type: 'text', value: 'Read ' }, { type: 'strong' }],
      type: 'paragraph',
    })
  })

  test('text that stops inside a fence is not healed', () => {
    const session = createMarkdownSession()
    const blocks = session.update('a **b\n\n```js\ncode', { heal: true })

    expect(blocks.at(-1)?.nodes[0]).toMatchObject({ type: 'code', value: 'code' })
  })

  test('healing never rewrites a settled block', () => {
    const session = createMarkdownSession()
    const streamed = session.update('range 20~25 here\n\nand **bo', { heal: true })
    const settled = session.update('range 20~25 here\n\nand **bold**', { heal: false })

    expect(nodesOf(settled)).toEqual(fullParse('range 20~25 here\n\nand **bold**'))
    expect(streamed.every((block) => !block.settled)).toBe(true)
  })

  test('turning healing off re-parses only the tail', () => {
    const session = createMarkdownSession()
    const source = PREFIX + 'final **words**'
    const streamed = session.update(source, { heal: true })
    const settled = session.update(source, { heal: false })

    expect(settled[0]).toBe(streamed[0])
    expect(settled[1]).toBe(streamed[1])
    expect(nodesOf(settled)).toEqual(fullParse(source))
  })
})
