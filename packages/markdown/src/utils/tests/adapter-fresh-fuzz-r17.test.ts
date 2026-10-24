import type { Root } from 'hast'
import rehypeRaw from 'rehype-raw'
import { beforeAll, describe, expect, test } from 'vitest'

import { observeHast, renderRemark } from '../../../test/qualification'
import { blockToHast, createHastProcessor } from '../hast'
import { createMarkdownSession, type MarkdownSessionFactory } from '../session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../tree-sitter-session'

const factories = [
  ['remark', createMarkdownSession],
  ['tree-sitter', createTreeSitterMarkdownSession],
] satisfies readonly [string, MarkdownSessionFactory][]
const cases = [
  {
    name: 'row 12',
    source: '[x]:* [x]: /target\n| a | *b |\n|---|---|\n/```\n&\ud83e',
  },
  {
    name: 'row 28',
    source: 'A *`\r\n> \u05d0\u05d1\u05d2*e_\r\ndee.\n- \n| a | b |\n|---|---|\n',
  },
  {
    name: 'row 36',
    source: 'A **seede$** m-\u05d0\u05d1\u05d2 \n| a | b |```\n\n|--_-|---|\n-|---|\nss',
  },
  {
    name: 'short padded table row',
    source: '| a | *b |\n|---|---|\nx',
  },
  {
    name: 'padded underscore row',
    source: '|--_-|---|\n-|---|\nss',
  },
  {
    name: 'three-column padded table row',
    source: '| a | b | *c |\n|---|---|---|\nx',
  },
]
const processor = createHastProcessor({ raw: rehypeRaw, math: null })

beforeAll(() => initializeTreeSitterMarkdown())

describe.each(factories)('%s synthetic-cell tail repair', (_, factory) => {
  test.each(cases)('$name keeps authored text in short table rows', ({ source }) => {
    for (const heal of [false, true]) {
      const blocks = factory().update(source, { heal })
      expect(blocks.map((block) => block.source).join(''), `heal=${heal}`).toBe(source)
      const root: Root = {
        type: 'root',
        children: blocks.flatMap((block) => blockToHast(block, processor).children),
      }
      expect(observeHast(root)).toEqual(observeHast(renderRemark(source, heal)))
    }
  })

  test('keeps the empty padded cells and heals an authored final-cell opener', () => {
    const source = '| a | b |\n|---|---|\n| x | *y'
    const blocks = factory().update(source, { heal: true })
    const root: Root = {
      type: 'root',
      children: blocks.flatMap((block) => blockToHast(block, processor).children),
    }
    expect(observeHast(root).elements.filter((element) => element.tag === 'em')).toHaveLength(1)
    expect(observeHast(root).elements.filter((element) => element.tag === 'td')).toHaveLength(2)
    expect(observeHast(root)).toEqual(observeHast(renderRemark(source, true)))
  })
})
