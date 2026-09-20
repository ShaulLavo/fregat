export function workspaceRelativePath(path: string, rootPath: string | null) {
  if (rootPath === null) return null

  const root = rootPath.replace(/\/+$/u, '')
  if (root.length === 0) return path.startsWith('/') ? null : path
  if (!path.startsWith(`${root}/`)) return null

  return path.slice(root.length + 1)
}
