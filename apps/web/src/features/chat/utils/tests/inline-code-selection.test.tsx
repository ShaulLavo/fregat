import {
  blockToHast,
  createHastProcessor,
  loadRawHastExtension,
} from '@workspace/markdown/utils/hast'
import { createMarkdownSession, type MarkdownParser } from '@workspace/markdown/utils/session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '@workspace/markdown/utils/tree-sitter-session'
import { decodeCodeLines } from '@workspace/markdown/utils/inline-code-source'
import { chatMarkdownClipboardPayload } from '../markdown-clipboard'
import { expect, test } from '../../../../../test/fixtures'
import { planSelectionLines, planCommentQuote } from '../plan-comment'

type HastNode = ReturnType<typeof blockToHast> | ReturnType<typeof blockToHast>['children'][number]

function attributeName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

function append(parent: Node, node: HastNode): void {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.value))
    return
  }
  if (node.type === 'element') {
    const element = document.createElement(node.tagName)
    for (const [key, value] of Object.entries(node.properties))
      element.setAttribute(attributeName(key), String(value))
    parent.appendChild(element)
    for (const child of node.children) append(element, child)
    return
  }
  if (node.type === 'root') for (const child of node.children) append(parent, child)
}

async function rendered(source: string, native: boolean, heal: boolean) {
  if (native) await initializeTreeSitterMarkdown()
  const session = native ? createTreeSitterMarkdownSession() : createMarkdownSession()
  const container = document.createElement('div')
  const processor = createHastProcessor({ raw: null, math: null })
  for (const block of session.update(source, { heal }))
    append(container, blockToHast(block, processor))
  document.body.appendChild(container)
  return container
}

function select(container: HTMLElement, start: number, end: number) {
  const text = container.querySelector('code')?.firstChild
  if (!text) throw new TypeError('Expected code text')
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

const pairCases = [false, true].flatMap((native) =>
  [false, true].flatMap((heal) => ['\n', '\r\n', '\r'].map((eol) => ({ native, heal, eol }))),
)
test.each(pairCases)(
  'distinguishes equal code DOM $native $heal $eol',
  async ({ native, heal, eol }) => {
    for (const [source, line, quote] of [
      [`\`one${eol}two three\``, 2, '> two three`'],
      [`\`one two${eol}three\``, 1, '> `one two'],
    ] as const) {
      const container = await rendered(source, native, heal)
      try {
        expect(select(container, 4, 7).toString()).toBe('two')
        expect(planSelectionLines(container)).toEqual({ start: line, end: line })
        expect(planCommentQuote(source, { start: line, end: line })).toBe(
          `About the proposed plan, line ${line}:\n\n${quote}`,
        )
      } finally {
        document.getSelection()?.removeAllRanges()
        container.remove()
      }
    }
  },
)

const literalCases = [
  {
    source: '`one\ntwo`',
    from: 0,
    to: 7,
    start: 1,
    end: 2,
    text: 'one two',
    quote: '> `one\n> two`',
  },
  {
    source: '`\none\ntwo\n`',
    from: 0,
    to: 7,
    start: 2,
    end: 3,
    text: 'one two',
    quote: '> one\n> two',
  },
  { source: '`one\ntwo`', from: 0, to: 3, start: 1, end: 1, text: 'one', quote: '> `one' },
  { source: '`one\ntwo`', from: 0, to: 4, start: 1, end: 1, text: 'one ', quote: '> `one' },
  { source: '`one\ntwo`', from: 3, to: 5, start: 1, end: 2, text: ' t', quote: '> `one\n> two`' },
  {
    source: '`one\nx\ntwo`',
    from: 3,
    to: 7,
    start: 1,
    end: 3,
    text: ' x t',
    quote: '> `one\n> x\n> two`',
  },
  { source: '> `one\n> two`', from: 4, to: 7, start: 2, end: 2, text: 'two', quote: '> > two`' },
  { source: '- `one\n  two`', from: 4, to: 7, start: 2, end: 2, text: 'two', quote: '>   two`' },
  { source: '> `one\ntwo`', from: 4, to: 7, start: 2, end: 2, text: 'two', quote: '> two`' },
  { source: '>\t`a\n>\tb`', from: 2, to: 5, start: 2, end: 2, text: '  b', quote: '> >\tb`' },
  {
    source: '<div>\n\nref[^x]\n\n[^x]: `one\n    two`\n\n</div>',
    from: 4,
    to: 7,
    start: 6,
    end: 6,
    text: 'two',
    quote: '>     two`',
  },
  {
    source: '| a |\n| - |\n| `a\\|b` |',
    from: 1,
    to: 2,
    start: 3,
    end: 3,
    text: '|',
    quote: '> | `a\\|b` |',
  },
  {
    source: '`😀e\u0301\ud800\ntwo\udfff🧑‍💻`',
    from: 1,
    to: 2,
    start: 1,
    end: 1,
    text: '\ude00',
    quote: '> `😀e\u0301\ud800',
  },
  {
    source: '`😀e\u0301\ud800\ntwo\udfff🧑‍💻`',
    from: 9,
    to: 10,
    start: 2,
    end: 2,
    text: '\udfff',
    quote: '> two\udfff🧑‍💻`',
  },
  { source: '``a`b\nc``', from: 4, to: 5, start: 2, end: 2, text: 'c', quote: '> c``' },
  { source: '`a\0b`', from: 1, to: 2, start: 1, end: 1, text: '\ufffd', quote: '> `a\0b`' },
  {
    source: '# prefix\n\n`one\ntwo`',
    from: 4,
    to: 7,
    start: 4,
    end: 4,
    text: 'two',
    quote: '> two`',
  },
]
const engineCases = [false, true].flatMap((native) =>
  [false, true].map((heal) => ({ native, heal })),
)
test.each(engineCases)(
  'quotes independent literal witnesses $native $heal',
  async ({ native, heal }) => {
    for (const fixture of literalCases) {
      const container = await rendered(fixture.source, native, heal)
      try {
        expect(container.querySelector('code'), fixture.source).not.toBeNull()
        expect(select(container, fixture.from, fixture.to).toString(), fixture.source).toBe(
          fixture.text,
        )
        const lines = planSelectionLines(container)
        expect(lines, fixture.source).toEqual({ start: fixture.start, end: fixture.end })
        expect(planCommentQuote(fixture.source, lines!), fixture.source).toBe(
          `About the proposed plan, ${fixture.start === fixture.end ? `line ${fixture.start}` : `lines ${fixture.start}–${fixture.end}`}:\n\n${fixture.quote}`,
        )
      } finally {
        document.getSelection()?.removeAllRanges()
        container.remove()
      }
    }
  },
)

test.each([false, true])(
  'selects repeated code occurrences and applies only the nearest offset %j',
  async (native) => {
    const source = '`one\ntwo`\n\n`one two\nthree`'
    const container = await rendered(source, native, false)
    try {
      const code = container.querySelectorAll('code')[1]!
      const inner = document.createElement('div')
      inner.dataset.sourceLineOffset = '2'
      code.replaceWith(inner)
      inner.appendChild(code)
      container.dataset.sourceLineOffset = '17'
      const range = document.createRange()
      range.setStart(code.firstChild!, 4)
      range.setEnd(code.firstChild!, 7)
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
      expect(planSelectionLines(container, 4)).toEqual({ start: 10, end: 10 })
      expect(planSelectionLines(inner)).toEqual({ start: 6, end: 6 })
    } finally {
      document.getSelection()?.removeAllRanges()
      container.remove()
    }
  },
)

function installRange(start: Node, from: number, end: Node, to: number): void {
  const range = document.createRange()
  range.setStart(start, from)
  range.setEnd(end, to)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
}

test.each([false, true])(
  'resolves actual cross-node, element, exclusive and backwards endpoints %j',
  async (native) => {
    const container = await rendered('`one\ntwo`\n*three* and `red\nblue`', native, false)
    try {
      const codes = container.querySelectorAll('code')
      const emphasis = container.querySelector('em')!
      const paragraph = container.querySelector('p')!
      installRange(codes[0]!.firstChild!, 4, emphasis.firstChild!, 5)
      expect(planSelectionLines(container)).toEqual({ start: 2, end: 3 })
      installRange(codes[0]!.firstChild!, 4, codes[1]!.firstChild!, 8)
      expect(planSelectionLines(container)).toEqual({ start: 2, end: 4 })
      installRange(paragraph, 0, paragraph, 1)
      expect(planSelectionLines(container)).toEqual({ start: 1, end: 2 })
      installRange(paragraph, 2, paragraph, 3)
      expect(planSelectionLines(container)).toEqual({ start: 3, end: 3 })
      document.getSelection()!.setBaseAndExtent(emphasis.firstChild!, 5, codes[0]!.firstChild!, 4)
      expect(planSelectionLines(container)).toEqual({ start: 2, end: 3 })
    } finally {
      document.getSelection()?.removeAllRanges()
      container.remove()
    }
  },
)

test.each([false, true])(
  'rejects collapsed, whitespace-only, outside and unmapped selections %j',
  async (native) => {
    const container = await rendered('`one\ntwo`', native, false)
    const outside = document.createTextNode('outside')
    document.body.appendChild(outside)
    try {
      select(container, 4, 4)
      expect(planSelectionLines(container)).toBeNull()
      select(container, 3, 4)
      expect(planSelectionLines(container)).toBeNull()
      installRange(outside, 0, outside, 3)
      expect(planSelectionLines(container)).toBeNull()
      const code = container.querySelector('code')!
      code.dataset.sourceCodeLines = '[7]'
      select(container, 4, 7)
      expect(planSelectionLines(container)).toBeNull()
      code.dataset.sourceCodeLines = '[7,0,3,1,1,6,7,2,2]'
      select(container, 4, 6)
      expect(planSelectionLines(container)).toBeNull()
      select(container, 4, 7)
      expect(planSelectionLines(container)).toEqual({ start: 2, end: 2 })
    } finally {
      document.getSelection()?.removeAllRanges()
      container.remove()
      outside.remove()
    }
  },
)

function appendBlocks(
  container: HTMLElement,
  blocks: ReturnType<ReturnType<typeof createMarkdownSession>['update']>,
): void {
  for (const block of blocks)
    append(container, blockToHast(block, createHastProcessor({ raw: null, math: null })))
}

test.each([false, true])(
  'healed closers and repeated updates preserve original quotes %j',
  async (native) => {
    if (native) await initializeTreeSitterMarkdown()
    const session = native ? createTreeSitterMarkdownSession() : createMarkdownSession()
    for (const source of ['`one\ntwo', '`one\ntwo`', '`one\nnew`', '`one\nnew']) {
      const container = document.createElement('div')
      document.body.appendChild(container)
      try {
        appendBlocks(container, session.update(source, { heal: true }))
        select(container, 4, 7)
        expect(planSelectionLines(container)).toEqual({ start: 2, end: 2 })
        expect(planCommentQuote(source, planSelectionLines(container)!)).toBe(
          `About the proposed plan, line 2:\n\n> ${source.slice(5)}`,
        )
      } finally {
        document.getSelection()?.removeAllRanges()
        container.remove()
      }
    }
  },
)

const anchorCases = [
  {
    name: '186/completed/51',
    source: '`[x]: $x`\n$/t[x(https://example.test/a)]: /t\nar[x]\n`',
    heal: false,
    line: 2,
    quote: '> $/t[x(https://example.test/a)]: /t',
  },
  {
    name: '210/completed/55',
    source:
      '|*>\r\n * a&amp;| a b &amp;|\n|----|\n---|\n |--| a | b\n.[`| a | b |\n|`---|(https://example.tes| a | b |\n|---|-|\n\n',
    heal: false,
    line: 7,
    quote: '> |`---|(https://example.tes| a | b |',
  },
  {
    name: '210/live/55',
    source:
      '|*>\r\n * a&amp;| a b &amp;|\n|----|\n---|\n |--| a | b\n.[`| a | b |\n|`---|(https://example.tes| a | b |\n|---|-|\n\n',
    heal: true,
    line: 7,
    quote: '> |`---|(https://example.tes| a | b |',
  },
]

async function checkAnchor(
  source: string,
  native: boolean,
  heal: boolean,
  expected: number[],
  quote?: string,
): Promise<void> {
  const container = await rendered(source, native, heal)
  try {
    const links = container.querySelectorAll('a')
    expect(links.length).toBe(expected.length)
    links.forEach((link, index) =>
      checkSelectedLink(container, link, source, expected[index]!, quote),
    )
  } finally {
    document.getSelection()?.removeAllRanges()
    container.remove()
  }
}

test.each([false, true])(
  'retains saved 186/210 anchors and repeated URL occurrences %j',
  async (native) => {
    for (const fixture of anchorCases)
      await checkAnchor(fixture.source, native, fixture.heal, [fixture.line], fixture.quote)
    await checkAnchor('https://example.test/a\n\nhttps://example.test/a', native, false, [1, 3])
  },
)

test.each([false, true])(
  'copy text stays rendered Markdown and partial rich fragments reject inherited maps %j',
  async (native) => {
    const container = await rendered('`one\ntwo`', native, false)
    try {
      const code = container.querySelector('code')!
      const paragraph = code.parentNode!
      installRange(paragraph, 0, code.firstChild!, 7)
      expect(chatMarkdownClipboardPayload(document.getSelection()!)?.text).toBe('`one two`')
      installRange(code.firstChild!, 4, paragraph, 1)
      const mapped = chatMarkdownClipboardPayload(document.getSelection()!)!
      expect(mapped.text).toBe('`two`')
      const fragment = document.createElement('div')
      fragment.innerHTML = mapped.html
      const copied = fragment.querySelector('code')!
      expect(
        decodeCodeLines(copied.dataset.sourceCodeLines!, copied.textContent!.length),
      ).toBeNull()
      delete code.dataset.sourceCodeLines
      expect(chatMarkdownClipboardPayload(document.getSelection()!)?.text).toBe(mapped.text)
    } finally {
      document.getSelection()?.removeAllRanges()
      container.remove()
    }
  },
)

function checkSelectedLink(
  container: HTMLElement,
  link: Element,
  source: string,
  line: number,
  quote?: string,
): void {
  installRange(link, 0, link, link.childNodes.length)
  expect(planSelectionLines(container)).toEqual({ start: line, end: line })
  if (quote)
    expect(planCommentQuote(source, planSelectionLines(container)!)).toBe(
      `About the proposed plan, line ${line}:\n\n${quote}`,
    )
}

test.each([false, true])(
  'intersects code maps across split text and element endpoints %j',
  async (native) => {
    const container = await rendered('`one\ntwo`', native, false)
    try {
      const code = container.querySelector('code')!
      const span = document.createElement('span')
      span.textContent = 'tw'
      code.replaceChildren(document.createTextNode('one '), span, document.createTextNode('o'))
      installRange(span, 0, code, 3)
      expect(document.getSelection()!.toString()).toBe('two')
      expect(planSelectionLines(container)).toEqual({ start: 2, end: 2 })
    } finally {
      document.getSelection()?.removeAllRanges()
      container.remove()
    }
  },
)

type HastTree = ReturnType<typeof blockToHast>

function hastElements(node: HastNode, name: string): Extract<HastNode, { type: 'element' }>[] {
  const own = node.type === 'element' && node.tagName === name ? [node] : []
  return 'children' in node
    ? own.concat(node.children.flatMap((child) => hastElements(child, name)))
    : own
}

function inspectCodeSelection(source: string, tree: HastTree, index = 0) {
  const container = document.createElement('div')
  append(container, tree)
  document.body.appendChild(container)
  try {
    const code = container.querySelectorAll('code')[index]!
    installRange(code, 0, code, code.childNodes.length)
    const lines = planSelectionLines(container)
    return {
      selected: document.getSelection()!.toString(),
      lines,
      quote: lines && planCommentQuote(source, lines),
    }
  } finally {
    document.getSelection()?.removeAllRanges()
    container.remove()
  }
}

const authorityCases = [false, true].flatMap((native) =>
  [false, true].flatMap((withRaw) =>
    ['repositioned', 'appended'].map((kind) => ({ native, withRaw, kind })),
  ),
)

function injectUnknownCode(tree: HastTree, kind: string): void {
  const paragraph = hastElements(tree, 'p')[0]!
  if (kind === 'appended') {
    paragraph.children.push({
      type: 'element',
      tagName: 'code',
      position: paragraph.position,
      properties: { dataSourceCodeLines: '[11,0,11,99,99]' },
      children: [{ type: 'text', value: 'replacement' }],
    })
    return
  }
  const code = hastElements(tree, 'code')[0]!
  code.position = paragraph.position
  code.children = [{ type: 'text', value: 'replacement' }]
}

test.each(authorityCases)(
  'unknown positioned code has no quote authority $native $withRaw $kind',
  async ({ native, withRaw, kind }) => {
    if (native) await initializeTreeSitterMarkdown()
    const raw = withRaw ? (await loadRawHastExtension()).default : null
    const source = 'prefix\n`one\ntwo` suffix'
    const session = native ? createTreeSitterMarkdownSession() : createMarkdownSession()
    const block = session.update(source, { heal: false })[0]!
    const math = () => (tree: HastTree) => injectUnknownCode(tree, kind)
    const tree = blockToHast(block, createHastProcessor({ raw, math }))
    expect(inspectCodeSelection(source, tree, kind === 'appended' ? 1 : 0)).toEqual({
      selected: 'replacement',
      lines: null,
      quote: null,
    })
    expect(hastElements(tree, 'code')[kind === 'appended' ? 1 : 0]?.properties.dataSourceLine).toBe(
      1,
    )
  },
)

test.each([false, true])(
  'retains genuine raw authority and rejects an identical foreign clone %j',
  async (native) => {
    if (native) await initializeTreeSitterMarkdown()
    const raw = (await loadRawHastExtension()).default
    const session = () => (native ? createTreeSitterMarkdownSession() : createMarkdownSession())
    const source = '<code>x</code>'
    let captured: HastTree | undefined
    const capture = () => (tree: HastTree) => {
      captured = structuredClone(tree)
    }
    const genuine = blockToHast(
      session().update(source, { heal: false })[0]!,
      createHastProcessor({ raw, math: capture }),
    )
    if (!captured) throw new TypeError('Expected sanitized raw tree')
    const saved = captured
    const clone = () => () => structuredClone(saved)
    const injectedSource = 'zzzzzzzzzzzzzz'
    const injected = blockToHast(
      session().update(injectedSource, { heal: false })[0]!,
      createHastProcessor({ raw, math: clone }),
    )
    expect(inspectCodeSelection(source, genuine)).toEqual({
      selected: 'x',
      lines: { start: 1, end: 1 },
      quote: 'About the proposed plan, line 1:\n\n> <code>x</code>',
    })
    expect(inspectCodeSelection(injectedSource, injected)).toEqual({
      selected: 'x',
      lines: null,
      quote: null,
    })
    expect(hastElements(injected, 'code')[0]?.properties.dataSourceLine).toBe(1)
    const unchangedClone = blockToHast(
      session().update(source, { heal: false })[0]!,
      createHastProcessor({ raw, math: clone }),
    )
    expect(inspectCodeSelection(source, unchangedClone)).toEqual(
      inspectCodeSelection(source, genuine),
    )
  },
)

test.each([false, true])(
  'preserves fenced, structural and direct HAST code selection %j',
  async (native) => {
    if (native) await initializeTreeSitterMarkdown()
    const session = native ? createTreeSitterMarkdownSession() : createMarkdownSession()
    const source = '```\nx\n```'
    const block = session.update(source, { heal: false })[0]!
    const processor = createHastProcessor({ raw: null, math: null })
    const expected = {
      selected: 'x\n',
      lines: { start: 1, end: 1 },
      quote: 'About the proposed plan, line 1:\n\n> ```',
    }
    expect(inspectCodeSelection(source, blockToHast(block, processor))).toEqual(expected)
    expect(inspectCodeSelection(source, blockToHast(structuredClone(block), processor))).toEqual(
      expected,
    )
    const direct: HastTree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: {},
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 2, offset: 1 },
          },
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    }
    expect(inspectCodeSelection('x', processor.runSync(direct))).toEqual({
      selected: 'x',
      lines: { start: 1, end: 1 },
      quote: 'About the proposed plan, line 1:\n\n> x',
    })
  },
)

const preCaptureCases = [false, true].flatMap((native) =>
  ['remark', 'raw preset'].map((route) => ({ native, route })),
)
const injectRemarkRaw = () => (tree: ReturnType<MarkdownParser['parse']>) => {
  const paragraph = tree.children[0]
  if (paragraph?.type !== 'paragraph') return
  paragraph.children = [{ type: 'html', value: '<code>x</code>', position: paragraph.position }]
}
const injectPreRawCode = () => (tree: HastTree) => {
  const paragraph = hastElements(tree, 'p')[0]!
  paragraph.children = [
    {
      type: 'element',
      tagName: 'code',
      properties: {},
      position: paragraph.position,
      children: [{ type: 'text', value: 'x' }],
    },
  ]
}

test.each(preCaptureCases)(
  'pre-capture synthetic code cannot quote authored plan text $native $route',
  async ({ native, route }) => {
    if (native) await initializeTreeSitterMarkdown()
    const genuine = (await loadRawHastExtension()).default
    const source = 'zzzzzzzzzzzzzz'
    const options = { remarkPlugins: route === 'remark' ? [injectRemarkRaw] : [] }
    const session = native
      ? createTreeSitterMarkdownSession(options)
      : createMarkdownSession(options)
    const raw = route === 'raw preset' ? { plugins: [injectPreRawCode, genuine] } : genuine
    const tree = blockToHast(
      session.update(source, { heal: false })[0]!,
      createHastProcessor({ raw, math: null }),
    )
    expect(inspectCodeSelection(source, tree)).toEqual({ selected: 'x', lines: null, quote: null })
    expect(hastElements(tree, 'code')[0]?.properties.dataSourceCodeLines).toBe('0')
    expect(hastElements(tree, 'code')[0]?.properties.dataSourceLine).toBe(1)
  },
)

const cloneRawInput = () => (tree: HastTree) => structuredClone(tree)
const injectInsideAuthoredRaw = () => (tree: HastTree) => {
  const raw = tree.children[0]!
  tree.children.unshift({
    type: 'element',
    tagName: 'code',
    properties: {},
    position: raw.position,
    children: [{ type: 'text', value: 'x' }],
  })
}

test.each([false, true])(
  'raw input clones retain source authority while preexisting code inside source bounds stays unknown %j',
  async (native) => {
    if (native) await initializeTreeSitterMarkdown()
    const genuine = (await loadRawHastExtension()).default
    const session = () => (native ? createTreeSitterMarkdownSession() : createMarkdownSession())
    const source = '<code>x</code>'
    const cloned = blockToHast(
      session().update(source, { heal: false })[0]!,
      createHastProcessor({ raw: { plugins: [cloneRawInput, genuine] }, math: null }),
    )
    expect(inspectCodeSelection(source, cloned)).toEqual({
      selected: 'x',
      lines: { start: 1, end: 1 },
      quote: 'About the proposed plan, line 1:\n\n> <code>x</code>',
    })
    const blockSource = '<div><code>x</code></div>'
    const injected = blockToHast(
      session().update(blockSource, { heal: false })[0]!,
      createHastProcessor({ raw: { plugins: [injectInsideAuthoredRaw, genuine] }, math: null }),
    )
    expect(inspectCodeSelection(blockSource, injected)).toEqual({
      selected: 'x',
      lines: null,
      quote: null,
    })
    expect(hastElements(injected, 'code')[0]?.properties.dataSourceCodeLines).toBe('0')
    expect(hastElements(injected, 'code')[0]?.properties.dataSourceLine).toBe(1)
  },
)
