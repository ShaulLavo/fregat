import type { ComponentProps } from 'react'

import { fsBlobCrossOrigin } from '@/lib/fs-blob-image'

/** An image in rendered markdown, at most as wide as the pane. */
export function MarkdownPreviewImage({
  alt = '',
  node: _node,
  src,
  ...props
}: ComponentProps<'img'> & { readonly node?: unknown }) {
  const source = typeof src === 'string' ? src : undefined
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
