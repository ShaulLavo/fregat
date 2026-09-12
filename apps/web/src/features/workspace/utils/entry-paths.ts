import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { canonicalTreePath } from '@/lib/path-formatters'

/**
 * Structural so the tree model's `entriesByTreePath` map can be passed straight
 * in — no set has to be materialised per keystroke of a menu action.
 */
export type TreePathLookup = {
  has: (treePath: string) => boolean
  readonly size: number
}

/**
 * Tree paths are relative to the pane root; every `fs` route wants the path in
 * the server's own namespace. Both halves are canonicalised because directory
 * rows arrive from the tree with a trailing slash.
 */
export function workspacePathForTreePath(
  rootPath: FilesystemPath,
  treePath: string,
): FilesystemPath {
  const canonicalRootPath = canonicalTreePath(rootPath)
  const canonicalPath = canonicalTreePath(treePath)
  if (!canonicalRootPath) return filesystemPath(canonicalPath)
  if (!canonicalPath) return filesystemPath(canonicalRootPath)

  return filesystemPath(`${canonicalRootPath}/${canonicalPath}`)
}

/**
 * Where a new sibling of this row belongs. A directory row hosts new entries
 * inside itself; a file row hosts them next to itself. Returns `''` for the
 * pane root.
 */
export function containerTreePath(treePath: string, isDirectory: boolean) {
  const path = canonicalTreePath(treePath)
  if (isDirectory) return path

  const separatorIndex = path.lastIndexOf('/')
  if (separatorIndex < 0) return ''

  return path.slice(0, separatorIndex)
}

/**
 * The placeholder row an inline "New File" / "New Folder" edit starts from.
 * Folder paths keep their trailing slash — that is how the tree package tells
 * a directory path from a file path.
 */
export function newEntryTreePath({
  containerPath,
  existingPaths,
  isFolder,
}: {
  containerPath: string
  existingPaths: TreePathLookup
  isFolder: boolean
}) {
  const stem = isFolder ? 'new folder' : 'untitled'
  const path = uniqueTreePath({ containerPath, existingPaths, extension: '', stem })

  return isFolder ? `${path}/` : path
}

/** `src/a.ts` becomes `src/a copy.ts`, then `src/a copy 2.ts`, and so on. */
export function duplicateTreePath({
  existingPaths,
  isDirectory,
  treePath,
}: {
  existingPaths: TreePathLookup
  isDirectory: boolean
  treePath: string
}) {
  const path = canonicalTreePath(treePath)
  const containerPath = containerTreePath(path, false)
  const name = entryName(path)
  const split = isDirectory ? { extension: '', stem: name } : splitEntryName(name)

  return uniqueTreePath({
    containerPath,
    existingPaths,
    extension: split.extension,
    stem: `${split.stem} copy`,
  })
}

/**
 * A placeholder row can only survive once the directory that will hold it has
 * its children in the model. Start the inline edit before that and the
 * directory load that lands the real children re-syncs the tree underneath the
 * placeholder, taking the edit with it. The pane root is always loaded.
 */
export function containerContentsLoaded(
  loadedDirectoryPaths: ReadonlySet<string>,
  containerPath: string,
) {
  if (!containerPath) return true

  return loadedDirectoryPaths.has(canonicalTreePath(containerPath))
}

export function entryName(treePath: string) {
  const path = canonicalTreePath(treePath)
  const separatorIndex = path.lastIndexOf('/')
  if (separatorIndex < 0) return path

  return path.slice(separatorIndex + 1)
}

function splitEntryName(name: string) {
  const dotIndex = name.lastIndexOf('.')
  // A leading dot is the whole name of a dotfile, not an extension.
  if (dotIndex <= 0) return { extension: '', stem: name }

  return { extension: name.slice(dotIndex), stem: name.slice(0, dotIndex) }
}

/**
 * Walks `stem`, `stem 2`, `stem 3`, ... until one is free. `existingPaths.size`
 * candidates can each be taken at most once, so the loop always finds a free
 * name before it runs out.
 */
function uniqueTreePath({
  containerPath,
  existingPaths,
  extension,
  stem,
}: {
  containerPath: string
  existingPaths: TreePathLookup
  extension: string
  stem: string
}) {
  for (let attempt = 1; attempt <= existingPaths.size + 1; attempt += 1) {
    const name = attempt === 1 ? `${stem}${extension}` : `${stem} ${attempt}${extension}`
    const path = joinTreePath(containerPath, name)
    if (existingPaths.has(path)) continue

    return path
  }

  return joinTreePath(containerPath, `${stem} ${existingPaths.size + 2}${extension}`)
}

function joinTreePath(containerPath: string, name: string) {
  if (!containerPath) return name

  return `${containerPath}/${name}`
}
