import {
  editorHistoryForClosedPath,
  editorHistoryForRenamedPath,
} from '@/features/editor/state/tab-paths'
import type { CachedWorkspaceSlice } from '@/features/workspace/state/cache'
import {
  closeEditorPathInWorkbenchPanels,
  renameEditorPathInWorkbenchPanels,
} from '@/features/workbench/utils/panels'

export type WorkspaceDocumentChange = {
  readonly path: string
  readonly replacement: string | null
}

export function updateWorkspaceDocument(
  slice: CachedWorkspaceSlice,
  change: WorkspaceDocumentChange,
): CachedWorkspaceSlice {
  if (!sliceContainsDocument(slice, change.path)) return slice
  const { path, replacement } = change
  return {
    workbenchPanels:
      replacement === null
        ? closeEditorPathInWorkbenchPanels(slice.workbenchPanels, path)
        : renameEditorPathInWorkbenchPanels(slice.workbenchPanels, path, replacement),
    editorHistory: updateHistory(slice.editorHistory, change),
    recentlyClosedEditorPaths: updateHistory(slice.recentlyClosedEditorPaths, change),
    scrollPositionByPath: updateScrollPositions(slice.scrollPositionByPath, change),
  }
}

function sliceContainsDocument(slice: CachedWorkspaceSlice, path: string) {
  return (
    slice.workbenchPanels.editorTabs.some((tab) => tab.path === path) ||
    slice.editorHistory.includes(path) ||
    slice.recentlyClosedEditorPaths.includes(path) ||
    Object.hasOwn(slice.scrollPositionByPath, path)
  )
}

function updateHistory(paths: readonly string[], { path, replacement }: WorkspaceDocumentChange) {
  return replacement === null
    ? editorHistoryForClosedPath(paths, path)
    : editorHistoryForRenamedPath(paths, path, replacement)
}

function updateScrollPositions(
  positions: CachedWorkspaceSlice['scrollPositionByPath'],
  { path, replacement }: WorkspaceDocumentChange,
) {
  const position = positions[path]
  if (!position || path === replacement) return positions
  const next = { ...positions }
  delete next[path]
  if (replacement !== null) next[replacement] = position
  return next
}
