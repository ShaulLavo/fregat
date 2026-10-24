import { sourcePoint } from '@workspace/markdown/utils/positions'

import { createClientInvariantError } from '@/lib/structured-errors'

/**
 * CommonMark turns four or more spaces after a list marker into an indented
 * code block. Agents align bullets by hand (`-       text`), so that rule paints
 * a full code card over ordinary prose. Blocks that keep excess indentation and
 * start on the marker's own line are re-parsed as markdown; explicit fences and
 * conventional indented blocks stay code.
 */

type MarkdownPoint = NonNullable<Parameters<typeof sourcePoint>[2]>
type MarkdownPosition = { start: MarkdownPoint; end: MarkdownPoint }

type MarkdownAstNode = {
  readonly type: string
  readonly value?: unknown
  position?: MarkdownPosition
  children?: MarkdownAstNode[]
}

type PositionedCode = MarkdownAstNode & {
  readonly value: string
  position: {
    start: ReturnType<typeof sourcePoint>
    end: ReturnType<typeof sourcePoint>
  }
}

type MarkdownFile = {
  readonly value?: unknown
}

type MarkdownParser = {
  parse(markdown: string): MarkdownAstNode
}

type RecoveredMarkdown = {
  readonly blocks: MarkdownAstNode[]
  readonly source: string
}

const INLINE_PARSE_PREFIX = 'platform-markdown-inline-prefix:'

/**
 * Stack-neutral by design: the plugin re-parses through the processor it is
 * attached to (`this`), so whatever inline extensions the pipeline configured
 * (GFM, math, CJK) apply to the recovered content too.
 */
export function remarkNormalizeListItemIndentation(this: MarkdownParser) {
  // Arrow body on purpose: it keeps the attached processor as `this` without
  // aliasing it into a local.
  return (tree: MarkdownAstNode, file: MarkdownFile) => {
    if (typeof file.value !== 'string') return

    visitMarkdownNode(tree, file.value, this)
  }
}

function visitMarkdownNode(node: MarkdownAstNode, source: string, parser: MarkdownParser) {
  if (!node.children) return

  node.children = node.children.flatMap((child) => {
    if (!isSameLineOverIndentedCode(child, node, source)) {
      visitMarkdownNode(child, source, parser)
      return [child]
    }

    const recovered = blocksFromIndentedCode(child, parser)
    for (const block of recovered.blocks) visitMarkdownNode(block, recovered.source, parser)
    const lines = recoveredSourceLines(child, source, recovered.source)
    for (const block of recovered.blocks) projectRecoveredPositions(block, source, lines)
    return recovered.blocks
  })
}

function isSameLineOverIndentedCode(
  node: MarkdownAstNode,
  parent: MarkdownAstNode | undefined,
  markdown: string,
): node is PositionedCode {
  if (node.type !== 'code') return false
  if (parent?.type !== 'listItem') return false
  if (typeof node.value !== 'string') return false
  if (!/^[\t ]/u.test(node.value)) return false

  const start = node.position?.start
  const parentStart = parent.position?.start
  if (start?.line === undefined || start.offset === undefined) return false
  if (start.line !== parentStart?.line) return false
  if (node.position?.end.offset === undefined) return false

  const character = markdown[start.offset]

  return character !== '`' && character !== '~'
}

function blocksFromIndentedCode(node: PositionedCode, parser: MarkdownParser): RecoveredMarkdown {
  return parseRecoveredMarkdown(node.value.trim(), parser)
}

type RecoveredLine = { readonly start: number; readonly end: number; readonly content: number }

function recoveredSourceLines(
  node: PositionedCode,
  source: string,
  recovered: string,
): readonly RecoveredLine[] {
  const start = node.position.start.offset
  const end = node.position.end.offset
  const authored = source.slice(start, end).matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)
  const values = recovered.slice(INLINE_PARSE_PREFIX.length).split(/\r\n|\r|\n/u)
  return values.map((value) => {
    const line = authored.next().value
    if (!line) throw createClientInvariantError('Recovered list prose has no authored line')
    const text = line[1]!
    const offset = start + line.index
    const content = text.lastIndexOf(value.trimStart())
    if (content < 0)
      throw createClientInvariantError('Recovered list prose differs from its source')
    return {
      start: offset,
      end: offset + text.length,
      content: offset + content - (value.length - value.trimStart().length),
    }
  })
}

function projectRecoveredPoint(
  point: MarkdownPoint,
  source: string,
  lines: readonly RecoveredLine[],
): MarkdownPoint {
  const line = lines[point.line - 1]
  if (!line) throw createClientInvariantError('Recovered list position has no authored line')
  const prefix = point.line === 1 ? INLINE_PARSE_PREFIX.length : 0
  const column = Math.max(0, point.column - 1 - prefix)
  return sourcePoint(source, Math.max(line.start, Math.min(line.end, line.content + column)))
}

function projectRecoveredPositions(
  node: MarkdownAstNode,
  source: string,
  lines: readonly RecoveredLine[],
): void {
  if (node.position) {
    node.position = {
      start: projectRecoveredPoint(node.position.start, source, lines),
      end: projectRecoveredPoint(node.position.end, source, lines),
    }
  }
  for (const child of node.children ?? []) projectRecoveredPositions(child, source, lines)
}

function parseRecoveredMarkdown(value: string, parser: MarkdownParser): RecoveredMarkdown {
  // A text prefix forces block-looking input into a paragraph. Later root
  // children stay blocks so blank-line-separated content is never discarded.
  const source = `${INLINE_PARSE_PREFIX}${value}`
  const document = parser.parse(source)
  const blocks = document.children
  const paragraph = blocks?.[0]
  const children = paragraph?.type === 'paragraph' ? paragraph.children : undefined
  const first = children?.[0]
  if (!blocks || !children) return { blocks: [{ type: 'text', value }], source }
  if (first?.type !== 'text') return { blocks: [{ type: 'text', value }], source }
  if (typeof first.value !== 'string') return { blocks: [{ type: 'text', value }], source }
  if (!first.value.startsWith(INLINE_PARSE_PREFIX)) {
    return { blocks: [{ type: 'text', value }], source }
  }

  const firstValue = first.value.slice(INLINE_PARSE_PREFIX.length)
  const leading: MarkdownAstNode[] = firstValue ? [{ ...first, value: firstValue }] : []
  const recoveredBlocks: MarkdownAstNode[] = [
    { ...paragraph, children: leading.concat(children.slice(1)), type: 'paragraph' },
  ]

  return {
    blocks: recoveredBlocks.concat(blocks.slice(1)),
    source,
  }
}
