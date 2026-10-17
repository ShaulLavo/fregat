import type { ListItem, PhrasingContent, Root, TableCell, TableRow } from 'mdast'
import {
  init,
  MarkdownDocument,
  type SemanticBlock,
  type SemanticInline,
  type SemanticListItem,
  type SemanticTableCell,
  type SemanticTableRow,
} from 'tree-sitter-md'
import { unified, type Plugin, type PluggableList } from 'unified'
import { Parser } from 'web-tree-sitter'

import { remarkCjkAutolinkBoundaries } from './cjk-autolinks'
import { remarkCodeMeta } from './code-meta'
import { createMarkdownSession, type MarkdownSessionOptions } from './session'

export type TreeSitterMarkdownOptions = {
  readonly gfm?: boolean
  readonly cjk?: boolean
  readonly math?: boolean
}
export type TreeSitterMarkdownInitOptions = NonNullable<Parameters<typeof init>[0]> & {
  readonly parser?: Parameters<typeof Parser.init>[0]
}

type Range = SemanticBlock['range']
type SourcePositions = { readonly lines: readonly number[] }
type MdastBlock = ListItem['children'][number]

export async function initializeTreeSitterMarkdown(options: TreeSitterMarkdownInitOptions = {}) {
  await Parser.init(options.parser)
  await init({ grammar: options.grammar, resolver: options.resolver })
}

/** Each parse owns its native handle, including parses from speculative React renders. */
export function parseTreeSitterMarkdown(
  source: string,
  options: TreeSitterMarkdownOptions = {},
): Root {
  const document = new MarkdownDocument({
    ...options,
    gfm: options.gfm ?? true,
    frontmatter: false,
  })
  try {
    document.setText(source)
    const snapshot = document.semantics()
    const positions = sourcePositions(source)
    return {
      type: 'root',
      position: nodePosition(snapshot.root.range, positions),
      children: snapshot.root.children.map((node) => blockToMdast(node, positions)),
    }
  } finally {
    document.dispose()
  }
}

export function createTreeSitterMarkdownSession(options: MarkdownSessionOptions = {}) {
  return createMarkdownSession({ processor: createTreeSitterProcessor(options.remarkPlugins) })
}

function createTreeSitterProcessor(remarkPlugins: PluggableList = []) {
  const parser: Plugin<[], string, Root> = function () {
    this.parser = (source) => parseTreeSitterMarkdown(source, { cjk: true, math: true })
  }
  return unified()
    .use(parser)
    .use(remarkCjkAutolinkBoundaries)
    .use(remarkCodeMeta)
    .use(remarkPlugins)
}

function blockToMdast(node: SemanticBlock, positions: SourcePositions): MdastBlock {
  const position = nodePosition(node.range, positions)
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', position, children: inlinesToMdast(node.children, positions) }
    case 'heading':
      return {
        type: 'heading',
        position,
        depth: node.depth,
        children: inlinesToMdast(node.children, positions),
      }
    case 'quote':
      return {
        type: 'blockquote',
        position,
        children: node.children.map((child) => blockToMdast(child, positions)),
      }
    case 'list':
      return {
        type: 'list',
        position,
        ordered: node.ordered,
        start: node.start,
        spread: node.spread,
        children: node.items.map((item) => itemToMdast(item, positions)),
      }
    case 'code':
      return { type: 'code', position, value: node.value, lang: node.language, meta: node.meta }
    case 'html':
      return { type: 'html', position, value: node.value }
    case 'math':
      return {
        type: 'math',
        position,
        value: node.value,
        meta: null,
        data: {
          hName: 'pre',
          hChildren: [
            {
              type: 'element',
              tagName: 'code',
              properties: { className: ['language-math', 'math-display'] },
              children: [{ type: 'text', value: node.value }],
            },
          ],
        },
      }
    case 'thematicBreak':
      return { type: 'thematicBreak', position }
    case 'table':
      return {
        type: 'table',
        position,
        align: node.align.slice(),
        children: node.rows.map((row) => rowToMdast(row, positions)),
      }
    case 'definition':
      return {
        type: 'definition',
        position,
        identifier: node.identifier,
        url: node.url,
        title: node.title,
      }
    case 'footnoteDefinition':
      return {
        type: 'footnoteDefinition',
        position,
        identifier: node.identifier,
        children: node.children.map((child) => blockToMdast(child, positions)),
      }
    default: {
      const exhaustive: never = node
      return exhaustive
    }
  }
}

function inlinesToMdast(nodes: readonly SemanticInline[], positions: SourcePositions) {
  return nodes.map((node) => inlineToMdast(node, positions))
}

function inlineToMdast(node: SemanticInline, positions: SourcePositions): PhrasingContent {
  const position = nodePosition(node.range, positions)
  switch (node.type) {
    case 'text':
    case 'html':
      return { type: node.type, position, value: node.value }
    case 'code':
      return { type: 'inlineCode', position, value: node.value }
    case 'math':
      return {
        type: 'inlineMath',
        position,
        value: node.value,
        data: {
          hName: 'code',
          hProperties: { className: ['language-math', 'math-inline'] },
          hChildren: [{ type: 'text', value: node.value }],
        },
      }
    case 'emphasis':
    case 'strong':
    case 'delete':
      return { type: node.type, position, children: inlinesToMdast(node.children, positions) }
    case 'break':
      return node.hard ? { type: 'break', position } : { type: 'text', position, value: '\n' }
    case 'link':
      return {
        type: 'link',
        position,
        url: node.url,
        title: node.title,
        children: inlinesToMdast(node.children, positions),
      }
    case 'image':
      return { type: 'image', position, url: node.url, title: node.title, alt: node.alt }
    case 'footnoteReference':
      return { type: 'footnoteReference', position, identifier: node.identifier }
    default: {
      const exhaustive: never = node
      return exhaustive
    }
  }
}

function itemToMdast(node: SemanticListItem, positions: SourcePositions): ListItem {
  return {
    type: 'listItem',
    position: nodePosition(node.range, positions),
    spread: node.spread,
    checked: node.checked,
    children: node.children.map((child) => blockToMdast(child, positions)),
  }
}

function rowToMdast(node: SemanticTableRow, positions: SourcePositions): TableRow {
  return {
    type: 'tableRow',
    position: nodePosition(node.range, positions),
    children: node.cells.map((cell) => cellToMdast(cell, positions)),
  }
}

function cellToMdast(node: SemanticTableCell, positions: SourcePositions): TableCell {
  return {
    type: 'tableCell',
    position: node.range === null ? undefined : nodePosition(node.range, positions),
    children: inlinesToMdast(node.children, positions),
  }
}

function sourcePositions(source: string): SourcePositions {
  const lines = [0]
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character !== '\r' && character !== '\n') continue
    if (character === '\r' && source[index + 1] === '\n') index += 1
    lines.push(index + 1)
  }
  return { lines }
}

function nodePosition(range: Range, positions: SourcePositions) {
  return { start: sourcePoint(range.start, positions), end: sourcePoint(range.end, positions) }
}

function sourcePoint(offset: number, { lines }: SourcePositions) {
  let low = 0
  let high = lines.length
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if ((lines[middle] ?? 0) <= offset) low = middle
    else high = middle
  }
  return { offset, line: low + 1, column: offset - (lines[low] ?? 0) + 1 }
}
