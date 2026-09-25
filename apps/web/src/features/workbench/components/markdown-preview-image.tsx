import { use, type ComponentProps } from 'react'
import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import { markdownPreviewImageSource } from '@/features/workbench/utils/markdown-preview-paths'

import { fsBlobCrossOrigin } from '@/lib/fs-blob-image'

/** An image in rendered markdown, at most as wide as the pane. */
export function MarkdownPreviewImage({
  alt = '',
  node: _node,
  src,
  ...props
}: ComponentProps<'img'> & { readonly node?: unknown }) {
  const preview = use(MarkdownPreviewContext)
  let source = typeof src === 'string' ? src : undefined
  if (source && preview)
    source = markdownPreviewImageSource(
      source,
      preview.documentPath,
      preview.rootPath,
      preview.origin,
    )
  return (
    <img
      {...props}
      alt={alt}
      className='max-w-full'
      crossOrigin={source ? fsBlobCrossOrigin(source) : undefined}
      loading='lazy'
      src={source}
    />
  )
}
