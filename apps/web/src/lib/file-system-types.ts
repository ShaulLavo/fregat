import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type {
  FileResult as WireFileResult,
  FileSystemEntryMetadata,
  WorkspacePersistenceOperation,
  WorkspaceEditPrepareRequest as WirePrepareRequest,
} from '@workspace/contracts'

import {
  effectiveEntryType,
  type FileTreeEntry,
  type WorkspaceAddress,
  type WorkspaceSearchMatch,
} from '@workspace/contracts'

export { effectiveEntryType, isDirectoryEntry, isFileEntry } from '@workspace/contracts'

export type FileResult = Omit<WireFileResult, 'path'> & { readonly path: FilesystemPath }
export type StatResult = Omit<FileSystemEntryMetadata, 'path' | 'canonicalPath'> & {
  path: FilesystemPath
  canonicalPath?: FilesystemPath
}
export type TreeEntry = StatResult & { name: string; children?: TreeEntry[] }
export type TreeResult = { path: FilesystemPath; entries: TreeEntry[] }

type TypedPersistenceOperation<T> = T extends { readonly kind: 'rename' }
  ? Omit<T, 'oldPath' | 'newPath'> & {
      readonly oldPath: FilesystemPath
      readonly newPath: FilesystemPath
    }
  : Omit<T, 'path'> & { readonly path: FilesystemPath }
export type WorkspaceEditPrepareRequest = Omit<WirePrepareRequest, 'workspace' | 'operations'> & {
  readonly workspace: FilesystemPath
  readonly operations: readonly TypedPersistenceOperation<WorkspacePersistenceOperation>[]
}

export function fileResultFromResponse(value: WireFileResult): FileResult {
  return { ...value, path: filesystemPath(value.path) }
}

export function metadataFromResponse<T extends FileSystemEntryMetadata>(value: T) {
  return {
    ...value,
    path: filesystemPath(value.path),
    canonicalPath:
      value.canonicalPath === undefined ? undefined : filesystemPath(value.canonicalPath),
  }
}

export function entryFromResponse(value: FileTreeEntry): TreeEntry {
  return {
    ...value,
    path: filesystemPath(value.path),
    canonicalPath:
      value.canonicalPath === undefined ? undefined : filesystemPath(value.canonicalPath),
    children: value.children?.map(entryFromResponse),
  }
}

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

export type FsEntry = TreeEntry & {
  searchScope?: SearchScope
}

export type FindMatch = Omit<WorkspaceSearchMatch, 'path'> & {
  path: FilesystemPath
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
