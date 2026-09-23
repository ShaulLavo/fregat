import { filesystemPath } from '@/lib/documents/utils/identity'
import type { TreeEntry } from '@/lib/file-system-types'
import { isFileEntry } from '@/lib/file-system-types'
import type { FileOpenIntent } from '@/lib/file-open-intent/state/service'
import { canonicalTreePath } from '@/lib/path-formatters'
import { fileSystemKeys } from '@/lib/query-keys'

export const FILE_TREE_PREFETCH_MAX_BYTES = 1_048_576
export const FILE_TREE_PREFETCH_STALE_MS = 5_000

export function canPrefetchFileEntry(entry: TreeEntry) {
  return isFileEntry(entry) && entry.size <= FILE_TREE_PREFETCH_MAX_BYTES
}

export function treeDirectoryPrefetchKey(rootPath: string, treePath: string, entry: TreeEntry) {
  return fileSystemKeys.treeDirectory(rootPath, canonicalTreePath(treePath), entry.path)
}

export function fileTreeFileOpenIntent(rootPath: string, entry: TreeEntry): FileOpenIntent | null {
  if (!canPrefetchFileEntry(entry)) return null

  return {
    knownSize: entry.size,
    path: entry.path,
    rootPath: filesystemPath(rootPath),
    source: 'file-tree',
  }
}
