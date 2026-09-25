import { use, type ComponentProps } from 'react'

import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import { markdownPreviewTarget } from '@/features/workbench/utils/markdown-preview-paths'

/** A link in rendered markdown: another workspace file opens in the editor, anything else outside. */
export function MarkdownPreviewLink({
  children,
  href = '',
  node: _node,
  ...props
}: ComponentProps<'a'> & { readonly node?: unknown }) {
  const preview = use(MarkdownPreviewContext)
  const target =
    preview && href ? markdownPreviewTarget(href, preview.documentPath, preview.rootPath) : null
  if (target?.kind === 'unavailable') return <span>{children}</span>
  if (target?.kind === 'anchor' || !target)
    return (
      <a {...props} href={href}>
        {children}
      </a>
    )
  if (target.kind === 'external')
    return (
      <a {...props} href={href} rel='noreferrer noopener' target='_blank'>
        {children}
      </a>
    )

  return (
    <a
      {...props}
      href={href}
      title={target.path}
      onClick={(event) => {
        event.preventDefault()
        preview?.openFile(target.path)
      }}
    >
      {children}
    </a>
  )
}
