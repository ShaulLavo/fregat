import { markdownPreviewImageSource } from '@/features/workbench/utils/markdown-preview-paths'

type ImageNode = { type?: string; url?: string; children?: ImageNode[] }

/** Points workspace images in a rendered markdown file at the server, relative to the file. */
export function remarkPreviewImages(options: {
  readonly documentPath: string
  readonly origin: string
  readonly rootPath: string
}) {
  return (tree: ImageNode) => rewriteImages(tree, options)
}

function rewriteImages(
  node: ImageNode,
  options: { readonly documentPath: string; readonly origin: string; readonly rootPath: string },
) {
  if (node.type === 'image' && node.url)
    node.url = markdownPreviewImageSource(
      node.url,
      options.documentPath,
      options.rootPath,
      options.origin,
    )
  for (const child of node.children ?? []) rewriteImages(child, options)
}
