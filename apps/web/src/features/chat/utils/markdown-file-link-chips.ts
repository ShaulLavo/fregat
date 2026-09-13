import {
  resolveMarkdownLinkFileReference,
  workspaceRelativePath,
  type MarkdownFileReference,
} from '@/features/chat/utils/markdown-file-links'

type MarkdownAstNode = {
  readonly type: string
  url?: unknown
  value?: unknown
  children?: MarkdownAstNode[]
}

/**
 * `[foo](src/foo.ts)` is rewritten to the inline-code form of the same
 * reference so both syntaxes render through one chip. It happens in remark so
 * the destination is still the author's text, before sanitization touches it.
 */
export function remarkFileLinkChips({ rootPath }: { rootPath: string | null }) {
  return (tree: MarkdownAstNode) => {
    rewriteFileLinks(tree, rootPath)
  }
}

function rewriteFileLinks(node: MarkdownAstNode, rootPath: string | null) {
  if (!node.children) return

  node.children = node.children.map((child) => {
    if (child.type !== 'link') {
      rewriteFileLinks(child, rootPath)
      return child
    }

    const reference =
      typeof child.url === 'string' ? resolveMarkdownLinkFileReference(child.url, rootPath) : null
    if (!reference) {
      rewriteFileLinks(child, rootPath)
      return child
    }

    return { type: 'inlineCode', value: fileReferenceCodeText(reference, rootPath) }
  })
}

/**
 * Kept in the shape the inline-code resolver accepts, so the chip is built from
 * one resolution path rather than two: `./` marks a workspace-relative path.
 */
function fileReferenceCodeText(reference: MarkdownFileReference, rootPath: string | null) {
  const relative = workspaceRelativePath(reference.path, rootPath)
  const base = relative === null ? reference.path : `./${relative}`
  if (reference.line === null) return base
  if (reference.column === null) return `${base}:${reference.line}`

  return `${base}:${reference.line}:${reference.column}`
}
