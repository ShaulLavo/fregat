import type { Element, Nodes as HastNodes, Root as HastRoot } from 'hast'
import type { Nodes, Root, RootContent } from 'mdast'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import type { Plugin } from 'unified'
import { expect, test } from 'vitest'

import { blockRenderInput, type MarkdownBlock } from '../blocks'
import { blockToHast, createHastProcessor, type HastProcessor } from '../hast'
import { cloneTree, projectPosition, resolvePositions, sourcePoint } from '../positions'
import { beginRepair, copy, insert, rewrite, toAuthoredOffset } from '../repair-origin'
import { createMarkdownSession } from '../session'
import { attachInlineCodeSource } from '../inline-code-source'

declare module 'mdast' {
  interface Data {
    coordinateSample?: unknown
  }
}

const bare = createHastProcessor({ math: null, raw: null })
const raw = createHastProcessor({ math: null, raw: rehypeRaw })

function elements(node: HastNodes, tag: string): Element[] {
  const own = node.type === 'element' && node.tagName === tag ? [node] : []
  if (!('children' in node)) return own
  return own.concat(node.children.flatMap((child) => elements(child, tag)))
}

function firstBlock(source: string, heal = true): MarkdownBlock {
  const block = createMarkdownSession().update(source, { heal })[0]
  if (!block) throw new TypeError('Expected block')
  return block
}

function render(source: string, processor = bare, heal = true): HastRoot {
  return {
    type: 'root',
    children: createMarkdownSession()
      .update(source, { heal })
      .flatMap((block) => blockToHast(block, processor).children),
  }
}

function structuralBlock(): MarkdownBlock {
  const nodes: RootContent[] = [
    {
      type: 'paragraph',
      children: [{ type: 'text', value: 'manual' }],
      position: {
        start: { line: 8, column: 1, offset: 200 },
        end: { line: 8, column: 7, offset: 206 },
      },
    },
  ]
  return {
    key: 200,
    start: 200,
    end: 206,
    endLine: 8,
    source: 'manual',
    nodes,
    settled: true,
    hasHtml: false,
    hasMath: false,
    openFence: false,
    lastNodeType: 'paragraph',
  }
}

test('structural public blocks preserve authored positions without a private prerequisite', () => {
  const tree = blockToHast(structuralBlock(), bare)
  expect(elements(tree, 'p')[0]?.position?.start).toEqual({ line: 8, column: 1, offset: 200 })
  expect(elements(tree, 'p')[0]?.properties.dataSourceLine).toBe(8)
})

test('direct HAST runSync preserves authored input and the absent VFile source value', () => {
  const values: unknown[] = []
  const inspect: Plugin<[], HastRoot> = () => (_tree, file) => {
    values.push(file.value)
  }
  const processor = createHastProcessor({ raw: null, math: inspect })
  const tree: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [],
        position: {
          start: { line: 4, column: 1, offset: 10 },
          end: { line: 4, column: 2, offset: 11 },
        },
      },
    ],
  }
  expect(elements(processor.runSync(tree), 'p')[0]?.properties.dataSourceLine).toBe(4)
  blockToHast(firstBlock('**bold'), processor)
  expect(values).toEqual([undefined, undefined])
})

test('repaired shallow spread copies retain prepared provenance through the public node-array identity', () => {
  const block = firstBlock('**outer *inner*\n\n\n\n')
  const spread = { ...block }
  expect(blockToHast(spread, bare)).toEqual(blockToHast(block, bare))
  expect(elements(blockToHast(spread, bare), 'strong')[0]?.position?.end.offset).toBe(15)
  expect(blockRenderInput(spread).kind).toBe('prepared')
})

test('public node and position mutations and previous HAST mutations cannot rewrite private render input', () => {
  const block = firstBlock('**tail')
  const expected = blockToHast(block, bare)
  const paragraph = block.nodes[0]
  if (!paragraph || paragraph.type !== 'paragraph') throw new TypeError('Expected paragraph')
  paragraph.children.length = 0
  if (paragraph.position) paragraph.position.end.offset = 999
  const rendered = blockToHast(block, bare)
  expect(rendered).toEqual(expected)
  rendered.children.length = 0
  expect(blockToHast(block, bare)).toEqual(expected)
})

test.each([bare, raw])(
  'fresh renders project repaired positions once with loaded and absent raw stages',
  (processor) => {
    const block = firstBlock('range 20~25 and **tail')
    const first = blockToHast(block, processor)
    const second = blockToHast(block, processor)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(elements(first, 'strong')[0]?.position?.end.offset).toBe(block.source.length)
  },
)

test('raw-created descendants stay prepared until their single projection before decoration', () => {
  const source = 'x~y <span>hello</span> **tail'
  const observed: HastRoot[] = []
  const inspect: Plugin<[], HastRoot> = () => (tree) => {
    observed.push(cloneTree(tree))
  }
  const processor = createHastProcessor({ raw: rehypeRaw, math: inspect })
  const block = firstBlock(source)
  const tree = blockToHast(block, processor)
  const preparedSpan = elements(observed[0]!, 'span')[0]
  const authoredSpan = elements(tree, 'span')[0]
  expect(preparedSpan?.position?.start.offset).toBe(5)
  expect(authoredSpan?.position?.start.offset).toBe(4)
  expect(authoredSpan?.position?.end.offset).toBe(22)
  expect(authoredSpan?.properties.dataSourceLine).toBe(1)
  expect(elements(tree, 'strong')[0]?.position?.end.offset).toBe(source.length)
})

test('math and whole-document rendering retain positionless generated nodes and authored code-unit bounds', () => {
  const source = '\uFEFFa\r\n\r\n$$\nx^2\n$$\n\n**tail'
  const tree = render(source, createHastProcessor({ raw: rehypeRaw, math: rehypeKatex }))
  expect(elements(tree, 'span').some((node) => node.position === undefined)).toBe(true)
  expect(elements(tree, 'strong')[0]?.position?.end.offset).toBe(source.length)
})

test('function and non-JSON plugin data survive deliberate cloning without sharing mutable data', () => {
  const fn = () => 17
  const data = {
    fn,
    date: new Date(10),
    pattern: /x/gu,
    map: new Map([['key', { value: 1 }]]),
    set: new Set([{ value: 2 }]),
    bytes: new Uint16Array([0xd83e, 0xdddd]),
    big: 12n,
  }
  const attach: Plugin<[], Root> = () => (root) => {
    const paragraph = root.children[0]
    attachSample(paragraph, data)
  }
  const block = createMarkdownSession({ remarkPlugins: [attach] }).update('**value', {
    heal: true,
  })[0]!
  expect(block.nodes[0]?.data?.coordinateSample).toEqual(data)
  expect(block.nodes[0]?.data?.coordinateSample).not.toBe(data)
  const privateInput = blockRenderInput(block)
  expect(privateInput.nodes[0]?.data?.coordinateSample).toEqual(data)
  expect(privateInput.nodes[0]?.data?.coordinateSample).not.toBe(
    block.nodes[0]?.data?.coordinateSample,
  )
  const expected = cloneTree(data)
  const published = block.nodes[0]?.data?.coordinateSample
  mutatePublishedSample(published)
  expect(blockRenderInput(block).nodes[0]?.data?.coordinateSample).toEqual(expected)
  data.map.get('key')!.value = 88
  expect(privateInput.nodes[0]?.data?.coordinateSample).not.toEqual(data)
  expect(elements(blockToHast(block, bare), 'strong')).toHaveLength(1)
})

function withoutOffsets(root: Root): void {
  const pending: Nodes[] = [root]
  while (pending.length) {
    const node = pending.pop()!
    if (node.position)
      node.position = {
        start: { line: node.position.start.line, column: node.position.start.column },
        end: { line: node.position.end.line, column: node.position.end.column },
      }
    if ('children' in node) pending.push(...node.children)
  }
}

test('valid line/column-only plugin points resolve against the full prepared file before publication', () => {
  const plugin: Plugin<[], Root> = () => (root) => {
    withoutOffsets(root)
  }
  const source = '# Prefix\n\n**tail'
  const blocks = createMarkdownSession({ remarkPlugins: [plugin] }).update(source, { heal: true })
  const strong = elements(blockToHast(blocks.at(-1)!, bare), 'strong')[0]
  expect(strong?.position?.start).toEqual({ line: 3, column: 1, offset: 10 })
  expect(strong?.position?.end).toEqual({ line: 3, column: 7, offset: source.length })
})

test('invalid plugin positions fail explicitly and existing positionless nodes remain positionless', () => {
  const invalid: Plugin<[], Root> = () => (root) => {
    root.position = { start: { line: 1, column: 1, offset: 0 }, end: { line: 50, column: 1 } }
  }
  expect(() =>
    createMarkdownSession({ remarkPlugins: [invalid] }).update('text', { heal: true }),
  ).toThrow('Invalid Markdown position')
  const root: Root = { type: 'root', children: [{ type: 'paragraph', children: [] }] }
  resolvePositions(root, 'text')
  expect(root.children[0]?.position).toBeUndefined()
})

function tracked(source: string) {
  return beginRepair({
    text: source,
    start: toAuthoredOffset(0),
    point: { line: 1, column: 1, offset: 0 },
  })
}

function position(source: string, start: number, end: number) {
  return { start: sourcePoint(source, start), end: sourcePoint(source, end) }
}

test('projection preserves deletion seam affinity, synthetic gaps and explicit empty boundaries', () => {
  const input = tracked('abXYcd')
  const cut = rewrite({
    input,
    owner: 'hold',
    site: 'test.delete',
    parts: [copy(input, 0, 2), copy(input, 4)],
    expected: 'abcd',
  })
  expect(projectPosition(cut, position(cut.text, 2, 3)).position).toEqual(position('abXYcd', 4, 5))
  expect(projectPosition(cut, position(cut.text, 1, 2)).position).toEqual(position('abXYcd', 1, 2))
  expect(projectPosition(cut, position(cut.text, 2, 2)).origin).toEqual({
    kind: 'boundary',
    at: 2,
    gap: { left: 2, right: 4 },
  })
  const emitted = rewrite({
    input: cut,
    owner: 'remend',
    site: 'test.insert',
    parts: [copy(cut, 0, 2), insert(cut, '*', 2), copy(cut, 2)],
    expected: 'ab*cd',
  })
  expect(projectPosition(emitted, position(emitted.text, 2, 3))).toMatchObject({
    position: position('abXYcd', 2, 2),
    origin: { kind: 'synthetic', at: 2 },
  })
})

test('every session block owns local source only and settled block reuse retains its private input', () => {
  const session = createMarkdownSession()
  const before = session.update('# heading\n\n**a', { heal: true })
  const after = session.update('# heading\n\n**a**', { heal: false })
  expect(before[0]).toBe(after[0])
  expect(blockRenderInput(before[0]!).kind).toBe('prepared')
  const input = blockRenderInput(before[0]!)
  if (input.kind !== 'prepared') throw new TypeError('Expected prepared input')
  expect(input.input.window.text).toBe('# heading\n\n')
  expect(input.input.text).toBe('# heading\n\n')
  expect(Object.keys(input)).toEqual(['kind', 'input', 'nodes'])
})

function attachSample(node: RootContent | undefined, sample: unknown): void {
  if (node) node.data = { ...node.data, coordinateSample: sample }
}

test('BOM-bearing plugin points resolve in the exact full-file UTF16 domain', () => {
  const plugin: Plugin<[], Root> = () => (root) => {
    withoutOffsets(root)
  }
  const source = '\uFEFF**tail'
  const [block] = createMarkdownSession({ remarkPlugins: [plugin] }).update(source, { heal: true })
  const strong = elements(blockToHast(block!, bare), 'strong')[0]
  expect(strong?.position?.start).toEqual({ line: 1, column: 2, offset: 1 })
  expect(strong?.position?.end).toEqual({
    line: 1,
    column: source.length + 1,
    offset: source.length,
  })
})

test('positioned HAST plugin points resolve once and invalid offsets fail', () => {
  const source = '# Prefix\n\n**tail'
  const strip: Plugin<[], HastRoot> = () => (root) => {
    removeHastOffsets(root)
  }
  const processor = createHastProcessor({ raw: null, math: strip })
  const block = createMarkdownSession().update(source, { heal: true }).at(-1)!
  const strong = elements(blockToHast(block, processor), 'strong')[0]
  expect(strong?.position?.start).toEqual({ line: 3, column: 1, offset: 10 })
  expect(strong?.position?.end.offset).toBe(source.length)
  const invalid: Plugin<[], HastRoot> = () => (root) => {
    root.position = {
      start: { line: 1, column: 1, offset: -1 },
      end: { line: 1, column: 1, offset: 0 },
    }
  }
  expect(() => blockToHast(block, createHastProcessor({ raw: null, math: invalid }))).toThrow(
    'Invalid Markdown position',
  )
})

function removeHastOffsets(node: HastNodes): void {
  if (node.position)
    node.position = {
      start: { line: node.position.start.line, column: node.position.start.column },
      end: { line: node.position.end.line, column: node.position.end.column },
    }
  if (!('children' in node)) return
  for (const child of node.children) removeHastOffsets(child)
}

function mutatePublishedSample(sample: unknown): void {
  if (!sample || typeof sample !== 'object' || !('map' in sample) || !(sample.map instanceof Map))
    throw new TypeError('Expected plugin sample')
  sample.map.set('key', { value: 91 })
}

test('cloning retains cycles, descriptors, symbols and repeated non-JSON references', () => {
  const date = new Date(12)
  const callback = () => 17
  const key = Symbol('metadata')
  const original = {
    date,
    again: date,
    callback,
    [key]: { value: 1 },
    self: new Map<string, unknown>(),
  }
  original.self.set('self', original)
  Object.defineProperty(original, 'hidden', { value: { count: 3 }, enumerable: false })
  const cloned = cloneTree(original)
  expect(cloned).not.toBe(original)
  expect(cloned.date).not.toBe(date)
  expect(cloned.date).toBe(cloned.again)
  expect(cloned.callback()).toBe(17)
  expect(cloned.self.get('self')).toBe(cloned)
  expect(cloned[key]).not.toBe(original[key])
  expect(Object.getOwnPropertyDescriptor(cloned, 'hidden')).toEqual(
    Object.getOwnPropertyDescriptor(original, 'hidden'),
  )
})

const replaceFileData: Plugin<[], HastRoot> = () => (_tree, file) => {
  file.data = { ...file.data, extension: true }
}

const invalidateAfterReplacingData: Plugin<[], HastRoot> = () => (tree, file) => {
  file.data = { ...file.data, extension: true }
  tree.position = {
    start: { line: 1, column: 1, offset: -1 },
    end: { line: 50, column: 1, offset: 999 },
  }
}

test.each(['raw', 'math'] as const)(
  'replacing %s VFile data retains session projection and invalid-position rejection',
  (stage) => {
    const block = firstBlock('x~y **tail')
    const processor = createHastProcessor({ raw: null, math: null, [stage]: replaceFileData })
    const tree = blockToHast(block, processor)
    expect(tree).toEqual(blockToHast(block, bare))
    expect(elements(tree, 'strong')[0]?.position).toEqual(position(block.source, 4, 10))
    const invalid = createHastProcessor({
      raw: null,
      math: null,
      [stage]: invalidateAfterReplacingData,
    })
    expect(() => blockToHast(block, invalid)).toThrowError(
      expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
    )
  },
)

type ReentrantRender = {
  processor: HastProcessor | null
  inner: MarkdownBlock
  rendering: boolean
  values: unknown[]
  nested: HastRoot | undefined
}

const reenterRender: Plugin<[ReentrantRender], HastRoot> = (state) => (_tree, file) => {
  state.values.push(file.value)
  file.data = { extension: true }
  if (state.rendering || !state.processor) return
  state.rendering = true
  state.nested = blockToHast(state.inner, state.processor)
  state.rendering = false
}

test('data replacement survives raw reconstruction and isolates reentrant calls on one processor', () => {
  const outer = firstBlock('x~y <span>hello</span> **tail')
  const inner = firstBlock('**inner')
  const state: ReentrantRender = {
    processor: null,
    inner,
    rendering: false,
    values: [],
    nested: undefined,
  }
  const processor = createHastProcessor({ raw: rehypeRaw, math: [reenterRender, state] })
  state.processor = processor
  const tree = blockToHast(outer, processor)
  expect(elements(tree, 'span')[0]?.position?.start.offset).toBe(4)
  expect(elements(tree, 'strong')[0]?.position?.end.offset).toBe(outer.source.length)
  expect(elements(state.nested!, 'strong')[0]?.position?.end.offset).toBe(inner.source.length)
  expect(state.values).toEqual([undefined, undefined])
})

const metadataBuiltins = [
  ['Map', new Map([['entry', { content: 1 }]])],
  ['Set', new Set([{ content: 1 }])],
  ['Date', new Date(12)],
  ['RegExp', /x/gu],
  ['ArrayBuffer', new ArrayBuffer(4)],
  ['DataView', new DataView(new ArrayBuffer(4))],
  ['Uint16Array', new Uint16Array([1, 2])],
] as const

function builtinMetadata(value: object) {
  const symbol = Symbol('metadata')
  const shared = { content: 2 }
  const sample = Object.assign(value, { label: 'plugin-title', [symbol]: shared })
  Object.defineProperty(sample, 'label', { enumerable: false, writable: false })
  Object.defineProperty(sample, symbol, { enumerable: false, writable: false })
  Object.defineProperty(sample, 'self', { value: sample })
  Object.defineProperty(sample, 'alias', { value: shared })
  const data = {
    coordinateSample: sample,
    get hProperties() {
      return { title: this.coordinateSample.label }
    },
  }
  return { sample, symbol, shared, data }
}

function metadataBlock(data: ReturnType<typeof builtinMetadata>['data']): MarkdownBlock {
  return {
    ...structuralBlock(),
    nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'manual' }], data }],
  }
}

test.each(metadataBuiltins)(
  '%s own descriptors, symbols and graph links survive structural and session rendering',
  (_name, value) => {
    const { sample, symbol, shared, data } = builtinMetadata(value)
    const cloned = cloneTree(sample)
    expect(cloned).not.toBe(sample)
    expect(cloned).toEqual(sample)
    expect(Object.getPrototypeOf(cloned)).toBe(Object.getPrototypeOf(sample))
    expect(Object.getOwnPropertyDescriptor(cloned, 'label')).toEqual(
      Object.getOwnPropertyDescriptor(sample, 'label'),
    )
    expect(Object.getOwnPropertyDescriptor(cloned, symbol)).toEqual(
      Object.getOwnPropertyDescriptor(sample, symbol),
    )
    const symbolValue = Object.getOwnPropertyDescriptor(cloned, symbol)?.value
    expect(symbolValue).not.toBe(shared)
    expect(Object.getOwnPropertyDescriptor(cloned, 'alias')?.value).toBe(symbolValue)
    expect(Object.getOwnPropertyDescriptor(cloned, 'self')?.value).toBe(cloned)
    expect(elements(blockToHast(metadataBlock(data), bare), 'p')[0]?.properties.title).toBe(
      'plugin-title',
    )
    const attach: Plugin<[], Root> = () => (root) => {
      root.children[0]!.data = data
    }
    const block = createMarkdownSession({ remarkPlugins: [attach] }).update('manual', {
      heal: false,
    })[0]!
    expect(elements(blockToHast(block, bare), 'p')[0]?.properties.title).toBe('plugin-title')
  },
)

test('built-in entries and own metadata share one cloned graph and preserve accessor descriptors', () => {
  const map = new Map<unknown, unknown>()
  const set = new Set<unknown>()
  const shared = { map, set }
  map.set(shared, set)
  set.add(map)
  const getLabel = () => 'plugin-title'
  Object.defineProperty(map, 'shared', { value: shared })
  Object.defineProperty(set, 'label', { get: getLabel })
  const cloned = cloneTree({ map, set, shared })
  expect(cloned.map.get(cloned.shared)).toBe(cloned.set)
  expect(cloned.set.has(cloned.map)).toBe(true)
  expect(Object.getOwnPropertyDescriptor(cloned.map, 'shared')?.value).toBe(cloned.shared)
  expect(Object.getOwnPropertyDescriptor(cloned.set, 'label')?.get).toBe(getLabel)
  expect(cloned.shared).not.toBe(shared)
})

type CapturedRender = {
  file: Parameters<HastProcessor['runSync']>[1]
  fail: boolean
}

const captureRender: Plugin<[CapturedRender], HastRoot> = (state) => (_tree, file) => {
  state.file = file
  file.data = { extension: true }
  if (state.fail) throw new TypeError('Extension failed')
}

test.each([false, true])('per-call ownership is released after rendering fails: %s', (fail) => {
  const state: CapturedRender = { file: undefined, fail }
  const processor = createHastProcessor({ raw: [captureRender, state], math: null })
  const block = firstBlock('x~y **tail')
  if (fail) expect(() => blockToHast(block, processor)).toThrow('Extension failed')
  if (!fail) blockToHast(block, processor)
  const file = state.file
  state.fail = false
  const tree: HastRoot = {
    type: 'root',
    children: [],
    position: {
      start: { line: 8, column: 1, offset: 200 },
      end: { line: 8, column: 7, offset: 206 },
    },
  }
  expect(processor.runSync(tree, file).position).toEqual(tree.position)
})

test('code correspondence survives real raw reconstruction and sanitization at the exact occurrence', async () => {
  const { loadRawHastExtension } = await import('../hast')
  const { decodeCodeLines } = await import('../inline-code-source')
  const loaded = await loadRawHastExtension()
  const processor = createHastProcessor({ raw: loaded.default, math: null })
  const tree = render('# earlier\n\n<span>`one\ntwo`</span> and `one two`', processor, false)
  const code = elements(tree, 'code')
  expect(code).toHaveLength(2)
  expect(decodeCodeLines(String(code[0]?.properties.dataSourceCodeLines), 7)).toEqual({
    length: 7,
    runs: [
      { from: 0, to: 3, firstLine: 3, lastLine: 3 },
      { from: 3, to: 4, firstLine: 3, lastLine: 4 },
      { from: 4, to: 7, firstLine: 4, lastLine: 4 },
    ],
  })
  expect(decodeCodeLines(String(code[1]?.properties.dataSourceCodeLines), 7)?.runs).toEqual([
    { from: 0, to: 7, firstLine: 4, lastLine: 4 },
  ])
})

const spoofCodeAuthority: Plugin<[], Root> = () => (root) => {
  const paragraph = root.children[0]
  if (paragraph?.type !== 'paragraph') return
  const code = paragraph.children[0]
  if (code?.type !== 'inlineCode') return
  code.data = { hProperties: { dataSourceCodeLines: '[3,0,3,99,99]' } }
}

test('raw properties and public hProperties cannot forge code authority', async () => {
  const { loadRawHastExtension } = await import('../hast')
  const loaded = await loadRawHastExtension()
  const tree = render(
    '<code data-source-code-lines="[3,0,3,99,99]">raw</code>',
    createHastProcessor({ raw: loaded.default, math: null }),
    false,
  )
  expect(elements(tree, 'code')[0]?.properties.dataSourceCodeLines).toBeUndefined()
  const block = createMarkdownSession({ remarkPlugins: [spoofCodeAuthority] }).update('`one`', {
    heal: false,
  })[0]!
  const element = elements(blockToHast(block, bare), 'code')[0]
  expect(element?.properties.dataSourceCodeLines).toBe('0')
  expect(element?.properties.dataSourceLine).toBe(1)
})

function changeCode(root: Root, value: string, positionless: boolean): void {
  const paragraph = root.children[0]
  if (paragraph?.type !== 'paragraph') return
  const code = paragraph.children[0]
  if (code?.type !== 'inlineCode') return
  code.value = value
  if (positionless) delete code.position
}

test('value-changing and positionless remark plugins keep rendering with explicit unknown correspondence', () => {
  const change: Plugin<[], Root> = () => (root) => changeCode(root, 'replacement', false)
  const block = createMarkdownSession({ remarkPlugins: [change] }).update('`one\ntwo`', {
    heal: false,
  })[0]!
  expect(elements(blockToHast(block, bare), 'code')[0]?.properties.dataSourceCodeLines).toBe('0')
  const remove: Plugin<[], Root> = () => (root) => changeCode(root, 'positionless', true)
  const noPosition = createMarkdownSession({ remarkPlugins: [remove] }).update('`one`', {
    heal: false,
  })[0]!
  expect(elements(blockToHast(noPosition, bare), 'code')[0]?.properties.dataSourceCodeLines).toBe(
    '0',
  )
})

test('code maps are isolated from public mutations and earlier HAST mutations', () => {
  const block = firstBlock('x~y `one\ntwo`', true)
  const expected = blockToHast(block, bare)
  const publicNode = block.nodes[0]
  if (publicNode?.type === 'paragraph') publicNode.children.length = 0
  expect(blockToHast(block, bare)).toEqual(expected)
  const privateCopy = blockRenderInput(block).nodes[0]
  if (privateCopy?.type === 'paragraph') privateCopy.children.length = 0
  expect(blockToHast(block, bare)).toEqual(expected)
  const oldCode = elements(expected, 'code')[0]!
  oldCode.properties.dataSourceCodeLines = '[7,0,7,99,99]'
  expect(elements(blockToHast(block, bare), 'code')[0]?.properties.dataSourceCodeLines).not.toEqual(
    oldCode.properties.dataSourceCodeLines,
  )
})

const duplicateCode: Plugin<[], HastRoot> = () => (tree) => {
  const paragraph = tree.children[0]
  if (paragraph?.type !== 'element') return
  const code = paragraph.children[0]
  if (code) paragraph.children.push(cloneTree(code))
}
const changeRenderedCode: Plugin<[], HastRoot> = () => (tree) => {
  const code = elements(tree, 'code')[0]
  if (code) code.children = [{ type: 'text', value: 'changed' }]
}

test('duplicate prepared occurrences and post-sanitize value changes refuse stale maps', () => {
  const block = firstBlock('`one\ntwo`', false)
  const tree = blockToHast(block, createHastProcessor({ raw: null, math: duplicateCode }))
  expect(elements(tree, 'code').map((code) => code.properties.dataSourceCodeLines)).toEqual([
    '0',
    '0',
  ])
  expect(
    elements(
      blockToHast(block, createHastProcessor({ raw: null, math: changeRenderedCode })),
      'code',
    )[0]?.properties.dataSourceCodeLines,
  ).toBe('0')
})

test('code occurrence lifetime follows the actual VFile through reentry, data replacement, success and throw', () => {
  let inner: HastRoot | undefined
  let file: Parameters<HastProcessor['runSync']>[1]
  let active = false
  const nested = firstBlock('`one two\nthree`', false)
  function enterNested(): void {
    if (active) return
    active = true
    inner = blockToHast(nested, processor)
    active = false
  }
  const inspect: Plugin<[], HastRoot> = () => (_tree, current) => {
    file = current
    current.data = {}
    expect(current.value).toBeUndefined()
    enterNested()
  }
  const processor = createHastProcessor({ raw: null, math: inspect })
  const outer = blockToHast(firstBlock('`one\ntwo three`', false), processor)
  expect(elements(outer, 'code')[0]?.properties.dataSourceCodeLines).not.toBe(
    elements(inner!, 'code')[0]?.properties.dataSourceCodeLines,
  )
  const direct: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [{ type: 'text', value: 'direct' }],
      },
    ],
  }
  expect(
    elements(processor.runSync(direct, file), 'code')[0]?.properties.dataSourceCodeLines,
  ).toBeUndefined()
  const fail: Plugin<[], HastRoot> = () => (_tree, current) => {
    file = current
    throw new TypeError('deliberate renderer failure')
  }
  expect(() =>
    blockToHast(firstBlock('`one\ntwo`', false), createHastProcessor({ raw: null, math: fail })),
  ).toThrow('deliberate renderer failure')
  expect(
    elements(bare.runSync(direct, file), 'code')[0]?.properties.dataSourceCodeLines,
  ).toBeUndefined()
})

test('raw code authority snapshots values before optional plugins and requires unique survivors', async () => {
  const { loadRawHastExtension } = await import('../hast')
  const loaded = await loadRawHastExtension()
  const source = '<code>one</code>'
  const unchanged: Plugin<[], HastRoot> = () => (tree) => cloneTree(tree)
  const change: Plugin<[], HastRoot> = () => (tree) => {
    const code = elements(tree, 'code')[0]!
    code.children = [{ type: 'text', value: 'two' }]
    code.properties.dataSourceCodeLines = '[3,0,3,99,99]'
  }
  const cloned = render(
    source,
    createHastProcessor({ raw: loaded.default, math: unchanged }),
    false,
  )
  expect(elements(cloned, 'code')[0]?.properties.dataSourceCodeLines).toBeUndefined()
  expect(elements(cloned, 'code')[0]?.properties.dataSourceLine).toBe(1)
  const changed = render(source, createHastProcessor({ raw: loaded.default, math: change }), false)
  expect(elements(changed, 'code')[0]?.properties.dataSourceCodeLines).toBe('0')
  const duplicate = render(
    source,
    createHastProcessor({ raw: loaded.default, math: duplicateCode }),
    false,
  )
  expect(elements(duplicate, 'code').map((code) => code.properties.dataSourceCodeLines)).toEqual([
    '0',
    '0',
  ])
})

test('raw code authority stays invocation-local through reentry, data replacement and throwing plugins', async () => {
  const { loadRawHastExtension } = await import('../hast')
  const loaded = await loadRawHastExtension()
  let inner: HastRoot | undefined
  let saved: HastRoot | undefined
  let file: Parameters<HastProcessor['runSync']>[1]
  let active = false
  const nested = firstBlock('zzzzzzzzzzzzzz', false)
  function enterNested(tree: HastRoot): HastRoot | undefined {
    if (active) return cloneTree(saved!)
    saved = cloneTree(tree)
    active = true
    inner = blockToHast(nested, processor)
    active = false
  }
  const inspect: Plugin<[], HastRoot> = () => (tree, current) => {
    current.data = {}
    const result = enterNested(tree)
    file = current
    return result
  }
  const processor = createHastProcessor({ raw: loaded.default, math: inspect })
  const outer = blockToHast(firstBlock('<code>x</code>', false), processor)
  expect(elements(outer, 'code')[0]?.properties.dataSourceCodeLines).toBeUndefined()
  expect(elements(inner!, 'code')[0]?.properties.dataSourceCodeLines).toBe('0')
  const direct = cloneTree(saved!)
  expect(
    elements(bare.runSync(direct, file), 'code')[0]?.properties.dataSourceCodeLines,
  ).toBeUndefined()
  const fail: Plugin<[], HastRoot> = () => (_tree, current) => {
    file = current
    current.data = {}
    throw new TypeError('deliberate raw authority failure')
  }
  expect(() =>
    blockToHast(
      firstBlock('<code>x</code>', false),
      createHastProcessor({ raw: loaded.default, math: fail }),
    ),
  ).toThrow('deliberate raw authority failure')
  expect(
    elements(bare.runSync(cloneTree(saved!), file), 'code')[0]?.properties.dataSourceCodeLines,
  ).toBeUndefined()
})

const rawContributionChanges = [
  'value',
  'type',
  'bounds',
  'duplicate',
  'insert',
  'foreign insertion',
  'missing',
] as const

type RawContributionChange = (typeof rawContributionChanges)[number]
function changeRawContribution(tree: HastRoot, kind: RawContributionChange): void {
  const paragraph = elements(tree, 'p')[0]!
  const index = paragraph.children.findIndex((node) => node.type === 'text' && node.value === 'x')
  const node = paragraph.children[index]!
  if (node.type !== 'text') return
  if (kind === 'value') node.value = 'q'
  if (kind === 'type') paragraph.children[index] = { ...node, type: 'raw' }
  if (kind === 'bounds') node.position = cloneTree(paragraph.children[0]!.position)
  if (kind === 'duplicate') paragraph.children.splice(index, 0, cloneTree(node))
  if (kind === 'insert') paragraph.children.splice(index, 0, { type: 'raw', value: '<!--x-->' })
  if (kind === 'foreign insertion')
    paragraph.children.splice(index, 0, {
      type: 'raw',
      value: '<!--z-->',
      position: cloneTree(
        paragraph.children.find((child) => child.type === 'text' && child.value === ' ')!.position,
      ),
    })
  if (kind === 'missing') paragraph.children.splice(index, 1)
}

test.each(rawContributionChanges)(
  'canonical raw authority validates current local %s contributors',
  async (kind) => {
    const { loadRawHastExtension } = await import('../hast')
    const genuine = (await loadRawHastExtension()).default
    const change: Plugin<[], HastRoot> = () => (tree) => changeRawContribution(tree, kind)
    const tree = render(
      '<code>x</code> <code>y</code>',
      createHastProcessor({ raw: { plugins: [change, genuine] }, math: null }),
      false,
    )
    expect(elements(tree, 'code').map((node) => node.properties.dataSourceCodeLines)).toEqual([
      '0',
      undefined,
    ])
    expect(elements(tree, 'code').map((node) => node.properties.dataSourceLine)).toEqual([1, 1])
  },
)

test('bare raw renders code while only the canonical producer grants prepared raw authority', async () => {
  const source = '<code>x</code>'
  const direct = render(source, raw, false)
  expect(elements(direct, 'code')[0]?.children).toMatchObject([{ type: 'text', value: 'x' }])
  expect(elements(direct, 'code')[0]?.properties.dataSourceCodeLines).toBe('0')
  expect(elements(direct, 'code')[0]?.properties.dataSourceLine).toBe(1)
  const { loadRawHastExtension } = await import('../hast')
  await loadRawHastExtension()
  expect(render(source, raw, false)).toEqual(direct)
  expect(
    elements(render('`one\ntwo`', raw, false), 'code')[0]?.properties.dataSourceCodeLines,
  ).toBe('[7,0,3,1,1,3,4,1,2,4,7,2,2]')
})

const forgeInlineSource: Plugin<[], Root> = () => (tree) => {
  const paragraph = tree.children[0]
  if (paragraph?.type !== 'paragraph') return
  const code = paragraph.children[0]
  if (code?.type !== 'inlineCode') return
  attachInlineCodeSource(code, {
    value: 'one\ntwo',
    tokenLength: 9,
    runs: [{ kind: 'atom', valueStart: 0, valueLength: 7, tokenOffset: 1, sourceLength: 1 }],
  })
}

test('parser evidence survives unchanged remark clones and rejects replaced literal evidence', () => {
  const unchanged: Plugin<[], Root> = () => (tree) => cloneTree(tree)
  const session = (plugin: Plugin<[], Root>) =>
    createMarkdownSession({ remarkPlugins: [plugin] }).update('`one\ntwo`', { heal: false })[0]!
  expect(
    elements(blockToHast(session(unchanged), bare), 'code')[0]?.properties.dataSourceCodeLines,
  ).toBe('[7,0,3,1,1,3,4,1,2,4,7,2,2]')
  expect(
    elements(blockToHast(session(forgeInlineSource), bare), 'code')[0]?.properties
      .dataSourceCodeLines,
  ).toBe('0')
})
