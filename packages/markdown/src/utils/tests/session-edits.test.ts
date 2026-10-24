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
const edits = [
  ['A **s*eeded**** .\n| a | b |\n|---|---|\n\n', 'A **s*eeded**** .\n| a | b |\n|---|---|אבג\n\n'],
  ['> A * .\n- | a | b |\n|--\n\n-|---|אבג\n\n', '> A * .\n-`| a | b |\n|--\n\n-|---|אבג\n\n'],
  ['\n *sage.\n\n```\n', '\n *sage.\n\n'],
  ['- a\n\nb', '- a\n\n  b'],
]
const processor = createHastProcessor({ raw: null, math: null })

beforeAll(() => initializeTreeSitterMarkdown())

describe.each(factories)('%s session edits', (_, factory) => {
  test.each(edits)('reparses the block before an edited boundary in %j', (before, after) => {
    for (const heal of [false, true]) {
      const session = factory()
      session.update(before, { heal })
      expect(session.update(after, { heal })).toEqual(factory().update(after, { heal }))
    }
  })

  test('keeps earlier settled identity when only the tail changes', () => {
    const session = factory()
    const before = session.update('First\n\nSecond\n\nTail', { heal: true })
    const after = session.update('First\n\nSecond\n\nEdit', { heal: true })
    expect(after[0]).toBe(before[0])
    expect(after).toEqual(factory().update('First\n\nSecond\n\nEdit', { heal: true }))
  })

  test.each([false, true])(
    'keeps every settled identity while truncating the tail, heal=%s',
    (heal) => {
      const source = 'First\n\nSecond\n\nTa'
      const session = factory()
      const before = session.update('First\n\nSecond\n\nTail', { heal })
      const after = session.update(source, { heal })

      expect(after[0]).toBe(before[0])
      expect(after[1]).toBe(before[1])
      expect(after).toEqual(factory().update(source, { heal }))
    },
  )

  test.each([
    'First\n\nSecond',
    'First\n\nSecond\n',
    'First\n\nSecond\n\n',
    'First\n\nSecond\n\n \n',
  ])('reclassifies the final settled block as the tail after deletion to %j', (source) => {
    for (const heal of [false, true]) {
      const session = factory()
      const before = session.update('First\n\nSecond\n\nTail', { heal })
      const after = session.update(source, { heal })

      expect(after[0]).toBe(before[0])
      expect(before[1]?.settled).toBe(true)
      expect(after).toHaveLength(2)
      expect(after[1]?.settled).toBe(false)
      expect(after[1]).not.toBe(before[1])
      expect(after).toEqual(factory().update(source, { heal }))
    }
  })

  test('keeps every settled block identity while appending', () => {
    for (const heal of [false, true]) {
      const session = factory()
      const before = session.update('First\n\nSecond\n\nTail', { heal })
      const after = session.update('First\n\nSecond\n\nTail grows', { heal })

      expect(after[0]).toBe(before[0])
      expect(after[1]).toBe(before[1])
      expect(after).toEqual(factory().update('First\n\nSecond\n\nTail grows', { heal }))
    }
  })

  test.each([
    ['a\n~~~\nb', 'a\n~'],
    ['a\n~~~\nb\n~~~\n\nTail', 'a\n~'],
    ['a\n| b | c |\n|---|---|\n\nTail', 'a\n| b | c |\n|--'],
    ['First\n\nSecond\n\nTail', 'First\n\nSecond\n\n'],
  ])('still rolls back across a changed or deleted block in %j', (before, after) => {
    for (const heal of [false, true]) {
      const session = factory()
      session.update(before, { heal })

      expect(session.update(after, { heal })).toEqual(factory().update(after, { heal }))
    }
  })
})

describe('source newline spelling', () => {
  const sources = ['a\nb', '> a\n> b', '- a\n  b', '**a\nb**', 'a \nb', 'a  \nb']
  test.each(sources)('preserves CR and CRLF soft breaks in %j', (lf) => {
    for (const newline of ['\r', '\r\n']) {
      const source = lf.replaceAll('\n', newline)
      const root = {
        type: 'root' as const,
        children: createTreeSitterMarkdownSession()
          .update(source, { heal: false })
          .flatMap((block) => blockToHast(block, processor).children),
      }
      expect(observeHast(root)).toEqual(observeHast(renderRemark(source, false)))
    }
  })
})
