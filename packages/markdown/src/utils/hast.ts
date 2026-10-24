import type { Element, Nodes as HastNode, Root as HastRoot } from 'hast'
import type { Break, InlineCode, Root as MdastRoot } from 'mdast'
import { toHast, type State } from 'mdast-util-to-hast'
import rehypeSanitize from 'rehype-sanitize'
import { unified, type Pluggable, type Plugin, type Processor } from 'unified'

import { blockRenderInput, blockCodeSources, type MarkdownBlock } from './blocks'
import { cloneTree, projectHast } from './positions'
import {
  createCodeProduction,
  retainProducedCode,
  prepareRawCodeAuthority,
  retainRawCodeAuthority,
  type CodeProduction,
  publishInlineCodeLines,
  type CodeOccurrences,
} from './inline-code-source'
import type { TrackedText } from './repair-origin'
import { rehypeDecorate } from './decorate'
import { MARKDOWN_SANITIZE_SCHEMA } from './sanitize-schema'

/**
 * The two stages that cost real bytes, each present only once its library has
 * loaded. Raw HTML needs an HTML parser; math needs KaTeX. Until then raw HTML
 * is dropped by the sanitizer and math stays a code block.
 */
export type HastExtensions = {
  readonly math: Pluggable | null
  readonly raw: Pluggable | null
}

export type HastProcessor = Processor<undefined, HastRoot, HastRoot, undefined, undefined>

export function createHastProcessor(extensions: HastExtensions): HastProcessor {
  const processor = unified().use(rehypeRetainPrepared)
  if (extensions.raw) processor.use([extensions.raw])
  processor.use(rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA)
  if (extensions.math) processor.use([extensions.math])
  processor.use(rehypeProjectPrepared)
  processor.use(rehypeDecorate)

  return processor as unknown as HastProcessor
}

/** mdast → hast for one block. Sanitization is not a caller choice. */
export function blockToHast(block: MarkdownBlock, processor: HastProcessor): HastRoot {
  const input = blockRenderInput(block)
  const root: MdastRoot = { type: 'root', children: Array.from(input.nodes) }
  const codes: CodeOccurrences = new Map()
  const sources = blockCodeSources(block)
  const production = sources ? createCodeProduction(sources) : null
  const capture = (state: State, node: MdastRoot) =>
    producedRoot(state, node, production, input, codes)
  // Ids leave this stage bare: the sanitizer prefixes raw HTML and footnotes alike, once.
  const prepared = toHast(root, {
    allowDangerousHtml: true,
    clobberPrefix: '',
    handlers: { root: capture, break: hardBreak, inlineCode: codeLiteral },
  }) as HastRoot
  const tree =
    input.kind === 'prepared'
      ? renderPrepared(prepared, processor, input.input, codes, production)
      : processor.runSync(prepared)
  // The hast root separates blocks with newline text nodes, which a
  // `whitespace-pre-wrap` consumer would paint as blank lines.
  tree.children = tree.children.filter(
    (child) => !(child.type === 'text' && child.value.trim().length === 0),
  )
  // Set after sanitization so raw HTML in the document cannot forge it.
  if (block.openFence) markLastFenceIncomplete(tree)

  return tree
}

function producedRoot(
  state: State,
  node: MdastRoot,
  production: CodeProduction | null,
  input: ReturnType<typeof blockRenderInput>,
  codes: CodeOccurrences,
) {
  const patch = state.patch
  state.patch = (from, to) => {
    patch(from, to)
    if (production && input.kind === 'prepared')
      retainProducedCode(from, to, production, input.input, codes)
  }
  return state.wrap(state.all(node))
}

function codeLiteral(state: State, node: InlineCode): Element {
  const text = { type: 'text' as const, value: node.value.replace(/\r?\n|\r/g, ' ') }
  state.patch(node, text)
  const element: Element = { type: 'element', tagName: 'code', properties: {}, children: [text] }
  state.patch(node, element)
  return state.applyData(node, element)
}

// A formatting newline after <br> adds another line under whitespace-pre-wrap.
function hardBreak(state: State, node: Break): Element {
  const element: Element = { type: 'element', tagName: 'br', properties: {}, children: [] }
  state.patch(node, element)
  return state.applyData(node, element)
}

function markLastFenceIncomplete(tree: HastRoot) {
  const code = lastFencedCode(tree)
  if (code) code.properties.dataIncomplete = 'true'
}

function lastFencedCode(node: HastRoot | Element): Element | null {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]
    if (child?.type !== 'element') continue
    if (child.tagName === 'pre') return child.children.find(isCode) ?? null

    const found = lastFencedCode(child)
    if (found) return found
  }

  return null
}

function isCode(node: Element['children'][number]): node is Element {
  return node.type === 'element' && node.tagName === 'code'
}

type RenderInput = {
  readonly input: TrackedText
  readonly codes: CodeOccurrences
  readonly production: CodeProduction | null
  file: object | null
}

const pendingRenderInputs = new WeakMap<HastRoot, RenderInput>()
type RawClose = { readonly opener: HastNode; readonly owner: Element }
type RawCellClose = { readonly cell: Element; readonly row: Element; readonly opener: HastNode }
type RawCloseIndex<T> = ReadonlyMap<number, T | null>
const renderInputs = new WeakMap<object, TrackedText>()
const renderCodes = new WeakMap<object, CodeOccurrences>()
const renderProduction = new WeakMap<object, CodeProduction>()

export async function loadRawHastExtension(): Promise<{ readonly default: Plugin<[], HastRoot> }> {
  const { default: rehypeRaw } = await import('rehype-raw')
  const transform = rehypeRaw()
  const plugin: Plugin<[], HastRoot> = () => transformPreparedRaw
  return { default: plugin }

  function transformPreparedRaw(tree: HastRoot, file: Parameters<typeof transform>[1]): HastRoot {
    const input = renderInputs.get(file)
    if (!input) return transform(tree, file)
    const closes = rawCloses(tree, input)
    const cells = rawCellCloses(tree, input)
    const production = renderProduction.get(file)
    const authority = production ? prepareRawCodeAuthority(tree, production) : null
    const result = transform(tree, file)
    const codes = renderCodes.get(file)
    if (authority && codes) retainRawCodeAuthority(result, authority, codes)
    restoreRawCloses(result, closes, cells)
    return result
  }
}

function renderPrepared(
  tree: HastRoot,
  processor: HastProcessor,
  input: TrackedText,
  codes: CodeOccurrences,
  production: CodeProduction | null,
): HastRoot {
  const ownership: RenderInput = { input, codes, production, file: null }
  pendingRenderInputs.set(tree, ownership)
  try {
    return processor.runSync(tree)
  } finally {
    pendingRenderInputs.delete(tree)
    if (ownership.file) {
      renderInputs.delete(ownership.file)
      renderCodes.delete(ownership.file)
      renderProduction.delete(ownership.file)
    }
  }
}

function rehypeRetainPrepared() {
  return (tree: HastRoot, file: object) => {
    const ownership = pendingRenderInputs.get(tree)
    if (!ownership) return
    pendingRenderInputs.delete(tree)
    ownership.file = file
    renderInputs.set(file, ownership.input)
    renderCodes.set(file, ownership.codes)
    if (ownership.production) renderProduction.set(file, ownership.production)
  }
}

function rehypeProjectPrepared() {
  return (tree: HastRoot, file: object) => {
    const prepared = renderInputs.get(file)
    if (!prepared) return
    renderInputs.delete(file)
    const codes = renderCodes.get(file)
    renderCodes.delete(file)
    renderProduction.delete(file)
    if (codes) publishInlineCodeLines(tree, codes)
    projectHast(tree, prepared)
  }
}

function walkHast(node: HastNode, visit: (node: HastNode) => void): void {
  visit(node)
  if (!('children' in node)) return
  for (const child of node.children) walkHast(child, visit)
}

function positionedStarts(tree: HastRoot, type: 'element' | 'raw'): Map<number, number> {
  const counts = new Map<number, number>()
  walkHast(tree, (node) => {
    const offset = node.position?.start.offset
    if (node.type !== type || offset === undefined) return
    counts.set(offset, (counts.get(offset) ?? 0) + 1)
  })
  return counts
}

function rawCloses(tree: HastRoot, input: TrackedText): RawCloseIndex<RawClose> {
  const owners = positionedStarts(tree, 'element')
  const openers = positionedStarts(tree, 'raw')
  const closes = new Map<number, RawClose | null>()
  walkHast(tree, (owner) => {
    if (owner.type !== 'element' || !owner.position) return
    const opener = owner.children.at(-1)
    if (opener?.type !== 'raw' || !opener.position) return
    if (!uniqueStart(owner, owners)) return
    if (!uniqueStart(opener, openers)) return
    if (!containedOpener(owner, opener, input)) return
    indexRawClose(closes, opener.position.start.offset!, {
      opener: cloneTree(opener),
      owner: cloneTree({ ...owner, children: [] }),
    })
  })
  return closes
}

function containedOpener(owner: Element, opener: HastNode, input: TrackedText): boolean {
  if (opener.type !== 'raw' || !opener.position || !owner.position) return false
  const start = opener.position.start.offset
  const end = opener.position.end.offset
  const from = owner.position.start.offset
  const to = owner.position.end.offset
  if (start === undefined || end === undefined || from === undefined || to === undefined)
    return false
  if (start <= from || end > to || end <= start) return false
  return input.text.slice(start - input.window.start, end - input.window.start) === opener.value
}

function samePoint(
  left: NonNullable<HastNode['position']>['start'],
  right: NonNullable<HastNode['position']>['start'],
): boolean {
  return left.offset === right.offset && left.line === right.line && left.column === right.column
}

function sameOwner(node: Element, owner: Element): boolean {
  if (!node.position || !owner.position || node.tagName !== owner.tagName) return false
  return (
    samePoint(node.position.start, owner.position.start) &&
    samePoint(node.position.end, owner.position.end)
  )
}

function restoreRawClose(node: Element, owner: Element, closes: RawCloseIndex<RawClose>): void {
  const position = node.position
  if (!position || position.start.offset === undefined || position.end.offset === undefined) return
  if (position.end.offset >= position.start.offset || node.children.length !== 0) return
  const close = closes.get(position.start.offset)
  if (!close || !matchesRawClose(node, owner, close)) return
  const end = close.owner.position?.end
  if (end) position.end = { ...end }
}

function matchesRawClose(node: Element, owner: Element, close: RawClose): boolean {
  if (!node.position || !close.opener.position || !close.owner.position) return false
  if (close.opener.type !== 'raw' || close.opener.value !== `<${node.tagName}>`) return false
  return (
    sameOwner(owner, close.owner) &&
    samePoint(node.position.start, close.opener.position.start) &&
    samePoint(node.position.end, close.owner.position.start)
  )
}

function restoreRawCloses(
  tree: HastRoot,
  closes: RawCloseIndex<RawClose>,
  cells: RawCloseIndex<RawCellClose>,
): void {
  restoreRawCells(tree, cells)
  if (!closes.size) return
  const starts = positionedStarts(tree, 'element')
  walkHast(tree, (owner) => restoreOwnedRawCloses(owner, closes, starts))
}

function indexRawClose<T>(index: Map<number, T | null>, start: number, close: T): void {
  index.set(start, index.has(start) ? null : close)
}

function restoreOwnedRawCloses(
  owner: HastNode,
  closes: RawCloseIndex<RawClose>,
  starts: ReadonlyMap<number, number>,
): void {
  if (owner.type !== 'element' || !uniqueStart(owner, starts)) return
  for (const node of owner.children) {
    if (node.type !== 'element' || !uniqueStart(node, starts)) continue
    restoreRawClose(node, owner, closes)
  }
}

function rawCellCloses(tree: HastRoot, input: TrackedText): RawCloseIndex<RawCellClose> {
  const cells = new Map<number, RawCellClose | null>()
  const starts = positionedStarts(tree, 'element')
  const openers = positionedStarts(tree, 'raw')
  walkHast(tree, (row) => {
    if (row.type !== 'element' || row.tagName !== 'tr' || !row.position) return
    const cell = row.children.filter((node) => node.type === 'element').at(-1)
    if (!cell || cell.tagName !== 'td' || !cell.position) return
    if (!onlyUnpositionedText(row.children.slice(row.children.indexOf(cell) + 1))) return
    if (!uniqueStart(cell, starts)) return
    if (!samePoint(cell.position.end, row.position.end)) return
    const opener = terminalTextarea(cell, input)
    if (!opener || !uniqueStart(opener, openers)) return
    indexRawClose(
      cells,
      cell.position.start.offset!,
      cloneTree({ cell, row: { ...row, children: [] }, opener }),
    )
  })
  return cells
}

function terminalTextarea(cell: Element, input: TrackedText): HastNode | undefined {
  const index = cell.children.findIndex(
    (node) => node.type === 'raw' && node.value === '<textarea>',
  )
  const opener = cell.children[index]
  const raw: HastNode[] = []
  walkHast(cell, (node) => {
    if (node.type === 'raw') raw.push(node)
  })
  if (raw.length !== 1 || raw[0] !== opener) return
  if (!opener || index < 0 || !containedOpener(cell, opener, input)) return
  if (cell.children.slice(index + 1).some((node) => node.type !== 'text')) return
  return opener
}

function restoreRawCells(tree: HastRoot, cells: RawCloseIndex<RawCellClose>): void {
  if (!cells.size) return
  const starts = positionedStarts(tree, 'element')
  walkHast(tree, (row) => {
    if (row.type !== 'element' || row.tagName !== 'tr') return
    for (const cell of row.children) restoreRawCell(cell, row, cells, starts)
  })
}

function restoreRawCell(
  node: HastNode,
  row: Element,
  cells: RawCloseIndex<RawCellClose>,
  starts: ReadonlyMap<number, number>,
): void {
  if (node.type !== 'element' || node.tagName !== 'td' || !node.position) return
  const position = node.position
  if (position.start.offset === undefined || position.end.offset === undefined) return
  if (position.end.offset >= position.start.offset || starts.get(position.start.offset) !== 1)
    return
  const close = cells.get(position.start.offset)
  if (!close || !matchesRawCell(node, row, close)) return
  const end = close.cell.position?.end
  if (end) position.end = { ...end }
}

function matchesRawCell(cell: Element, row: Element, close: RawCellClose): boolean {
  if (!cell.position || !close.cell.position || !close.row.position || !close.opener.position)
    return false
  if (!sameOwner(row, close.row) || !samePoint(cell.position.start, close.cell.position.start))
    return false
  if (!samePoint(cell.position.end, close.row.position.start)) return false
  const textarea = cell.children.filter(
    (node) => node.type === 'element' && node.tagName === 'textarea',
  )
  return (
    textarea.length === 1 &&
    Boolean(
      textarea[0]?.position && samePoint(textarea[0].position.start, close.opener.position.start),
    )
  )
}

function onlyUnpositionedText(nodes: readonly HastNode[]): boolean {
  return nodes.every((node) => node.type === 'text' && !node.position && node.value.trim() === '')
}

function uniqueStart(node: HastNode, starts: ReadonlyMap<number, number>): boolean {
  const offset = node.position?.start.offset
  return offset !== undefined && starts.get(offset) === 1
}
