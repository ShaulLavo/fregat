import type { Element, Nodes, Root } from 'hast'
import rehypeRaw from 'rehype-raw'
import { beforeAll, expect, test } from 'vitest'

import {
  blockToHast,
  createHastProcessor,
  loadRawHastExtension,
  type HastExtensions,
} from '../hast'
import { sourcePoint } from '../positions'
import { createMarkdownSession, type MarkdownSessionFactory } from '../session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../tree-sitter-session'

const engines: readonly [string, MarkdownSessionFactory][] = [
  ['remark', createMarkdownSession],
  ['native', createTreeSitterMarkdownSession],
]
let canonicalRaw: HastExtensions['raw'] = null

beforeAll(async () => {
  await initializeTreeSitterMarkdown()
  canonicalRaw = (await loadRawHastExtension()).default
})

function render(source: string, factory: MarkdownSessionFactory, raw: HastExtensions['raw']) {
  const processor = createHastProcessor({ raw, math: null })
  return factory()
    .update(source, { heal: true })
    .flatMap((block) => blockToHast(block, processor).children)
}

function elements(node: Nodes, tag: string): Element[] {
  const own = node.type === 'element' && node.tagName === tag ? [node] : []
  if (!('children' in node)) return own
  return own.concat(node.children.flatMap((child) => elements(child, tag)))
}

function checkOpener(source: string, factory: MarkdownSessionFactory) {
  const root: Root = { type: 'root', children: render(source, factory, canonicalRaw) }
  const opener = elements(root, 'kbd')
  expect(opener).toHaveLength(1)
  expect(opener[0]?.position).toEqual({
    start: sourcePoint(source, source.indexOf('<kbd>')),
    end: sourcePoint(source, source.length),
  })
  expect(opener[0]?.children).toEqual([])
}

test.each(engines)(
  '%s projects the original terminal HTML prefix with the canonical raw loader',
  (_name, factory) => {
    checkOpener('A <kbd>', factory)
  },
)

test.each(engines)(
  '%s retains a nonzero UTF16 block window for a terminal raw opener',
  (_name, factory) => {
    checkOpener('🧑‍💻\n\nA <kbd>', factory)
  },
)

const table = '| a | b |\n| - | - |\n| x | before <textarea> after |'

test.each(engines)(
  '%s retains the authored last table-cell end through the canonical raw loader',
  (_name, factory) => {
    const root: Root = { type: 'root', children: render(table, factory, canonicalRaw) }
    const cells = elements(root, 'td')
    expect(cells).toHaveLength(2)
    expect(cells[1]?.position).toEqual({
      start: { line: 3, column: 5, offset: 24 },
      end: { line: 3, column: 32, offset: 51 },
    })
  },
)

test.each(engines)('%s renders valid raw ranges through bare rehype-raw', (_name, factory) => {
  const source = 'A <kbd>Ctrl</kbd> key.'
  const root: Root = { type: 'root', children: render(source, factory, rehypeRaw) }
  const opener = elements(root, 'kbd')
  expect(opener).toHaveLength(1)
  expect(opener[0]?.position).toEqual({
    start: sourcePoint(source, 2),
    end: sourcePoint(source, 17),
  })
  expect(opener[0]?.children).toMatchObject([{ type: 'text', value: 'Ctrl' }])
})

test.each(engines)('%s keeps malformed bare raw output strict', (_name, factory) => {
  for (const source of ['A <kbd>', table])
    expect(() => render(source, factory, rehypeRaw)).toThrow('Invalid Markdown position')
})
