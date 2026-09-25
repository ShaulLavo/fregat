import type { ComponentProps, ElementType } from 'react'

type SourceNode = {
  readonly tagName: string
  readonly position?: { readonly start: { readonly line: number } }
}

/** A rendered block that remembers the source line it starts on, for scroll sync. */
export function MarkdownPreviewBlock({
  node,
  ...props
}: ComponentProps<'div'> & { readonly node?: SourceNode }) {
  const Tag = (node?.tagName ?? 'div') as ElementType
  return <Tag {...props} data-source-line={node?.position?.start.line} />
}
