import type { Nodes, Root } from 'hast'
import { afterEach, describe, expect, test } from 'vitest'

import {
  planCommentQuote,
  planSelectionLines,
} from '../../../../../apps/web/src/features/chat/utils/plan-comment'
import { blockToHast, createHastProcessor } from '../hast'
import { createMarkdownSession } from '../session'

const source =
  '|*>\r\n * a&amp;| a b &amp;|\n|----|\n---|\n |--| a | b\n.[`| a | b |\n|`---|(https://example.tes| a | b |\n|---|-|\n\n'

function dom(node: Nodes): Node {
  if (node.type !== 'element') return document.createTextNode('value' in node ? node.value : '')
  const element = document.createElement(node.tagName)
  for (const [key, value] of Object.entries(node.properties)) {
    element.setAttribute(
      key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      String(value),
    )
  }
  element.append(...node.children.map(dom))
  return element
}

function render(markdown: string, heal: boolean) {
  const processor = createHastProcessor({ math: null, raw: null })
  const tree: Root = {
    type: 'root',
    children: createMarkdownSession()
      .update(markdown, { heal })
      .flatMap((block) => blockToHast(block, processor).children),
  }
  const container = document.createElement('div')
  container.append(...tree.children.map(dom))
  document.body.append(container)
  return container
}

function select(container: HTMLElement, link: HTMLAnchorElement) {
  const range = document.createRange()
  range.selectNodeContents(link)
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return planSelectionLines(container)
}

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe('fallback link authored quotes', () => {
  test.each(['completed', 'live'])(
    '210/%s/55 selects authored line 7 after multiline inline code',
    (mode) => {
      const container = render(source, mode === 'live')
      const link = container.querySelector('a')
      expect(link).not.toBeNull()
      if (!link) return
      const lines = select(container, link)
      expect(lines).toEqual({ start: 7, end: 7 })
      if (!lines) return
      expect(planCommentQuote(source, lines)).toBe(
        'About the proposed plan, line 7:\n\n> |`---|(https://example.tes| a | b |',
      )
      expect(link.getAttribute('href')).toBe('https://example.tes%7C')
    },
  )

  test.each(['completed', 'live'])(
    'list references and CRLF fallback links select their own lines in %s mode',
    (mode) => {
      const markdown = [
        '- [ref]: https://reference.test/',
        '  [label][ref] and 😀 &amp; `first',
        '  second` [x(https&colon;//example.test/a)]',
        '  [x(https&colon;//example.test/a)]',
      ].join('\r\n')
      const container = render(markdown, mode === 'live')
      const links = Array.from(container.querySelectorAll('a'))
      expect(links).toHaveLength(3)
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        'https://reference.test/',
        'https://example.test/a',
        'https://example.test/a',
      ])
      expect(links.map((link) => select(container, link))).toEqual([
        { start: 2, end: 2 },
        { start: 3, end: 3 },
        { start: 4, end: 4 },
      ])
      expect(links.map((link) => link.getAttribute('data-source-line'))).toEqual(['2', '3', '4'])
    },
  )

  test('identical fallback links keep their separate authored occurrences', () => {
    const markdown =
      '`[x]: $x`\n$/t[x(https://example.test/a)]: /t\n$/t[x(https://example.test/a)]: /t\nar[x]\n`'
    const container = render(markdown, false)
    const links = Array.from(container.querySelectorAll('a'))
    expect(links).toHaveLength(2)
    expect(links.map((link) => select(container, link))).toEqual([
      { start: 2, end: 2 },
      { start: 3, end: 3 },
    ])
    expect(links.map((link) => link.getAttribute('data-source-line'))).toEqual(['2', '3'])
  })
})
