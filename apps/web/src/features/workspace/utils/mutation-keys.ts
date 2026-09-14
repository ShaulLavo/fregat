export const workspaceMutationKeys = {
  openRoot: (path: string) => ['workspace', 'open-root', path] as const,
  resolveConflict: (conflictId: string) => ['workspace', 'conflict', conflictId] as const,
  tree: (kind: string, rootPath: string) => ['workspace', 'tree', kind, rootPath] as const,
}

export function workspaceConflictScope(conflictId: string) {
  return `workspace.conflict:${conflictId}`
}
