import type { Nodes, RootContent } from 'mdast'

/** Blockquote markers and indentation in front of a line's own syntax. */
const LINE_PREFIX = /^(?:[ \t]*>)*[ \t]*/u
const HEADING_MARKS = /^#+[ \t]*$/u
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])[ \t]*$/u
const TRAILING_BACKTICKS = /`+$/u
const PIPE_ROW = /^(?:[ \t]*>)*[ \t]*\|/u
const PARTIAL_DELIMITER_ROW = /^(?:[ \t]*>)*[ \t]*\|[ \t:|-]*$/u
/** Blocks whose text is literal, so a `#` or a backtick in them is content. */
const LITERAL_BLOCKS = new Set(['code', 'html', 'math'])
const CONTAINER_BLOCKS = new Set(['blockquote', 'footnoteDefinition', 'list', 'listItem'])

/**
 * Cuts a trailing construct off the live tail while it cannot render right yet:
 * a line of only `#` marks, a bare list marker, an unmatched trailing backtick
 * run, and a `|` row whose separator row has not arrived. `nodes` is the tail
 * parsed as it stands.
 */
export function holdAmbiguousTail(source: string, nodes: readonly RootContent[]): string {
  const block = lastBlock(nodes)
  if (!block || LITERAL_BLOCKS.has(block.type)) return source

  const lineHeld = source.slice(0, lineHoldStart(source, block))

  return lineHeld.slice(0, tableHoldStart(lineHeld, block.type === 'table'))
}

/** Where a held `#` line, list marker or backtick run on the last line starts. */
function lineHoldStart(source: string, block: Nodes): number {
  const lineStart = source.lastIndexOf('\n') + 1
  const line = source.slice(lineStart)
  const body = line.replace(LINE_PREFIX, '')
  if (HEADING_MARKS.test(body) || LIST_MARKER.test(body)) return lineStart

  const backticks = TRAILING_BACKTICKS.exec(line)
  if (!backticks || lastLeaf(block).type === 'inlineCode') return source.length

  return lineStart + backticks.index
}

/**
 * Where a held table header starts: a `|` row at the end, or one followed only
 * by a delimiter row that has not parsed as a table yet.
 */
function tableHoldStart(source: string, endsInTable: boolean): number {
  const lines = source.split('\n')
  const last = lines.length - 1
  const lastLine = lines[last] ?? ''
  const header = lastLine.trim() === '' ? last - 1 : last
  if (isHeaderCandidate(lines, header)) return lineOffset(lines, header)
  if (endsInTable || !PARTIAL_DELIMITER_ROW.test(lastLine)) return source.length
  if (!isHeaderCandidate(lines, last - 1)) return source.length

  return lineOffset(lines, last - 1)
}

/** A `|` row that could open a table: the row above it is not one. */
function isHeaderCandidate(lines: readonly string[], index: number): boolean {
  if (index < 0) return false
  if (!PIPE_ROW.test(lines[index] ?? '')) return false

  return !PIPE_ROW.test(lines[index - 1] ?? '')
}

function lineOffset(lines: readonly string[], index: number): number {
  let offset = 0
  for (const line of lines.slice(0, index)) offset += line.length + 1

  return offset
}

function lastBlock(nodes: readonly RootContent[]): Nodes | null {
  let node: Nodes | undefined = nodes.at(-1)
  while (node && CONTAINER_BLOCKS.has(node.type) && 'children' in node) {
    const child: Nodes | undefined = node.children.at(-1)
    if (!child) return node
    node = child
  }

  return node ?? null
}

function lastLeaf(node: Nodes): Nodes {
  let leaf = node
  while ('children' in leaf) {
    const child: Nodes | undefined = leaf.children.at(-1)
    if (!child) return leaf
    leaf = child
  }

  return leaf
}
