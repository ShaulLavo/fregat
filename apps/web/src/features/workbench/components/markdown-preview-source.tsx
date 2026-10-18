import { use, type ComponentProps } from 'react'
import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import { markdownPreviewImageSource } from '@/lib/markdown-mode/utils/paths'

const COLOR_SCHEME_QUERY = /^\s*\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)\s*$/iu

/**
 * A `<picture>` source in rendered markdown: its images load from the workspace like `<img>`,
 * and a light or dark variant follows the app's colour mode, the one the reader sees.
 */
export function MarkdownPreviewSource({
  media,
  node: _node,
  srcSet,
  ...props
}: ComponentProps<'source'> & { readonly node?: unknown }) {
  const preview = use(MarkdownPreviewContext)
  if (!preview) return <source {...props} media={media} srcSet={srcSet} />
  const scheme = media ? COLOR_SCHEME_QUERY.exec(media)?.[1]?.toLowerCase() : undefined
  return (
    <source
      {...props}
      media={scheme ? (scheme === preview.colorMode ? 'all' : 'not all') : media}
      srcSet={srcSet ? previewSourceSet(srcSet, preview) : undefined}
    />
  )
}

// Each candidate is a URL and an optional width or density descriptor.
function previewSourceSet(
  srcSet: string,
  preview: { readonly documentPath: string; readonly rootPath: string; readonly origin: string },
) {
  return srcSet
    .split(',')
    .map((candidate) => {
      const [url = '', ...descriptor] = candidate.trim().split(/\s+/u)
      const source = markdownPreviewImageSource(
        url,
        preview.documentPath,
        preview.rootPath,
        preview.origin,
      )
      return source ? [source].concat(descriptor).join(' ') : null
    })
    .filter((candidate) => candidate !== null)
    .join(', ')
}
