import { cn } from '@workspace/ui/lib/utils'
import { use, type ComponentProps, type ReactNode } from 'react'

import { resolveInlineCodeFileReference } from '@/features/chat/utils/markdown-file-links'
import { MarkdownFileLinkContext } from '@/features/chat/providers/markdown-file-link-context'
import { AssistantMarkdownFileLink } from './assistant-markdown-file-link'

type AssistantMarkdownInlineCodeProps = ComponentProps<'code'> & { node?: unknown }

/**
 * `src/foo.ts:42` in prose is the most common way an agent points at code, so
 * inline spans that resolve to a real path become editor links.
 */
export function AssistantMarkdownInlineCode({
  children,
  className,
  node,
  ...props
}: AssistantMarkdownInlineCodeProps) {
  void node

  const actions = use(MarkdownFileLinkContext)
  const text = plainText(children)
  const reference = resolveInlineCodeFileReference(text, actions?.rootPath ?? null)
  if (reference) {
    return (
      <AssistantMarkdownFileLink
        copyMarkdown={`\`${text}\``}
        label={reference.label}
        reference={reference}
      />
    )
  }

  return (
    <code
      className={cn('bg-muted rounded-md px-1.5 py-0.5 font-mono text-sm', className)}
      data-markdown='inline-code'
      {...props}
    >
      {children}
    </code>
  )
}

function plainText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!Array.isArray(node)) return ''

  return node.map((child) => plainText(child as ReactNode)).join('')
}
