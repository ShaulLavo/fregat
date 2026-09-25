// Query keys used by one feature live in that feature; this module holds shared groups.
export const fileSystemKeys = {
  all: ['file-system'] as const,
  fileMetadata: (path: string) => [...fileSystemKeys.all, 'file-metadata', path] as const,
  fileSnapshots: () => [...fileSystemKeys.all, 'file-snapshots'] as const,
  fileSnapshot: (path: string) => [...fileSystemKeys.fileSnapshots(), path] as const,
  fileOperationHistory: (rootPath: string) =>
    [...fileSystemKeys.all, 'file-operation-history', rootPath] as const,
  quickOpenFiles: (rootPath: string, query: string) =>
    [...fileSystemKeys.fileSnapshots(), 'quick-open', rootPath, query] as const,
  trees: () => [...fileSystemKeys.all, 'trees'] as const,
  tree: (rootPath: string) => [...fileSystemKeys.trees(), rootPath] as const,
  treeDirectory: (rootPath: string, treePath: string, path: string) =>
    [...fileSystemKeys.tree(rootPath), 'directory', treePath, path] as const,
}

export const appearanceKeys = {
  all: ['appearance'] as const,
  font: (ref: string) => [...appearanceKeys.all, 'font', ref] as const,
}

export const filePickerKeys = {
  all: ['file-picker'] as const,
  serverInfo: () => [...filePickerKeys.all, 'server-info'] as const,
  directories: () => [...filePickerKeys.all, 'directories'] as const,
  directory: (path: string, query: string, mode: 'file' | 'folder', showHidden: boolean) =>
    [...filePickerKeys.directories(), { mode, path, query, showHidden }] as const,
  recents: () => [...filePickerKeys.all, 'recents'] as const,
  recentList: (mode: 'file' | 'folder', showHidden: boolean) =>
    [...filePickerKeys.recents(), 'list', { mode, showHidden }] as const,
}

export const gitKeys = {
  all: ['git'] as const,
  branches: (path: string) => [...gitKeys.all, 'branches', path] as const,
  branchRemoteState: (path: string) => [...gitKeys.all, 'branch-remote-state', path] as const,
  pullRequestState: (path: string) => [...gitKeys.all, 'pull-request-state', path] as const,
  blobDiff: (query: {
    newObjectId?: string
    oldObjectId?: string
    oldPath?: string
    path: string
  }) => [...gitKeys.diffs(), 'blob', query] as const,
  diffs: () => [...gitKeys.all, 'diffs'] as const,
  checkpointDiff: (query: {
    filePath?: string
    fromTurnCount: number
    ignoreWhitespace?: boolean
    path?: string
    scope?: 'file' | 'session' | 'turn'
    sessionId: string
    toTurnCount: number
  }) => [...gitKeys.diffs(), 'checkpoint', query] as const,
  diff: (path: string, staged: boolean) => [...gitKeys.diffs(), path, staged] as const,
  file: (path: string, ref: string) => [...gitKeys.all, 'file', path, ref] as const,
  statuses: () => [...gitKeys.all, 'statuses'] as const,
  status: (path: string) => [...gitKeys.statuses(), path] as const,
}

export const documentSymbolKeys = {
  all: ['document-symbols'] as const,
  document: (rootPath: string, path: string, contentRevision: string) =>
    [...documentSymbolKeys.all, rootPath, path, contentRevision] as const,
}

export const providerQueryKeys = {
  all: ['providers'] as const,
  list: () => [...providerQueryKeys.all, 'list'] as const,
}
