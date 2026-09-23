import type { FilesystemPath } from '@/lib/documents/utils/types'
import { basename, parentPath } from '@/lib/path-formatters'

export type LabelledMove = { readonly from: FilesystemPath; readonly to: FilesystemPath }

/** "Rename a.ts to b.ts" when the folder stays, "Move a.ts into src" or "Move 3 items into src" when it changes. */
export function moveLabel(moves: readonly LabelledMove[], rootPath: FilesystemPath): string {
  const first = moves[0]
  if (!first) return 'Move'
  const destination = parentPath(first.to, rootPath)
  if (moves.length > 1) return `Move ${moves.length} items into ${basename(destination)}`
  if (parentPath(first.from, rootPath) === destination) {
    return `Rename ${basename(first.from)} to ${basename(first.to)}`
  }

  return `Move ${basename(first.from)} into ${basename(destination)}`
}

export function createLabel(path: FilesystemPath, folder: boolean): string {
  return `${folder ? 'New folder' : 'New file'} ${basename(path)}`
}

export function duplicateLabel(from: FilesystemPath): string {
  return `Duplicate ${basename(from)}`
}

export function deleteLabel(path: FilesystemPath): string {
  return `Delete ${basename(path)}`
}
