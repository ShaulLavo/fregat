export const workspaceMutationKeys = {
  openRoot: (path: string) => ['workspace', 'open-root', path] as const,
  recordRecent: (path: string) => ['workspace', 'record-recent', path] as const,
  resolveConflict: (conflictId: string) => ['workspace', 'conflict', conflictId] as const,
  tree: (kind: string, rootPath: string) => ['workspace', 'tree', kind, rootPath] as const,
  fileHistory: (direction: 'redo' | 'undo', rootPath: string) =>
    ['workspace', 'file-history', direction, rootPath] as const,
  fileOperation: (rootPath: string) => ['workspace', 'file-operation', rootPath] as const,
}

/** One root's file operations, undos and redos run one at a time, each seeing the last one's result. */
export function fileHistoryScope(rootPath: string) {
  return `workspace.file-history:${rootPath}`
}

export function workspaceConflictScope(conflictId: string) {
  return `workspace.conflict:${conflictId}`
}
