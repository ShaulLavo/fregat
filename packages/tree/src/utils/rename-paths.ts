// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.

export type RenamePathsResult =
  | {
      nextFiles: string[]
      sourcePath: string
      destinationPath: string
      isFolder: boolean
    }
  | { error: string }

type RenamePathsParams = {
  files: string[]
  path: string
  isFolder: boolean
  nextBasename: string
}

function splitPath(path: string): { parentPath: string; baseName: string } {
  const separatorIndex = path.lastIndexOf('/')
  if (separatorIndex < 0) {
    return { parentPath: '', baseName: path }
  }
  return {
    parentPath: path.slice(0, separatorIndex),
    baseName: path.slice(separatorIndex + 1),
  }
}

function joinPath(parentPath: string, baseName: string): string {
  return parentPath === '' ? baseName : `${parentPath}/${baseName}`
}

/**
 * Computes a renamed file list using same-parent basename rename semantics.
 */
export function renamePaths({
  files,
  path: sourcePath,
  isFolder,
  nextBasename,
}: RenamePathsParams): RenamePathsResult {
  const trimmedBasename = nextBasename.trim()
  if (trimmedBasename.length === 0) {
    return { error: 'Name cannot be empty.' }
  }
  if (trimmedBasename.includes('/')) {
    return { error: 'Name cannot include "/".' }
  }

  const { parentPath, baseName } = splitPath(sourcePath)
  if (trimmedBasename === baseName) {
    return {
      nextFiles: files,
      sourcePath,
      destinationPath: sourcePath,
      isFolder,
    }
  }

  const destinationPath = joinPath(parentPath, trimmedBasename)
  const nextFiles = Array<string>(files.length)
  const seenPaths = new Set<string>()

  if (!isFolder) {
    const destinationPrefix = `${destinationPath}/`
    let renamed = false
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      if (file !== sourcePath && file.startsWith(destinationPrefix)) {
        return { error: `"${destinationPath}" already exists.` }
      }
      const nextFile = file === sourcePath ? destinationPath : file
      if (seenPaths.has(nextFile)) {
        return { error: `"${destinationPath}" already exists.` }
      }
      seenPaths.add(nextFile)
      nextFiles[index] = nextFile
      if (file === sourcePath) {
        renamed = true
      }
    }
    if (!renamed) {
      return { error: 'Could not find the selected file to rename.' }
    }
    return {
      nextFiles,
      sourcePath,
      destinationPath,
      isFolder,
    }
  }

  const sourcePrefix = `${sourcePath}/`
  const destinationPrefix = `${destinationPath}/`
  let renamedPathCount = 0

  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    const isWithinRenamedFolder = file === sourcePath || file.startsWith(sourcePrefix)
    if (
      !isWithinRenamedFolder &&
      (file === destinationPath || file.startsWith(destinationPrefix))
    ) {
      return { error: `"${destinationPath}" already exists.` }
    }

    const nextFile = isWithinRenamedFolder
      ? `${destinationPath}${file.slice(sourcePath.length)}`
      : file
    if (seenPaths.has(nextFile)) {
      return { error: `"${destinationPath}" already exists.` }
    }

    seenPaths.add(nextFile)
    nextFiles[index] = nextFile
    if (isWithinRenamedFolder) {
      renamedPathCount++
    }
  }

  if (renamedPathCount === 0) {
    return { error: 'Could not find the selected folder to rename.' }
  }
  return {
    nextFiles,
    sourcePath,
    destinationPath,
    isFolder,
  }
}
