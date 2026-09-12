import { toWorkspaceAbsolute, toWorkspaceRelative } from '@workspace/client-core/files/path'

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
