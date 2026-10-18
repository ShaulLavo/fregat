import { use, type ComponentProps } from 'react'
import { MarkdownPictureContext } from '@/features/workbench/providers/markdown-picture-context'
import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import { markdownPreviewImageSource } from '@/lib/markdown-mode/utils/paths'

import { fsBlobCrossOrigin } from '@/lib/fs-blob-image'

/** An image in rendered markdown, at most as wide as the pane. */
export function MarkdownPreviewImage({
  alt = '',
  node: _node,
  src,
  ...props
}: ComponentProps<'img'> & { readonly node?: unknown }) {
  const preview = use(MarkdownPreviewContext)
  // A `<source>` the browser takes loads through this image's request mode, so it decides.
  const pictureSource = use(MarkdownPictureContext)
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
      crossOrigin={requestMode(pictureSource, source)}
      loading='lazy'
      src={source}
    />
  )
}

function requestMode(pictureSource: boolean | null, source: string | undefined) {
  if (pictureSource !== null) return pictureSource ? 'anonymous' : undefined
  return source ? fsBlobCrossOrigin(source) : undefined
}
