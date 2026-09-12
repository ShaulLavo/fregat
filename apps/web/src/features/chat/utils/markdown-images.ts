import { markdownWorkspaceFilePath } from '@/features/chat/utils/markdown-workspace-path'
import { resolveMarkdownLinkFileReference } from '@/features/chat/utils/markdown-file-links'

export function markdownImageSource(
  source: string,
  rootPath: string | null,
  origin: string,
  workspacePath: string | null,
) {
  if (/^(?:https?:\/\/|blob:|data:image\/(?:png|jpeg|gif|webp);)/iu.test(source)) return source
  if (source.startsWith('//')) return source
  if (/^file:\/\/[^/]/iu.test(source) && !/^file:\/\/localhost\//iu.test(source)) return null
  if (rootPath === null || source.includes('\0')) return null

  const reference = resolveMarkdownLinkFileReference(source, rootPath)
  if (!reference) return null
  const path = markdownWorkspaceFilePath(reference.path, rootPath, workspacePath)
  if (path === null) return null

  return `${origin.replace(/\/+$/u, '')}/fs/blob?${new URLSearchParams({ path })}`
}

type ImageNode = { type?: string; url?: string; children?: ImageNode[] }

export function remarkWorkspaceImages({
  rootPath,
  origin,
  workspacePath,
}: {
  rootPath: string | null
  origin: string
  workspacePath: string | null
}) {
  return (tree: ImageNode) => rewriteImages(tree, rootPath, origin, workspacePath)
}

function rewriteImages(
  node: ImageNode,
  rootPath: string | null,
  origin: string,
  workspacePath: string | null,
) {
  if (node.type === 'image' && node.url)
    node.url = markdownImageSource(node.url, rootPath, origin, workspacePath) ?? ''
  for (const child of node.children ?? []) rewriteImages(child, rootPath, origin, workspacePath)
}
