import {
  normalizeWorkspaceRoot,
  toWorkspaceAbsolute,
  toWorkspaceRelative,
} from '@workspace/client-core/files/path'

export function markdownWorkspaceFilePath(
  filePath: string,
  canonicalRoot: string | null,
  workspacePath: string | null,
) {
  if (canonicalRoot === null || workspacePath === null || workspacePath.startsWith('/')) return null
  const relative =
    canonicalRoot === '/' && filePath.startsWith('/')
      ? filePath.slice(1)
      : toWorkspaceRelative(canonicalRoot, filePath)
  if (relative === null) return null
  return toWorkspaceAbsolute(workspacePath, relative)
}

/**
 * A file anywhere under the server's root, as the fs routes address it. Null when the path
 * has no server-relative form, which the fs routes would refuse.
 */
export function markdownServerFilePath(
  filePath: string,
  canonicalRoot: string | null,
  workspacePath: string | null,
) {
  const inWorkspace = markdownWorkspaceFilePath(filePath, canonicalRoot, workspacePath)
  if (inWorkspace !== null || canonicalRoot === null || workspacePath === null) return inWorkspace
  // A relative root is the editor's, already in server form, and so is a path resolved against it.
  if (!canonicalRoot.startsWith('/')) return toWorkspaceAbsolute('', filePath)
  if (!filePath.startsWith('/')) return null
  const serverRoot = serverRootPath(canonicalRoot, workspacePath)
  if (serverRoot === null || !filePath.startsWith(`${serverRoot}/`)) return null
  return toWorkspaceAbsolute('', filePath.slice(serverRoot.length + 1))
}

/**
 * The workspace's server path is its canonical path relative to the server root, so the root is
 * what remains after removing it. `''` is `/`; null when a symlink makes the two disagree.
 */
function serverRootPath(canonicalRoot: string, workspacePath: string) {
  const root = normalizeWorkspaceRoot(canonicalRoot)
  const workspace = normalizeWorkspaceRoot(workspacePath).replace(/^\.$/u, '')
  if (workspace.startsWith('/')) return null
  if (workspace === '') return root
  if (!root.endsWith(`/${workspace}`)) return null
  return root.slice(0, root.length - workspace.length - 1)
}
