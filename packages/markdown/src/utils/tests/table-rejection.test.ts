import { createHash } from 'node:crypto'

import type { Nodes, Root } from 'mdast'
import { toHast } from 'mdast-util-to-hast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified, type Data, type Processor } from 'unified'
import { describe, expect, test } from 'vitest'

import { createRemarkProcessor } from '../processor'
import { createMarkdownSession } from '../session'
import { remarkTableRejection } from '../table-rejection'

function processor() {
  return createRemarkProcessor()
}

function parse(source: string): Root {
  const parser = processor()
  return parser.runSync(parser.parse(source))
}

function topTags(tree: Root) {
  const html = toHast(tree)
  if (!('children' in html)) return []
  return html.children.flatMap((node) => (node.type === 'element' ? [node.tagName] : []))
}

function kinds(node: Nodes): Nodes['type'][] {
  if (!('children' in node)) return []
  return node.children.flatMap((child) => {
    const own: Nodes['type'][] = [child.type]
    return own.concat(kinds(child))
  })
}

// Saved cmark-GFM 587a12bb54d95ac37241377e6ddc93ea0e45439b executions.
// Retry suppression is pinned implementation compatibility, not explicit in GFM prose.
describe('paragraph-scoped table rejection', () => {
  test.each([
    ['a|b\n|---\n|---|', ['paragraph']],
    ['|---\n|---|', ['table']],
    ['b\n|---|', ['table']],
    ['a|b\n|---\nb\n|---|', ['paragraph']],
    ['a|b\nx\nb\n|---|', ['paragraph', 'table']],
    ['a|b\n|---\n\nb\n|---|', ['paragraph', 'table']],
    ['a\nb\n|---|', ['paragraph', 'table']],
    ['b|c\n|---|', ['paragraph']],
  ])('retains independent block kinds for %j', (source, expected) => {
    expect(parse(source).children.map((node) => node.type)).toEqual(expected)
  })

  test('rejection retains the whole original paragraph and its positions', () => {
    const source = 'a|b\n|---\nb\n|---|'
    expect(parse(source).children).toEqual([
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value: source,
            position: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 4, column: 6, offset: 16 },
            },
          },
        ],
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 4, column: 6, offset: 16 },
        },
      },
    ])
  })
})

const original =
  '\ud83e\uddd1\u200d\ud83d\udcbb`>a | b |\n|---\r\n|---|\n **see\n\n\r\n> _de| a** | b |\n|[x]: /target\n---|---|\nd'

function session() {
  return createMarkdownSession()
}

function updateNodes(current: ReturnType<typeof session>, source: string, heal: boolean) {
  return current.update(source, { heal }).flatMap((block) => block.nodes)
}

function sessionNodes(source: string, heal: boolean) {
  return updateNodes(session(), source, heal)
}

function tableKinds(node: Nodes) {
  return kinds(node).filter((kind) => kind === 'table')
}

describe('original seed219 sources and modes', () => {
  test.each([
    { id: '219/completed/29', pointer: '/cases/86/observations/29', heal: false },
    { id: '219/live/29', pointer: '/cases/87/observations/29', heal: true },
  ])('$id preserves original UTF16 identity and rejects the table', ({ heal }) => {
    expect(original.length).toBe(78)
    expect(createHash('sha256').update(Buffer.from(original, 'utf16le')).digest('hex')).toBe(
      '59e41db054adb43b7379617b8a2a312f49812f3d2e133ff30fc0ee9c940657b7',
    )
    expect(createHash('sha256').update(JSON.stringify(original)).digest('hex')).toBe(
      'ebc0de05df6a0c792a2ed03050d8ecc7325c66c60204e9179068794c7cd4924b',
    )
    const tree = parse(original)
    const tags = topTags(tree)
    expect(tags).toEqual(['p', 'blockquote'])
    const nodes = sessionNodes(original, heal)
    expect(nodes.map((node) => node.type)).toEqual(['paragraph', 'blockquote'])
    expect(kinds({ type: 'root', children: nodes })).not.toContain('table')
    expect(nodes[0]?.position?.end).toEqual({
      line: 4,
      column: 7,
      offset: original.indexOf('\n\n'),
    })
  })
})

describe('container and tokenizer boundaries', () => {
  test.each([
    ['> a|b\n|---\n> c|d\n> -|-\n', 1],
    ['> a|b\n> |---\n> b\n> |---|', 0],
    ['> a|b\n> |---\n>\n> b\n> |---|', 1],
    ['> a|b\n> |---\n\nb\n|---|', 1],
    ['- a|b\n  |---\n  b\n  |---|\n\n- b\n  |---|', 1],
    ['> - a|b\n>   |---\n>   b\n>   |---|\n>\n>   b\n>   |---|', 1],
    ['a|b\n|:\nb\n|---|', 1],
    ['a|b\n|-||\nb\n|---|', 1],
    ['a\\|b\n|---\n|---|', 1],
    ['a|b\r\n|---\r\nb\r\n|---|', 0],
    ['a|b\n|---\n    indented\n    continuation\nb\n|---|', 0],
    ['\ud800|b\n|---\nb\n|---|', 0],
  ])('counts tables across %j', (source, count) => {
    expect(kinds(parse(source)).filter((kind) => kind === 'table')).toHaveLength(count)
  })

  test('one processor keeps rejection local to each parse', () => {
    const parser = processor()
    expect(parser.parse('a|b\n|---\nb\n|---|').children.map((node) => node.type)).toEqual([
      'paragraph',
    ])
    expect(parser.parse('b\n|---|').children.map((node) => node.type)).toEqual(['table'])
  })

  test.each([false, true])('real session edit and undo with heal=%s', (heal) => {
    const current = session()
    const sources = [
      'a|b\n|---\nb\n|---|',
      'a|b\nx\nb\n|---|',
      'a|b\n|---\nb\n|---|',
      'b\n|---|',
      original,
    ]
    for (const source of sources) {
      const actual = updateNodes(current, source, heal)
      expect(actual).toEqual(sessionNodes(source, heal))
    }
  })

  test.each([false, true])('exact seed219 insertion and undo with heal=%s', (heal) => {
    const current = session()
    const before = original.slice(0, 19) + original.slice(21)
    expect(before.slice(0, 19) + '\r\n' + before.slice(19)).toBe(original)
    for (const source of [before, original, before, original]) {
      const actual = updateNodes(current, source, heal)
      expect(actual).toEqual(sessionNodes(source, heal))
    }
    expect(current.update(original, { heal }).map((block) => block.nodes[0]?.type)).not.toContain(
      'table',
    )
  })

  test.each([false, true])('lazy prefix edit and undo with heal=%s', (heal) => {
    const current = session()
    const lazy = '> a|b\n|---\n> c|d\n> -|-\n'
    const prefixed = '> a|b\n> |---\n> c|d\n> -|-\n'
    const steps = [
      { source: lazy, count: 1 },
      { source: prefixed, count: 0 },
      { source: lazy, count: 1 },
    ]
    for (const { source, count } of steps) {
      const actual = updateNodes(current, source, heal)
      expect(actual).toEqual(sessionNodes(source, heal))
      const tables = tableKinds({ type: 'root', children: actual })
      expect(tables).toHaveLength(count)
    }
  })
})

type Extension = NonNullable<Data['micromarkExtensions']>[number]
type Construct = Exclude<NonNullable<NonNullable<Extension['flow']>[string]>, unknown[]>
type Context = ThisParameterType<Construct['tokenize']>
type Events = Context['events']
type LookupCounts = { active: boolean; reads: number; maxReads: number; attempts: number }

function countedEvents(events: Events, counts: LookupCounts): Events {
  return new Proxy(events, {
    get(target, key, receiver) {
      if (counts.active && typeof key === 'string' && /^\d+$/u.test(key)) counts.reads++
      return Reflect.get(target, key, receiver)
    },
  })
}

function countingContext(context: Context, events: Events): Context {
  return new Proxy(context, {
    get(target, key, receiver) {
      return key === 'events' ? events : Reflect.get(target, key, receiver)
    },
  })
}

function observedConstruct(
  construct: Construct,
  counts: LookupCounts,
  views: WeakMap<Events, Events>,
): Construct {
  if (construct.name !== 'table') return construct
  const original = construct.tokenize
  return { ...construct, tokenize }

  function tokenize(this: Context, ...args: Parameters<Construct['tokenize']>) {
    const events = views.get(this.events) ?? countedEvents(this.events, counts)
    views.set(this.events, events)
    counts.attempts++
    const before = counts.reads
    counts.active = true
    try {
      return original.call(countingContext(this, events), ...args)
    } finally {
      counts.active = false
      counts.maxReads = Math.max(counts.maxReads, counts.reads - before)
    }
  }
}

function observeTableLookups(this: Processor, counts: LookupCounts) {
  const views = new WeakMap<Events, Events>()
  for (const extension of this.data('micromarkExtensions') ?? []) {
    const entry = extension.flow?.null
    if (!entry || !extension.flow) continue
    const entries = Array.isArray(entry) ? entry : [entry]
    extension.flow.null = entries.map((construct) => observedConstruct(construct, counts, views))
  }
}

function lookupDiagnostic(source: string) {
  const counts: LookupCounts = { active: false, reads: 0, maxReads: 0, attempts: 0 }
  const parser = processor().use(observeTableLookups, counts)
  const tree = parser.runSync(parser.parse(source))
  return { counts, tree }
}

describe('bounded table owner lookup', () => {
  test.each([64, 256])('table body with %i rows reads only the event tail', (rows) => {
    const source = 'a|b\n-|-\n' + 'c|d\n'.repeat(rows)
    const { counts, tree } = lookupDiagnostic(source)
    expect(tree).toEqual(parse(source))
    expect(kinds(tree).filter((kind) => kind === 'table')).toHaveLength(1)
    expect(counts.attempts).toBeGreaterThan(rows)
    expect(counts.maxReads).toBeLessThanOrEqual(5)
    expect(counts.reads).toBeLessThanOrEqual(counts.attempts * 5)
  })

  test.each([64, 256])('rejected paragraph with %i lines reads only the event tail', (rows) => {
    const source = 'a|b\n|---\n' + 'c|d\n'.repeat(rows) + '|---|'
    const { counts, tree } = lookupDiagnostic(source)
    expect(tree).toEqual(parse(source))
    expect(tree.children.map((node) => node.type)).toEqual(['paragraph'])
    expect(counts.attempts).toBeGreaterThan(rows)
    expect(counts.maxReads).toBeLessThanOrEqual(5)
    expect(counts.reads).toBeLessThanOrEqual(counts.attempts * 5)
  })
})

function remarkIdentity() {
  return (tree: Root) => tree
}

describe('custom processor ownership', () => {
  test('a supplied processor retains its own table policy', () => {
    const custom = unified().use(remarkParse).use(remarkGfm).use(remarkIdentity)
    const current = createMarkdownSession({ processor: custom })
    const nodes = current
      .update('a|b\n|---\nb\n|---|', { heal: false })
      .flatMap((block) => block.nodes)
    expect(nodes.map((node) => node.type)).toEqual(['paragraph', 'table'])
  })

  test('a custom GFM processor can opt into rejection explicitly', () => {
    const custom = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkIdentity)
      .use(remarkTableRejection)
    const current = createMarkdownSession({ processor: custom })
    const nodes = current
      .update('a|b\n|---\nb\n|---|', { heal: false })
      .flatMap((block) => block.nodes)
    expect(nodes.map((node) => node.type)).toEqual(['paragraph'])
  })
})
