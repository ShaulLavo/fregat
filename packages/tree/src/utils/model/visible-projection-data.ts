// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStoreVisibleTreeProjectionData } from '../path-store/public-types'

import { ancestorDirectoryPaths } from '@workspace/utils/slash-paths'

export type ProjectionIndexBuffer = Int32Array<ArrayBufferLike>

interface VisibleProjectionData {
  focusedIndex: number
  getParentIndex(index: number): number
  paths: readonly string[]
  posInSetByIndex: ProjectionIndexBuffer
  setSizeByIndex: ProjectionIndexBuffer
}

function getFirstVisibleDescendantIndex(path: string, visiblePaths: readonly string[]): number {
  const descendantPrefix = path.endsWith('/') ? path : `${path}/`
  return visiblePaths.findIndex((visiblePath) => visiblePath.startsWith(descendantPrefix))
}

function getExactVisibleIndex(
  path: string,
  visiblePaths: readonly string[],
  getVisibleIndex: (path: string) => number | null,
): number | null {
  const projectionIndex = visiblePaths.indexOf(path)
  if (projectionIndex >= 0) {
    return projectionIndex
  }

  const fallbackIndex = getVisibleIndex(path)
  if (fallbackIndex == null) {
    return null
  }

  return visiblePaths[fallbackIndex] === path ? fallbackIndex : null
}

// Keeps focus resolution cheap after expand/collapse by asking for the
// candidate path, descendants, and ancestors instead of forcing a full
// visible-index map.
function resolveFocusedIndexByLookup(
  rowCount: number,
  getVisibleIndex: (path: string) => number | null,
  candidatePath: string | null,
  visiblePaths: readonly string[],
): number {
  if (rowCount === 0) {
    return -1
  }

  if (candidatePath != null) {
    const directIndex = getExactVisibleIndex(candidatePath, visiblePaths, getVisibleIndex)
    if (directIndex != null) {
      return directIndex
    }

    const descendantIndex = getFirstVisibleDescendantIndex(candidatePath, visiblePaths)
    if (descendantIndex >= 0) {
      return descendantIndex
    }

    const ancestorPaths = ancestorDirectoryPaths(candidatePath)
    for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
      const ancestorPath = ancestorPaths[index]
      if (ancestorPath == null) {
        continue
      }

      const ancestorIndex = getExactVisibleIndex(ancestorPath, visiblePaths, getVisibleIndex)
      if (ancestorIndex != null) {
        return ancestorIndex
      }
    }
  }

  return 0
}

// Rebuilds the visible-row projection once so focus/navigation can use
// path-first metadata without recomputing sibling and parent info per render.
// Derives the row metadata that the renderer needs for roving tabindex and
// treeitem ARIA attrs without exposing PathStore's numeric row identities.
export function createVisibleProjection(
  projection: PathStoreVisibleTreeProjectionData,
  focusedPathCandidate: string | null,
  resolveVisibleIndexByPath?: (path: string) => number | null,
): VisibleProjectionData {
  if (projection.paths.length === 0) {
    return {
      focusedIndex: -1,
      getParentIndex: projection.getParentIndex,
      paths: projection.paths,
      posInSetByIndex: projection.posInSetByIndex,
      setSizeByIndex: projection.setSizeByIndex,
    }
  }

  if (focusedPathCandidate == null) {
    return {
      focusedIndex: 0,
      getParentIndex: projection.getParentIndex,
      paths: projection.paths,
      posInSetByIndex: projection.posInSetByIndex,
      setSizeByIndex: projection.setSizeByIndex,
    }
  }

  const getVisibleIndex =
    resolveVisibleIndexByPath ??
    ((path: string): number | null => projection.visibleIndexByPath.get(path) ?? null)
  return {
    focusedIndex: resolveFocusedIndexByLookup(
      projection.paths.length,
      getVisibleIndex,
      focusedPathCandidate,
      projection.paths,
    ),
    getParentIndex: projection.getParentIndex,
    paths: projection.paths,
    posInSetByIndex: projection.posInSetByIndex,
    setSizeByIndex: projection.setSizeByIndex,
  }
}
