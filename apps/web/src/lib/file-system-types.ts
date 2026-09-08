import {
  effectiveEntryType,
  type FileTreeEntry,
  type WorkspaceAddress,
  type WorkspaceSearchMatch,
} from '@workspace/contracts'

export {
  effectiveEntryType,
  isDirectoryEntry,
  isFileEntry,
  type FileResult,
  type FileSystemEntryMetadata as StatResult,
  type FileTreeEntry as TreeEntry,
  type FileTreeResult as TreeResult,
} from '@workspace/contracts'

export type SearchScope = 'current' | 'system'

type WorkspaceIndexStatus = {
  entryCount: number
  errorMessage?: string
  fileCount: number
  lastFullScanAtMs?: number
  lastFullScanDurationMs?: number
  lastIncrementalUpdateAtMs?: number
  pendingCreatedPathCount: number
  readiness: 'cold' | 'building' | 'ready' | 'stale' | 'failed'
  rebuildReason?: string
  scanRoot: string | null
  scanWarningCount: number
  skippedEntryCount: number
  staleEntryCount: number
}

export type FsEntry = FileTreeEntry & {
  searchScope?: SearchScope
}

export type FindMatch = WorkspaceSearchMatch & {
  searchScope?: SearchScope
}

export type RecentResult = {
  entries: FsEntry[]
}

export type ServerInfo = {
  ok: boolean
  workspaceRoot: string
  workspaceIndex?: WorkspaceIndexStatus
  defaultPath: string
  homePath: string
}

export type PickedFsEntry = FsEntry & { workspaceAddress?: WorkspaceAddress } & (
    | {
        type: 'file' | 'directory'
      }
    | {
        type: 'symlink'
        targetType: 'file' | 'directory'
      }
  )

export function isPickedFsEntry(entry: FsEntry): entry is PickedFsEntry {
  const type = effectiveEntryType(entry)
  return type === 'file' || type === 'directory'
}
