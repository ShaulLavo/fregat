import type { Root } from 'mdast'
import { expect, test } from 'vitest'

import { createMarkdownSession, type MarkdownParser } from '../session'

test('an injected parser supplies all syntax and receives authored full source for transforms', () => {
  const sources: string[] = []
  const processor: MarkdownParser = {
    parse(text): Root {
      return {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            position: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: text.length + 1, offset: text.length },
            },
            children: [{ type: 'text', value: text }],
          },
        ],
      }
    },
    runSync(root, source) {
      sources.push(source)
      return root
    },
  }
  const session = createMarkdownSession({ processor })
  const blocks = session.update('**authored**', { heal: false })
  expect(blocks[0]?.nodes).toMatchObject([
    { type: 'paragraph', children: [{ type: 'text', value: '**authored**' }] },
  ])
  expect(sources).toEqual(['**authored**'])
  expect(session.update('**authored**', { heal: false })).toBe(blocks)
})
