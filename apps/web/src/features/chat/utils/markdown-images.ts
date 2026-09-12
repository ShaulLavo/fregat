import { isPathInWorkspace } from '@workspace/client-core/files/path'
import { resolveMarkdownLinkFileReference } from '@/features/chat/utils/markdown-file-links'

export function markdownImageSource(source: string, rootPath: string | null, origin: string) {
  if (/^(?:https?:\/\/|blob:|data:image\/(?:png|jpeg|gif|webp);)/iu.test(source)) return source
  if (source.startsWith('//')) return source
  if (/^file:\/\/[^/]/iu.test(source) && !/^file:\/\/localhost\//iu.test(source)) return null
  if (rootPath === null || source.includes('\0')) return null

  const reference = resolveMarkdownLinkFileReference(source, rootPath)
  if (!reference || !isPathInWorkspace(reference.path, rootPath)) return null

  return `${origin.replace(/\/+$/u, '')}/fs/blob?${new URLSearchParams({ path: reference.path })}`
}

type ImageNode = { type?: string; url?: string; children?: ImageNode[] }

export function remarkWorkspaceImages(rootPath: string | null, origin: string) {
  return () => (tree: ImageNode) => rewriteImages(tree, rootPath, origin)
}

function rewriteImages(node: ImageNode, rootPath: string | null, origin: string) {
  if (node.type === 'image' && node.url)
    node.url = markdownImageSource(node.url, rootPath, origin) ?? ''
  for (const child of node.children ?? []) rewriteImages(child, rootPath, origin)
}
