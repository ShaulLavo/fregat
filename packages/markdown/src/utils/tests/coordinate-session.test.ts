import type { Nodes, Root } from 'mdast'
import { unified, type Plugin } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkCjkStrikethrough from 'remark-cjk-friendly-gfm-strikethrough'
import { remarkCjkAutolinkBoundaries } from '../cjk-autolinks'
import { remarkCodeMeta } from '../code-meta'
import { remarkPositionedAutolinks } from '../positioned-autolinks'
import { beforeAll, expect, test } from 'vitest'

import { blockRenderInput, type MarkdownBlock } from '../blocks'
import { blockToHast, createHastProcessor } from '../hast'
import { sourcePoint } from '../positions'
import {
  createMarkdownSession,
  type MarkdownSessionFactory,
  type MarkdownSessionOptions,
} from '../session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
  parseTreeSitterMarkdown,
} from '../tree-sitter-session'

const engines: readonly [string, MarkdownSessionFactory][] = [
  ['remark', createReferenceRemarkSession],
  ['native', createTreeSitterMarkdownSession],
]
const exactRows = [
  {
    id: '193/live/25',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```\n-|---```\n|\ne.&am;test/a)ag(https://example.test/a)e.\n\n\n\n',
  },
  {
    id: '193/live/26',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;test/a)ag(https://example.test/a)e.\n\n\n\n',
  },
  {
    id: '193/live/28',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;test/a)ag(https://example.test/a)e.\n\n\n\n',
  },
  {
    id: '193/live/29',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;test/a)ag//example.test/a)e.\n\n\n\n',
  },
  {
    id: '193/live/30',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te&amp;st/a)ag//example.test/a)e.\n\n\n\n',
  },
  {
    id: '193/live/31',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te```\n&amp;st/a)ag//example.test/a)e.\n\n\n\n',
  },
  {
    id: '193/live/32',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxa\r\nm&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te```\n&amp;st/a)ag//example.test/a)e.\n\n\n\n',
  },
  {
    id: '193/live/33',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te```\n&amp;st/a)ag//example.test/a)e.\n\n\n\n',
  },
  {
    id: '194/live/47',
    source:
      'A **\n\nsee]et\n--\ud83e*\uddd1**[x]: /target\n(https[x]://e\r$x$\u05d0\n\u05d0\u05d1\u05d2\n\u05d1a) [x]: /targ**et\nmes`',
  },
  {
    id: '194/live/48',
    source:
      'A **\n\nsee]et\n--\ud83e*\uddd1**[x]: /target\n(&amp;https[x]://e\r$x$\u05d0\n\u05d0\u05d1\u05d2\n\u05d1a) [x]: /targ**et\nmes`',
  },
  {
    id: '194/live/57',
    source:
      'A \nsee]et\n[x]--\ud83e*\uddd1**[x]| a | b |\n|---|---|\n: /ta```\nrget\n(&amp;https[x]://e\r$x$\u05d0\n\u05d0\u05d1\u05d2\n\u05d1a) [xs`',
  },
  {
    id: '210/live/20',
    source: '|** a | b |\n|--**-|-&a;-|\nA *.[\n',
  },
  {
    id: '210/live/22',
    source: '|** a | b |\n|--**-|-&a;-|\nA *.[\n',
  },
  {
    id: '226/live/35',
    source:
      'A ```\n[b |\n|---|--**-|\n\u05d2- **seed*ed*** ma_> ** [x]]: /target\n| _b\u05d0\u05d1\u05d2[*xsage.\n*&amp;*\n',
  },
  {
    id: '227/live/43',
    source:
      '(https:/\ud83e\uddd1\u200d\ud83d\udcbb&amp;/e> xample`.t(https\n\n://**examp$x$le.tetps://example.test/a*)e**\ud83e$x$[x]age',
  },
  {
    id: '227/live/61',
    source:
      '(https:/\ud83e\uddd1\u200d\ud83d\udcbb&amp;/e> xample`.t(ht***tps\n\n://**examp$xs\n\n://example.test/a*```\n)e*\ud83e$x$[x]a',
  },
]

beforeAll(() => initializeTreeSitterMarkdown())

function prepared(blocks: readonly MarkdownBlock[]): string {
  return blocks.map(preparedSource).join('')
}

function preparedSource(block: MarkdownBlock): string {
  const input = blockRenderInput(block)
  expect(input.kind).toBe('prepared')
  return input.kind === 'prepared' ? input.input.text : ''
}

function acceptedSource(id: string, source: string, engine: string): string {
  if (id.startsWith('193/')) {
    if (engine === 'remark') return source
    return source.slice(0, -4) + '**' + source.slice(-4)
  }
  if (id.startsWith('194/')) return source.slice(0, -1) + '***'
  if (id.startsWith('210/'))
    return source + '](streamdown:incomplete-link)' + (engine === 'native' ? '**' : '')
  if (id.startsWith('226/')) return engine === 'remark' ? source : source.slice(0, -1) + '**\n'
  if (id === '227/live/61') return source + '*'
  return source + (engine === 'remark' ? '*' : '')
}

function checkExactRow(
  engine: string,
  factory: MarkdownSessionFactory,
  row: (typeof exactRows)[number],
): void {
  const blocks = factory().update(row.source, { heal: true })
  expect(blocks.map((block) => block.source).join(''), row.id).toBe(row.source)
  expect(blocks.at(-1)?.end, row.id).toBe(row.source.length)
  expect(blocks.at(-1)?.endLine, row.id).toBe(0)
  expect(prepared(blocks), row.id).toBe(acceptedSource(row.id, row.source, engine))
  for (const block of blocks) checkBlockDomain(block, row.source)
}

function checkBlockDomain(block: MarkdownBlock, source: string): void {
  const nodes = flatten(block.nodes)
  for (const node of nodes) {
    if (!node.position) continue
    expect(node.position.start.offset).toBeGreaterThanOrEqual(block.start)
    expect(node.position.end.offset).toBeLessThanOrEqual(block.end)
    expect(node.position.start).toEqual(sourcePoint(source, node.position.start.offset!))
    expect(node.position.end).toEqual(sourcePoint(source, node.position.end.offset!))
  }
}

function flatten(nodes: readonly Nodes[]): Nodes[] {
  return nodes.flatMap(flattenNode)
}

function flattenNode(node: Nodes): Nodes[] {
  const own: Nodes[] = [node]
  return 'children' in node ? own.concat(flatten(node.children)) : own
}

function checkEngineRows([engine, factory]: readonly [string, MarkdownSessionFactory]): void {
  for (const row of exactRows) checkExactRow(engine, factory, row)
}

test.each(engines)(
  '%s keeps all sixteen exact authored inputs and branch choices',
  (engine, factory) => {
    checkEngineRows([engine, factory])
  },
)

test('the native non-EOF strong range excludes inserted closers and keeps four authored LFs', () => {
  const row = exactRows[0]!
  const blocks = createTreeSitterMarkdownSession().update(row.source, { heal: true })
  const input = blockRenderInput(blocks[0]!)
  if (input.kind !== 'prepared') throw new TypeError('Expected prepared input')
  const strong = flatten(input.nodes).find(
    (node) => node.type === 'strong' && node.position?.start.offset === 36,
  )
  expect(strong?.position?.end.offset).toBe(113)
  const authored = flatten(blocks[0]!.nodes).find(
    (node) => node.type === 'strong' && node.position?.start.offset === 36,
  )
  expect(authored?.position?.end.offset).toBe(111)
  expect(input.input.runs).toEqual([
    { kind: 'copy', source: { start: 0, length: 111 } },
    { kind: 'insert', text: '**', owner: 'nestedStrongRepair', gap: { left: 111, right: 111 } },
    { kind: 'copy', source: { start: 111, length: 4 } },
  ])
})

test('held EOF and inserted triple markers stay separate from the original suffix', () => {
  const row = exactRows.find((entry) => entry.id === '194/live/47')!
  const [block] = createMarkdownSession().update(row.source, { heal: true })
  const input = blockRenderInput(block!)
  if (input.kind !== 'prepared') throw new TypeError('Expected prepared input')
  expect(input.input.text.length).toBe(81)
  expect(input.input.runs).toEqual([
    { kind: 'copy', source: { start: 0, length: 78 } },
    { kind: 'insert', text: '***', owner: 'remend', gap: { left: 78, right: 78 } },
  ])
  expect(input.input.project(81, 0)).toMatchObject({ kind: 'boundary', at: 78 })
  expect(block?.source.charCodeAt(14)).toBe(row.source.charCodeAt(14))
})

test('native sentinel emphasis and remark rejection retain their own candidates', () => {
  const row = exactRows.find((entry) => entry.id === '210/live/20')!
  const [native] = createTreeSitterMarkdownSession().update(row.source, { heal: true })
  const [remark] = createReferenceRemarkSession().update(row.source, { heal: true })
  const input = blockRenderInput(native!)
  const rejected = blockRenderInput(remark!)
  if (input.kind !== 'prepared' || rejected.kind !== 'prepared')
    throw new TypeError('Expected prepared input')
  expect(input.input.text.length).toBe(63)
  expect(rejected.input.text.length).toBe(61)
  expect(rejected.input.receipts.some((receipt) => receipt.owner === 'nestedStrongRepair')).toBe(
    false,
  )
  expect(input.input.runs[0]).toEqual({ kind: 'copy', source: { start: 0, length: 32 } })
  const emphasis = flatten(native!.nodes).filter((node) => node.type === 'emphasis')
  expect(emphasis.map((node) => [node.position?.start.offset, node.position?.end.offset])).toEqual([
    [16, 32],
    [28, 32],
  ])
  const tree = blockToHast(native!, createHastProcessor({ math: null, raw: null }))
  expect(JSON.stringify(tree)).not.toContain('streamdown:incomplete-link')
})

const revisions = [
  { text: '# Prefix\n\n**a', heal: true },
  { text: '# Prefix\n\n**a*', heal: true },
  { text: '# Prefix\n\n**a**', heal: true },
  { text: '# Prefix\n\n**a**', heal: false },
  { text: '# Prefix\n\n**a**', heal: true },
  { text: '# Changed\n\n**a**', heal: true },
  { text: '# Changed\n\n**a', heal: true },
  { text: '# Changed\n\n**a', heal: true },
  { text: '\uFEFFa\r', heal: true },
  { text: '\uFEFFa\r\n**\ud83e', heal: true },
  { text: '\uFEFFa\r\n**\ud83e\uddd1\u200d\ud83d\udcbb e\u0301 &amp; \uddd1 \\*', heal: true },
  { text: '\uFEFFa\r\n**\ud83e\uddd1\u200d\ud83d\udcbb e\u0301 &amp; \uddd1 \\*', heal: false },
  { text: 'a\rb **c', heal: true },
  { text: 'a\rb **c**', heal: false },
]

function checkRevisions(factory: MarkdownSessionFactory): void {
  const session = factory()
  for (const revision of revisions) {
    const incremental = session.update(revision.text, { heal: revision.heal })
    const fresh = factory().update(revision.text, { heal: revision.heal })
    expect(incremental).toEqual(fresh)
    expect(prepared(incremental)).toBe(prepared(fresh))
  }
}

test.each(engines.concat([['remark-current', createMarkdownSession]]))(
  '%s starts each revision from fresh authored UTF16 provenance',
  (_engine, factory) => {
    checkRevisions(factory)
  },
)

test('a real plugin slices the exact full prepared file at nonzero prefix offsets', () => {
  const calls: { file: string; slices: string[] }[] = []
  const inspect = captureSources(calls)
  const source = '# Prefix\n\nRead **tail'
  const blocks = createMarkdownSession({ remarkPlugins: [inspect] }).update(source, { heal: true })
  expect(calls.map((call) => call.file)).toEqual([source, source + '**'])
  expect(calls[1]?.slices).toEqual(['Read **tail**'])
  expect(blocks.at(-1)?.start).toBe(10)
  expect(blocks.at(-1)?.source).toBe('Read **tail')
  expect(prepared(blocks)).toBe(source + '**')
})

function createReferenceRemarkSession(
  options: MarkdownSessionOptions = {},
): ReturnType<MarkdownSessionFactory> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkCjkFriendly)
    .use(remarkGfm)
    .use(remarkPositionedAutolinks)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkCjkStrikethrough)
    .use(remarkCjkAutolinkBoundaries)
    .use(remarkCodeMeta)
    .use(options.remarkPlugins ?? [])
  return createMarkdownSession({ processor })
}

function sourceSlice(source: string, node: Nodes): string {
  return source.slice(node.position?.start.offset, node.position?.end.offset)
}

type SourceCall = { file: string; slices: string[] }

function captureSources(calls: SourceCall[]): Plugin<[], Root> {
  return () => (root, file) => {
    const source = String(file)
    calls.push(sourceCall(root, source))
  }
}

function expectedCalls(id: string, source: string, engine: string): string[] {
  if (id.startsWith('193/'))
    return engine === 'remark' ? [source] : [source, acceptedSource(id, source, engine)]
  if (id.startsWith('194/')) return [source, source.slice(0, -1) + '***']
  if (id.startsWith('210/'))
    return [
      source,
      source + '](streamdown:incomplete-link)',
      source + '](streamdown:incomplete-link)**',
    ]
  if (id.startsWith('226/')) return [source, source.slice(0, -1) + '**\n']
  if (id === '227/live/61') return [source, source + '*']
  return engine === 'remark' ? [source, source + '*'] : [source, source + '*', source]
}

function checkPluginSources(engine: string, factory: MarkdownSessionFactory): void {
  for (const row of exactRows) checkRowSources(row, engine, factory)
}

function checkRowSources(
  row: (typeof exactRows)[number],
  engine: string,
  factory: MarkdownSessionFactory,
): void {
  const calls: SourceCall[] = []
  factory({ remarkPlugins: [captureSources(calls)] }).update(row.source, { heal: true })
  expect(
    calls.map((call) => call.file),
    row.id,
  ).toEqual(expectedCalls(row.id, row.source, engine))
  expect(calls.every(validSourceSlices), row.id).toBe(true)
}

test.each(engines)(
  '%s plugins receive each exact speculative full prepared file',
  (engine, factory) => {
    checkPluginSources(engine, factory)
  },
)

function validSourceSlices(call: SourceCall): boolean {
  return call.slices.every((slice) => call.file.includes(slice))
}

function sourceCall(root: Root, source: string): SourceCall {
  return { file: source, slices: root.children.map((node) => sourceSlice(source, node)) }
}

test('native identity points retain the installed parser exact coordinates', () => {
  for (const revision of revisions) checkNativeIdentity(revision.text)
})

function checkNativeIdentity(source: string): void {
  const parsed = parseTreeSitterMarkdown(source, { cjk: true, math: true })
  const published = createTreeSitterMarkdownSession().update(source, { heal: false })
  expect(
    flatten(published.flatMap((block) => Array.from(block.nodes))).map((node) => node.position),
  ).toEqual(flatten(parsed.children).map((node) => node.position))
}

test('native visible rejection restores the local identity pair at tail offset 39', () => {
  const row = exactRows.find((entry) => entry.id === '227/live/43')!
  const block = createTreeSitterMarkdownSession().update(row.source, { heal: true }).at(-1)!
  const prepared = blockRenderInput(block)
  if (prepared.kind !== 'prepared') throw new TypeError('Expected prepared input')
  expect(block.start).toBe(39)
  expect(block.end).toBe(92)
  expect(prepared.input.text).toBe(row.source.slice(39))
  expect(prepared.input.runs).toEqual([{ kind: 'copy', source: { start: 39, length: 53 } }])
  expect(prepared.input.receipts).toEqual([])
})
