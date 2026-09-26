export type WorkspaceIndexReadiness = 'cold' | 'building' | 'ready' | 'stale' | 'failed' | 'off'

export type WorkspaceIndexStatus = {
  entryCount: number
  errorMessage?: string
  fileCount: number
  lastFullScanAtMs?: number
  lastFullScanDurationMs?: number
  lastIncrementalUpdateAtMs?: number
  pendingCreatedPathCount: number
  readiness: WorkspaceIndexReadiness
  rebuildReason?: string
  scanRoot: string | null
  scanWarningCount: number
  skippedEntryCount: number
  staleEntryCount: number
}

/** One index per open root; `holderCount` is the open project streams keeping it warm. */
export type WorkspaceIndexScopeStatus = WorkspaceIndexStatus & {
  holderCount: number
}

/** Shape of `FsService.info()`; the server types its return against this. */
export type ServerInfo = {
  workspaceRoot: string
  systemRoot: string
  homePath: string
  defaultPath: string
  metadataDbPath: string
  maxTextFileBytes: number
  workspaceIndexes: WorkspaceIndexScopeStatus[]
  nativeWatcherCount: number
  openFileWatcherCount: number
  shallowWatcherCount: number
  watchedDirectoryCount: number
  watchDirectoryLimit: number
  watchEnabled: boolean
}
