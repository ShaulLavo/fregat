import type { Nodes } from 'hast'
import { beforeAll, describe, expect, test } from 'vitest'

import { referenceOutput } from '../../../test/reference/oracle'
import { blockToHast, createHastProcessor } from '../hast'
import { createMarkdownSession, type MarkdownSessionFactory } from '../session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../tree-sitter-session'

const processor = createHastProcessor({ raw: null, math: null })
const factories = [
  ['remark', createMarkdownSession],
  ['tree-sitter', createTreeSitterMarkdownSession],
] satisfies readonly [string, MarkdownSessionFactory][]

const DEFINITION_SCHEDULES = [
  {
    name: 'late blockquote definition',
    prefix: '[guide][docs].\n\nLater paragraph.\n\n',
    suffix: '> [docs]: /guide\n',
  },
  {
    name: 'early blockquote definition',
    prefix: '> [docs]: /guide\n\nMiddle paragraph.\n\n',
    suffix: '[guide][docs].\n',
  },
  {
    name: 'late list definition',
    prefix: '[guide][docs].\n\nLater paragraph.\n\n',
    suffix: '- [docs]: /guide\n',
  },
  {
    name: 'early list definition',
    prefix: '- [docs]: /guide\n\nMiddle paragraph.\n\n',
    suffix: '[guide][docs].\n',
  },
] as const

beforeAll(() => initializeTreeSitterMarkdown())

describe('link definitions and incremental sessions', () => {
  test.each(factories)('%s matches a fresh session and the whole-document oracle', (_, factory) => {
    for (const { name, prefix, suffix } of DEFINITION_SCHEDULES) {
      const source = prefix + suffix
      const session = factory()
      session.update(prefix, { heal: true })

      expect(renderLinks(session, source, false), name).toEqual(['/guide'])
      expect(renderLinks(factory(), source, false), `${name} fresh`).toEqual(['/guide'])
      expect(JSON.stringify(referenceOutput(source, 'gfm')), `${name} oracle`).toContain(
        '"href":"/guide"',
      )
    }
  })

  test.each(factories)(
    '%s rebuilds after definition removal and source replacement',
    (_, factory) => {
      const session = factory()
      const prefix = '[guide][docs].\n\nLater paragraph.\n\n'
      const resolved = prefix + '> [docs]: /guide\n'

      session.update(prefix, { heal: true })
      expect(renderLinks(session, resolved, false)).toEqual(['/guide'])
      expect(renderLinks(session, prefix, false)).toEqual(renderLinks(factory(), prefix, false))
      expect(renderLinks(session, '# Replacement', false)).toEqual(
        renderLinks(factory(), '# Replacement', false),
      )
    },
  )

  test.each(factories)('%s keeps settled identity without a reference dependency', (_, factory) => {
    const session = factory()
    const first = session.update('First paragraph.\n\nLive tail', { heal: true })
    const second = session.update('First paragraph.\n\nLive tail grows', { heal: true })

    expect(second[0]).toBe(first[0])
  })
})

function renderLinks(
  session: ReturnType<MarkdownSessionFactory>,
  source: string,
  heal: boolean,
): string[] {
  return session
    .update(source, { heal })
    .flatMap((block) => blockToHast(block, processor).children)
    .flatMap(findLinks)
}

function findLinks(node: Nodes): string[] {
  if (node.type === 'element' && node.tagName === 'a') {
    const href = node.properties.href
    return typeof href === 'string' ? [href] : []
  }
  if (!('children' in node)) return []

  return node.children.flatMap(findLinks)
}
