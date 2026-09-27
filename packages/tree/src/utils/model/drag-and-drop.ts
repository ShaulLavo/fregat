// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import { getAncestorDirectoryPaths, isCanonicalDirectoryPath } from './path-helpers'
import type {
  FileTreeBatchOperation,
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeDropTarget,
} from './public-types'

export interface FileTreeDragSession {
  draggedPaths: readonly string[]
  primaryPath: string
  target: FileTreeDropTarget | null
}

function getPathBasename(path: string): string {
  const trimmedPath = path.endsWith('/') ? path.slice(0, -1) : path
  const lastSlashIndex = trimmedPath.lastIndexOf('/')
  const basename = lastSlashIndex < 0 ? trimmedPath : trimmedPath.slice(lastSlashIndex + 1)
  return path.endsWith('/') ? `${basename}/` : basename
}

// Multi-select drags should move each subtree once, even when callers selected
// both a folder and descendants inside that same folder.
function normalizeDraggedPaths(paths: readonly string[]): readonly string[] {
  const uniquePaths: string[] = []
  const seenPaths = new Set<string>()
  for (const path of paths) {
    if (seenPaths.has(path)) {
      continue
    }
    seenPaths.add(path)
    uniquePaths.push(path)
  }

  const keptPaths = new Set<string>()
  for (const path of uniquePaths.toSorted((left, right) => {
    if (left.length !== right.length) {
      return left.length - right.length
    }

    return left.localeCompare(right)
  })) {
    if (getAncestorDirectoryPaths(path).some((ancestor) => keptPaths.has(ancestor))) {
      continue
    }

    keptPaths.add(path)
  }

  return uniquePaths.filter((path) => keptPaths.has(path))
}

export function resolveDraggedPathsForStart(
  path: string,
  selectedPaths: readonly string[],
): readonly string[] {
  return selectedPaths.includes(path) ? normalizeDraggedPaths(selectedPaths) : [path]
}

export function dropTargetsEqual(
  left: FileTreeDropTarget | null,
  right: FileTreeDropTarget | null,
): boolean {
  if (left === right) {
    return true
  }

  if (left == null || right == null) {
    return false
  }

  return (
    left.kind === right.kind &&
    left.directoryPath === right.directoryPath &&
    left.flattenedSegmentPath === right.flattenedSegmentPath &&
    left.hoveredPath === right.hoveredPath
  )
}

export function createDropContext(
  draggedPaths: readonly string[],
  target: FileTreeDropTarget,
): FileTreeDropContext {
  return {
    draggedPaths,
    target,
  }
}

export function isSelfOrDescendantDrop(
  draggedPaths: readonly string[],
  target: FileTreeDropTarget,
): boolean {
  if (target.kind !== 'directory' || target.directoryPath == null) {
    return false
  }

  for (const draggedPath of draggedPaths) {
    if (!isCanonicalDirectoryPath(draggedPath)) {
      continue
    }

    if (target.directoryPath === draggedPath || target.directoryPath.startsWith(draggedPath)) {
      return true
    }
  }

  return false
}

function resolveMoveDestinationPath(sourcePath: string, target: FileTreeDropTarget): string {
  if (target.kind === 'root' || target.directoryPath == null) {
    return getPathBasename(sourcePath)
  }

  return target.directoryPath
}

export function buildDropOperations(
  draggedPaths: readonly string[],
  target: FileTreeDropTarget,
): {
  operations: readonly FileTreeBatchOperation[]
  result: FileTreeDropResult
} | null {
  const operations = draggedPaths
    .map((draggedPath) => {
      const destinationPath = resolveMoveDestinationPath(draggedPath, target)
      if (destinationPath === draggedPath) {
        return null
      }

      // PathStore interprets `to: "dir/"` as "move into that directory using the
      // source basename", so drag/drop can stay path-based without recomputing the
      // full destination leaf path here.

      return {
        from: draggedPath,
        to: destinationPath,
        type: 'move',
      } satisfies FileTreeBatchOperation
    })
    .filter((operation): operation is Extract<FileTreeBatchOperation, { type: 'move' }> => {
      return operation != null
    })

  if (operations.length === 0) {
    return null
  }

  return {
    operations,
    result: {
      draggedPaths,
      operation: operations.length === 1 ? 'move' : 'batch',
      target,
    },
  }
}
