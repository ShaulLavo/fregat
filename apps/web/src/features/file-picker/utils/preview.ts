import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry, isFileEntry } from '@/lib/file-system-types'
import { isImageName } from '@/lib/file-preview/utils/preview'

/** A folder previews this many of its children, from the listing already cached. */
export const PREVIEW_CHILDREN = 100

export type PreviewKind = 'image' | 'text' | 'folder' | 'none'

export function previewKind(entry: FsEntry): PreviewKind {
  if (isDirectoryEntry(entry)) return 'folder'
  if (!isFileEntry(entry)) return 'none'
  return isImageName(entry.name) ? 'image' : 'text'
}
