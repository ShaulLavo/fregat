import { markdownPreviewImageSource } from '@/features/workbench/utils/markdown-preview-paths'

type ImageNode = {
  type?: string
  url?: string
  identifier?: string
  title?: string | null
  children?: ImageNode[]
}

/** Points workspace images in a rendered markdown file at the server, relative to the file. */
export function remarkPreviewImages(options: {
  readonly documentPath: string
  readonly origin: string
  readonly rootPath: string
}) {
  return (tree: ImageNode) => {
    const definitions = new Map<string, ImageNode>()
    collectDefinitions(tree, definitions)
    rewriteImages(tree, options, definitions)
  }
}

function rewriteImages(
  node: ImageNode,
  options: { readonly documentPath: string; readonly origin: string; readonly rootPath: string },
  definitions: ReadonlyMap<string, ImageNode>,
) {
  if (node.type === 'imageReference' && node.identifier) {
    const definition = definitions.get(node.identifier.toUpperCase())
    if (definition?.url)
      Object.assign(node, { type: 'image', url: definition.url, title: definition.title })
  }
  if (node.type === 'image' && node.url)
    node.url = markdownPreviewImageSource(
      node.url,
      options.documentPath,
      options.rootPath,
      options.origin,
    )
  for (const child of node.children ?? []) rewriteImages(child, options, definitions)
}

function collectDefinitions(node: ImageNode, definitions: Map<string, ImageNode>) {
  if (node.type === 'definition' && node.identifier)
    definitions.set(node.identifier.toUpperCase(), node)
  for (const child of node.children ?? []) collectDefinitions(child, definitions)
}
