import { normalizeWorkspaceRoot } from '@workspace/client-core/files/path'

import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { workspaceRelativePath } from '@/lib/workspace-relative-path'
import type { WorkspaceEditRoot } from '@/features/editor/state/workspace-edit-service'

export function workspaceEditRelativePath(
  rootPath: FilesystemPath,
  path: FilesystemPath,
): FilesystemPath | null {
  const root = normalizeWorkspaceNamespacePath(rootPath)
  const target = normalizeWorkspaceNamespacePath(path)
  if (root === '/') {
    if (!target.startsWith('/')) return null
    return filesystemPath(target === '/' ? '.' : target.slice(1))
  }
  if (!root) {
    if (target.startsWith('/')) return null
    return filesystemPath(target || '.')
  }
  if (target === root) return filesystemPath('.')
  const relative = workspaceRelativePath(target, root)
  return relative === null ? null : filesystemPath(relative)
}

export function workspaceDocumentPath(
  rootPath: FilesystemPath,
  relativePath: string,
): FilesystemPath | null {
  if (!relativePath || relativePath.startsWith('/')) return null
  const root = normalizeWorkspaceNamespacePath(rootPath)
  if (relativePath === '.') return root
  if (relativePath.split('/').some((segment) => segment === '.' || segment === '..')) return null
  if (root === '/') return filesystemPath(`/${relativePath}`)
  if (!root) return filesystemPath(relativePath)
  return filesystemPath(`${root}/${relativePath}`)
}

function normalizeWorkspaceNamespacePath(path: FilesystemPath): FilesystemPath {
  if (path === '/') return path
  return filesystemPath(normalizeWorkspaceRoot(path))
}

export function workspaceEditUriPath(root: WorkspaceEditRoot): FilesystemPath {
  return root.uriPath ?? root.path
}

export function workspaceEditRequestPath(root: WorkspaceEditRoot): FilesystemPath {
  return root.workspacePath ?? root.path
}
