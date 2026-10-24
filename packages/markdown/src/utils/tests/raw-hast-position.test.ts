import type { Element, Nodes, Root } from 'hast'
import type { Root as MdastRoot } from 'mdast'
import rehypeRaw from 'rehype-raw'
import { unified, type Plugin, type Pluggable } from 'unified'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { toHast } from 'mdast-util-to-hast'

import { loadMarkdownExtension, setMarkdownExtensionLoaders } from '../../state/extensions'

import { blockToHast, createHastProcessor, type HastProcessor } from '../hast'
import { cloneTree } from '../positions'
import { blockRenderInput, type MarkdownBlock } from '../blocks'
import { createMarkdownSession } from '../session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../tree-sitter-session'

let defaultRaw: Pluggable
beforeAll(async () => {
  setMarkdownExtensionLoaders(null)
  const loaded = await loadMarkdownExtension('raw')
  if (!loaded.raw) throw new TypeError('Expected default raw loader')
  defaultRaw = loaded.raw
  await initializeTreeSitterMarkdown()
})
afterAll(() => setMarkdownExtensionLoaders(null))

function elements(node: Nodes, tag: string): Element[] {
  const own = node.type === 'element' && node.tagName === tag ? [node] : []
  if (!('children' in node)) return own
  return own.concat(node.children.flatMap((child) => elements(child, tag)))
}

function render(source: string, raw: Pluggable = defaultRaw, math: Plugin<[], Root> | null = null) {
  const processor = createHastProcessor({ raw, math })
  return createMarkdownSession()
    .update(source, { heal: false })
    .map((block) => blockToHast(block, processor))
}

test.each([createMarkdownSession, createTreeSitterMarkdownSession])(
  'html-inline renders every live UTF16 prefix through the real session',
  (makeSession) => {
    const source = 'A <kbd>Ctrl</kbd> key.'
    const session = makeSession()
    const processor = createHastProcessor({ raw: defaultRaw, math: null })
    for (let offset = 0; offset <= source.length; offset += 1) {
      const blocks = session.update(source.slice(0, offset), { heal: true })
      for (const block of blocks) blockToHast(block, processor)
    }
  },
)

test('terminal opener uses the exact structural closing event while preserving raw snapshots', () => {
  const snapshots = rawSnapshots('A <kbd>')
  const tree = render('A <kbd>')[0]!
  expect(elements(snapshots[0]!, 'p')[0]?.position?.end.offset).toBe(7)
  expect(elements(snapshots[1]!, 'kbd')[0]?.position).toMatchObject({
    start: { offset: 2 },
    end: { offset: 0 },
  })
  expect(elements(tree, 'kbd')[0]?.position).toMatchObject({
    start: { offset: 2 },
    end: { offset: 7 },
  })
  expect(elements(snapshots[1]!, 'kbd')[0]?.position?.end.offset).toBe(0)
})

test.each(['A <kbd>Ctrl</kbd> key.', 'A <kbd>text', 'A **B <kbd>**', 'A <kbd>one\n\ntwo</kbd>'])(
  'preserves already ordered raw ranges: %s',
  (source) => {
    const snapshots = rawSnapshots(source).filter((_, index) => index % 2 === 1)
    const trees = render(source)
    const before = snapshots
      .flatMap((tree) => elements(tree, 'kbd'))
      .filter((node) => node.position && node.position.start.offset! <= node.position.end.offset!)
    const after = trees.flatMap((tree) => elements(tree, 'kbd'))
    for (const node of before)
      expect(
        after.find((candidate) => candidate.position?.start.offset === node.position?.start.offset)
          ?.position,
      ).toEqual(node.position)
  },
)

test('math positionless nodes stay absent and malformed math intervals still fail', () => {
  const positionless: Plugin<[], Root> = () => (tree) => {
    tree.children.push({ type: 'element', tagName: 'span', properties: {}, children: [] })
  }
  expect(
    elements(render('A <kbd>', defaultRaw, positionless)[0]!, 'span')[0]?.position,
  ).toBeUndefined()
  const invalid: Plugin<[], Root> = () => (tree) => {
    elements(tree, 'kbd')[0]!.position = {
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 1, column: 1, offset: 0 },
    }
  }
  expect(() => render('A <kbd>', defaultRaw, invalid)).toThrow('Invalid Markdown position')
})

test('ordered raw intervals that coincide with the owner start are unchanged', () => {
  const ordered: Plugin<[], Root> = () => (tree, file) => {
    const result = rehypeRaw()(tree, file)
    const node = elements(result, 'kbd')[0]!
    node.position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    }
    return result
  }
  expect(elements(render('A <kbd>', ordered)[0]!, 'kbd')[0]?.position).toEqual({
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  })
})

test('positionless reconstructed elements remain positionless', () => {
  const positionless: Plugin<[], Root> = () => (tree, file) => {
    const result = rehypeRaw()(tree, file)
    delete elements(result, 'kbd')[0]!.position
    return result
  }
  expect(elements(render('A <kbd>', positionless)[0]!, 'kbd')[0]?.position).toBeUndefined()
})

test('duplicate prepared raw starts reject ambiguous reconstructed ownership', () => {
  const session = createMarkdownSession({ remarkPlugins: [duplicateRawStart] })
  const blocks = session.update('A <kbd>', { heal: false })
  const processor = createHastProcessor({ raw: defaultRaw, math: null })
  expect(() => blocks.map((block) => blockToHast(block, processor))).toThrow(
    'Invalid Markdown position',
  )
})

test('duplicate structural close markers reject ambiguous owner identities', () => {
  expect(() => render('**A <kbd>**')).toThrow('Invalid Markdown position')
})

test('changed structural owner identities and unrelated malformed raw intervals still fail', () => {
  const changedOwner: Plugin<[], Root> = () => (tree, file) => {
    const result = rehypeRaw()(tree, file)
    elements(result, 'p')[0]!.position!.end = { line: 1, column: 7, offset: 6 }
    return result
  }
  expect(() => render('A <kbd>', changedOwner)).toThrow('Invalid Markdown position')
  const unrelated: Plugin<[], Root> = () => (tree, file) => {
    const result = rehypeRaw()(tree, file)
    elements(result, 'kbd')[0]!.position!.end = { line: 1, column: 2, offset: 1 }
    return result
  }
  expect(() => render('A <kbd>', unrelated)).toThrow('Invalid Markdown position')
})

test('terminal close correction stays prepared until the original source projection', () => {
  const block = createMarkdownSession().update('x~y <kbd>', { heal: true })[0]!
  const tree = blockToHast(block, createHastProcessor({ raw: defaultRaw, math: null }))
  expect(elements(tree, 'kbd')[0]?.position).toMatchObject({
    start: { offset: 4 },
    end: { offset: 9 },
  })
})

test('a textarea consumes its cell close and the exact row close ends the final structural cell', () => {
  const source = '| a | b |\n| - | - |\n| c | A <textarea>tail |'
  const snapshots = rawSnapshots(source).filter((_, index) => index % 2 === 1)
  const tree = render(source)[0]!
  const reconstructed = elements(snapshots[0]!, 'td').at(-1)!
  expect(reconstructed.position).toMatchObject({ start: { offset: 24 }, end: { offset: 20 } })
  expect(elements(tree, 'td').at(-1)?.position).toMatchObject({
    start: { offset: 24 },
    end: { offset: source.length },
  })
})

test.each([
  '| a | b |\n| - | - |\n| c | A <textarea>tail</textarea> |',
  '| a | b |\n| - | - |\n| c | A <textarea>tail |\n| d | end |',
])('preserves explicit textarea closes and sibling row ownership: %s', (source) => {
  expect(() => render(source)).not.toThrow()
})

const duplicateRawStart: Plugin<[], MdastRoot> = () => (root) => {
  const paragraph = root.children[0]
  if (paragraph?.type !== 'paragraph') return
  const opener = paragraph.children.at(-1)
  if (opener) paragraph.children.push(cloneTree(opener))
}

test('raw close ownership uses full-file prepared offsets for a later block', () => {
  const source = '# Before\n\nA <kbd>'
  const trees = render(source)
  expect(elements(trees.at(-1)!, 'kbd')[0]?.position).toMatchObject({
    start: { line: 3, column: 3, offset: 12 },
    end: { line: 3, column: 8, offset: source.length },
  })
})

test('a changed table row closing event remains an invalid structural interval', () => {
  const altered: Plugin<[], Root> = () => (tree, file) => {
    const result = rehypeRaw()(tree, file)
    elements(result, 'tr').at(-1)!.position!.end = { line: 3, column: 24, offset: 43 }
    return result
  }
  expect(() => render('| a | b |\n| - | - |\n| c | A <textarea>tail |', altered)).toThrow(
    'Invalid Markdown position',
  )
})

function rawSnapshots(source: string): Root[] {
  return createMarkdownSession().update(source, { heal: false }).flatMap(rawBlockSnapshots)
}

function rawBlockSnapshots(block: MarkdownBlock): [Root, Root] {
  const input = blockRenderInput(block)
  const tree = toHast(
    { type: 'root', children: Array.from(input.nodes) },
    {
      allowDangerousHtml: true,
      clobberPrefix: '',
    },
  )
  if (tree.type !== 'root') throw new TypeError('Expected raw root')
  const before = cloneTree(tree)
  const rawTree = rawProcessor(rehypeRaw).runSync(tree)
  return [before, rawTree]
}

function counterfeitRaw(end: number): Plugin<[], Root> {
  return () => (tree) => {
    const paragraph = elements(tree, 'p')[0]!
    const opener = paragraph.children.at(-1)!
    paragraph.children[paragraph.children.length - 1] = {
      type: 'element',
      tagName: 'kbd',
      properties: {},
      children: [],
      position: {
        start: { ...opener.position!.start },
        end: { line: 1, column: end + 1, offset: end },
      },
    }
  }
}

test.each([0, 1])('arbitrary raw plugins cannot authorize a malformed [2,%i) interval', (end) => {
  expect(() => render('A <kbd>', counterfeitRaw(end))).toThrowError(
    expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
  )
})

function extraRaw(descendant: boolean): Plugin<[], MdastRoot> {
  return () => (tree) => addExtraRaw(tree, descendant)
}

function addExtraRaw(tree: MdastRoot, descendant: boolean): void {
  const table = tree.children[0]
  if (table?.type !== 'table') throw new TypeError('Expected table')
  const cell = table.children.at(-1)!.children.at(-1)!
  const comment = { type: 'html', value: '<!-- extra raw -->' } as const
  cell.children.unshift(descendant ? { type: 'emphasis', children: [comment] } : comment)
}

test.each([false, true])(
  'every positionless raw instance prevents textarea cell repair: descendant=%s',
  (descendant) => {
    const source = '| a | b |\n| - | - |\n| c | A <textarea>tail |'
    const blocks = createMarkdownSession({ remarkPlugins: [extraRaw(descendant)] }).update(source, {
      heal: false,
    })
    const processor = createHastProcessor({ raw: defaultRaw, math: null })
    expect(() => blocks.map((block) => blockToHast(block, processor))).toThrowError(
      expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
    )
  },
)

test('the production default raw loader preserves a lone UTF16 surrogate', () => {
  const source = '😀\ud800 A <kbd>'
  expect(elements(render(source)[0]!, 'kbd')[0]?.position?.end.offset).toBe(source.length)
})

test('a direct rehype-raw extension has no default-loader repair authority', () => {
  expect(() => render('A <kbd>', rehypeRaw)).toThrowError(
    expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
  )
})

test('arbitrary output after a genuine default-loader invocation stays strict', () => {
  const altered: Plugin<[], Root> = () => (tree, file) => {
    const result = rawProcessor(defaultRaw).runSync(tree, file)
    elements(result, 'kbd')[0]!.position!.end = { line: 1, column: 1, offset: 0 }
    return result
  }
  expect(() => render('A <kbd>', altered)).toThrowError(
    expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
  )
})

function rawProcessor(raw: Pluggable) {
  const identity: Plugin<[], Root> = () => (tree) => tree
  return unified().use(identity).use([raw])
}

type InvocationState = {
  processor: HastProcessor | null
  inner: MarkdownBlock
  entering: boolean
  fail: boolean
  files: Parameters<HastProcessor['runSync']>[1][]
  values: unknown[]
  nested: Root | undefined
}

const inspectInvocation: Plugin<[InvocationState], Root> = (state) => (_tree, file) => {
  state.files.push(file)
  state.values.push(file.value)
  file.data = { extension: true }
  if (state.fail) throw new TypeError('Extension failed')
  if (state.entering || !state.processor) return
  state.entering = true
  state.nested = blockToHast(state.inner, state.processor)
  state.entering = false
}

test.each([false, true])(
  'default-loader invocation isolates reentry and finally releases VFile ownership: fail=%s',
  (fail) => {
    const inner = createMarkdownSession().update('😀\ud800 B <kbd>', { heal: false })[0]!
    const outer = createMarkdownSession().update('x~y A <kbd>', { heal: true })[0]!
    const state: InvocationState = {
      processor: null,
      inner,
      entering: false,
      fail,
      files: [],
      values: [],
      nested: undefined,
    }
    const processor = createHastProcessor({ raw: defaultRaw, math: [inspectInvocation, state] })
    state.processor = processor
    if (fail) expect(() => blockToHast(outer, processor)).toThrow('Extension failed')
    if (!fail)
      expect(elements(blockToHast(outer, processor), 'kbd')[0]?.position?.end.offset).toBe(
        outer.source.length,
      )
    if (!fail)
      expect(elements(state.nested!, 'kbd')[0]?.position?.end.offset).toBe(inner.source.length)
    expect(state.values.every((value) => value === undefined)).toBe(true)
    state.fail = false
    state.processor = null
    const position = {
      start: { line: 8, column: 1, offset: 200 },
      end: { line: 8, column: 7, offset: 206 },
    }
    const direct: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [{ type: 'text', value: 'manual', position }],
          position,
        },
      ],
    }
    expect(elements(processor.runSync(direct, state.files[0]), 'p')[0]?.position).toEqual(position)
  },
)

test('overriding the state raw loader cannot grant repair authority', async () => {
  setMarkdownExtensionLoaders({ raw: async () => ({ default: counterfeitRaw(0) }) })
  try {
    const loaded = await loadMarkdownExtension('raw')
    expect(loaded.raw).not.toBeNull()
    expect(() => render('A <kbd>', loaded.raw!)).toThrowError(
      expect.objectContaining({ code: 'MARKDOWN_POSITION' }),
    )
  } finally {
    setMarkdownExtensionLoaders(null)
  }
})
