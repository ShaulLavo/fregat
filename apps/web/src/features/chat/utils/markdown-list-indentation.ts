/**
 * CommonMark turns four or more spaces after a list marker into an indented
 * code block. Agents align bullets by hand (`-       text`), so that rule paints
 * a full code card over ordinary prose. Blocks that keep excess indentation and
 * start on the marker's own line are re-parsed as markdown; explicit fences and
 * conventional indented blocks stay code.
 */

type MarkdownPosition = {
  readonly start?: {
    readonly line?: number
    readonly offset?: number
  }
}

type MarkdownAstNode = {
  readonly type: string
  readonly value?: unknown
  readonly position?: MarkdownPosition
  children?: MarkdownAstNode[]
}

type MarkdownFile = {
  readonly value?: unknown
}

type MarkdownParser = {
  parse(markdown: string): unknown
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
    for (const block of recovered.blocks) {
      visitMarkdownNode(block, recovered.source, parser)
    }

    return recovered.blocks
  })
}

function isSameLineOverIndentedCode(
  node: MarkdownAstNode,
  parent: MarkdownAstNode | undefined,
  markdown: string,
) {
  if (node.type !== 'code') return false
  if (parent?.type !== 'listItem') return false
  if (typeof node.value !== 'string') return false
  if (!/^[\t ]/u.test(node.value)) return false

  const start = node.position?.start
  const parentStart = parent.position?.start
  if (start?.line === undefined || start.offset === undefined) return false
  if (start.line !== parentStart?.line) return false

  const character = markdown[start.offset]

  return character !== '`' && character !== '~'
}

function blocksFromIndentedCode(node: MarkdownAstNode, parser: MarkdownParser): RecoveredMarkdown {
  const value = typeof node.value === 'string' ? node.value.trim() : ''
  const recovered = parseRecoveredMarkdown(value, parser)
  const first = recovered.blocks[0]
  if (!first || !node.position) return recovered

  const blocks: MarkdownAstNode[] = [{ ...first, position: node.position }]
  return {
    ...recovered,
    blocks: blocks.concat(recovered.blocks.slice(1)),
  }
}

function parseRecoveredMarkdown(value: string, parser: MarkdownParser): RecoveredMarkdown {
  // A text prefix forces block-looking input into a paragraph. Later root
  // children stay blocks so blank-line-separated content is never discarded.
  const source = `${INLINE_PARSE_PREFIX}${value}`
  const document = parser.parse(source) as MarkdownAstNode
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
