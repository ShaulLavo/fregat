import type { WorkspaceSearchMatch } from '@workspace/contracts'

import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'
import { basename } from '@/lib/path-formatters'

type SearchEntryMatch = Pick<
  WorkspaceSearchMatch,
  'birthtimeMs' | 'mtimeMs' | 'path' | 'size' | 'targetType' | 'type'
>

export function searchMatchEntry(match: SearchEntryMatch): FsEntry {
  const mtimeMs = match.mtimeMs ?? 0
  const size = match.size ?? 0

  return {
    birthtimeMs: match.birthtimeMs ?? 0,
    mtimeMs,
    name: basename(match.path),
    path: filesystemPath(match.path),
    size,
    targetType: match.targetType,
    type: match.type,
    version: searchEntryVersion(mtimeMs, size),
  }
}

function searchEntryVersion(mtimeMs: number, size: number) {
  return `search:${mtimeMs}:${size}`
}
