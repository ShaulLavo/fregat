import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'

// Display labels fall back to 'Root'; pathLeaf below preserves an empty leaf.
export function basename(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? 'Root'
}

// The root clamp keeps filesystem event invalidation inside the watched directory.
export function parentPath(path: string, rootPath = '') {
  if (path === rootPath) return rootPath
  const index = path.lastIndexOf('/')
  return index < 0 ? rootPath : path.slice(0, index)
}

export function parentFilesystemPath(path: FilesystemPath, rootPath?: FilesystemPath) {
  return filesystemPath(parentPath(path, rootPath))
}

export function displayPath(path: string) {
  if (!path) return '/'

  return `/${path}`
}

export function formatSize(size: number) {
  if (size === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 3)
  const value = size / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function toTreePath(path: string, rootPath: string) {
  if (path === rootPath) return basename(path)
  if (!rootPath) return path
  if (!path.startsWith(`${rootPath}/`)) return path

  return path.slice(rootPath.length + 1)
}

export function canonicalTreePath(path: string) {
  return path.replace(/\/+$/u, '')
}

// An empty filter matches every path; this is not a filesystem containment check.
export function matchesWorkspaceRoot(path: string, rootPath: string) {
  if (!rootPath) return true
  if (path === rootPath) return true

  return path.startsWith(`${rootPath}/`)
}

export function pathLeaf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}
