import type { Element, Nodes, Root } from 'hast'
import rehypeRaw from 'rehype-raw'
import { describe, expect, test } from 'vitest'

import { blockToHast, createHastProcessor } from '../hast'
import { createMarkdownSession } from '../session'

const bare = createHastProcessor({ math: null, raw: null })
const withRaw = createHastProcessor({ math: null, raw: rehypeRaw })

function render(text: string, processor = bare, heal = false): Root {
  const blocks = createMarkdownSession().update(text, { heal })

  return {
    type: 'root',
    children: blocks.flatMap((block) => blockToHast(block, processor).children),
  }
}

function elements(tree: Nodes, tagName: string): Element[] {
  const found: Element[] = []
  if (tree.type === 'element' && tree.tagName === tagName) found.push(tree)
  if ('children' in tree) {
    for (const child of tree.children) found.push(...elements(child, tagName))
  }

  return found
}

function text(tree: Nodes): string {
  if (tree.type === 'text') return tree.value
  if (!('children' in tree)) return ''

  return tree.children.map(text).join('')
}

describe('sanitization', () => {
  test('a javascript: destination is stripped', () => {
    const [link] = elements(render('[x](javascript:alert(1))'), 'a')

    expect(link?.properties.href).toBeUndefined()
  })

  test('script and event handlers never survive, with or without the HTML stage', () => {
    const source = '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\ntext'

    for (const processor of [bare, withRaw]) {
      const tree = render(source, processor)
      expect(elements(tree, 'script')).toEqual([])
      expect(elements(tree, 'img').every((img) => !('onError' in img.properties))).toBe(true)
      expect(text(tree)).not.toContain('alert')
    }
  })

  test('raw HTML is dropped until its stage loads, then kept', () => {
    const source = '<details><summary>More</summary>\n\nhidden\n\n</details>'

    expect(elements(render(source, bare), 'details')).toEqual([])
    const [details] = elements(render(source, withRaw), 'details')
    expect(details).toBeDefined()
    expect(text(details as Element)).toContain('hidden')
  })

  test('a fence inside raw HTML is not executed as HTML', () => {
    const tree = render('```html\n<script>alert(1)</script>\n```', withRaw)

    expect(elements(tree, 'script')).toEqual([])
    expect(text(tree)).toContain('<script>alert(1)</script>')
  })
})

describe('decoration', () => {
  test('block elements carry the pipeline classes', () => {
    const tree = render('# Title\n\n- item\n\n> quote')
    const [heading] = elements(tree, 'h1')
    const [list] = elements(tree, 'ul')

    expect(heading?.properties.className).toContain('text-3xl')
    expect(list?.properties.className).toContain('list-disc')
  })

  test('a table is wrapped in a scrolling container', () => {
    const tree = render('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    const wrapper = tree.children[0] as Element

    expect(wrapper.tagName).toBe('div')
    expect(wrapper.properties.className).toContain('overflow-x-auto')
    expect((wrapper.children[0] as Element).tagName).toBe('table')
  })

  test('a fence keeps its language, metastring and streaming state', () => {
    const tree = render('```ts title="src/foo.ts"\nconst open =', bare, true)
    const [code] = elements(tree, 'code')

    expect(code?.properties.className).toEqual(['language-ts'])
    expect(code?.properties.dataMeta).toBe('title="src/foo.ts"')
    expect(code?.properties.dataIncomplete).toBe('true')
  })

  test('an unfinished link has no destination to follow', () => {
    const [link] = elements(render('see [docs](https://exa', bare, true), 'a')

    expect(link?.properties.href).toBeUndefined()
    expect(link?.properties.dataIncomplete).toBe('true')
  })

  test('the fence metastring survives the raw HTML stage', () => {
    const [code] = elements(render('```ts title="a.ts"\nx\n```', withRaw), 'code')

    expect(code?.properties.dataMeta).toBe('title="a.ts"')
  })

  test('raw HTML cannot forge the streaming marker on a fence', () => {
    const [code] = elements(
      render('<pre><code data-incomplete="true">a</code></pre>', withRaw),
      'code',
    )

    expect(code?.properties.dataIncomplete).toBeUndefined()
  })

  test('footnote ids are prefixed once, so the jump link resolves', () => {
    const tree = render('a[^x]\n\n[^x]: note')
    const [ref] = elements(tree, 'a')
    const target = String(ref?.properties.href).slice(1)

    expect(elements(tree, 'li').some((item) => item.properties.id === target)).toBe(true)
  })

  test('block code is not given the inline code class', () => {
    const tree = render('`inline` and\n\n```\nblock\n```')
    const [inline, block] = elements(tree, 'code')

    expect(inline?.properties.className).toContain('font-mono')
    expect(block?.properties.className).toBeUndefined()
  })
})
