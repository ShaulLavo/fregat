import {
  editorHistoryForClosedContent,
  editorHistoryForRenamedFile,
} from '@/features/editor/utils/tab-history'
import type { CachedWorkspaceSlice } from '@/features/workspace/state/cache'
import {
  closeEditorContentInWorkbenchPanels,
  renameEditorFileInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { documentTab, rekeyTabFile, sameTabContent } from '@/lib/documents/utils/tabs'
import { fileDocument, fileResource } from '@/lib/documents/utils/identity'
import type { DocumentRef, FilesystemPath, TabContent } from '@/lib/documents/utils/types'

export type WorkspaceDocumentChange =
  | { readonly kind: 'remove'; readonly document: DocumentRef }
  | { readonly kind: 'rename'; readonly from: FilesystemPath; readonly to: FilesystemPath }

export function updateWorkspaceDocument(
  slice: CachedWorkspaceSlice,
  change: WorkspaceDocumentChange,
): CachedWorkspaceSlice {
  const content = changedContent(change)
  if (content === null || !sliceContainsContent(slice, content)) return slice
  if (change.kind === 'remove') {
    return {
      workbenchPanels: closeEditorContentInWorkbenchPanels(slice.workbenchPanels, content),
      editorHistory: editorHistoryForClosedContent(slice.editorHistory, content),
      recentlyClosedTabs: editorHistoryForClosedContent(slice.recentlyClosedTabs, content),
      reopenScrollPositions: slice.reopenScrollPositions.filter(
        (entry) => !sameTabContent(entry.content, content),
      ),
    }
  }
  return {
    workbenchPanels: renameEditorFileInWorkbenchPanels(
      slice.workbenchPanels,
      change.from,
      change.to,
    ),
    editorHistory: editorHistoryForRenamedFile(slice.editorHistory, change.from, change.to),
    recentlyClosedTabs: editorHistoryForRenamedFile(
      slice.recentlyClosedTabs,
      change.from,
      change.to,
    ),
    reopenScrollPositions: slice.reopenScrollPositions.map((entry) => ({
      content: rekeyTabFile(entry.content, change.from, change.to),
      position: entry.position,
    })),
  }
}

function changedContent(change: WorkspaceDocumentChange): TabContent | null {
  if (change.kind === 'rename') return documentTab(fileDocument(fileResource(change.from)))
  if (change.document.kind === 'settings-json') return null
  return documentTab(change.document)
}

function sliceContainsContent(slice: CachedWorkspaceSlice, content: TabContent) {
  return (
    slice.workbenchPanels.editorTabs.some((tab) => sameTabContent(tab.content, content)) ||
    slice.editorHistory.some((entry) => sameTabContent(entry, content)) ||
    slice.recentlyClosedTabs.some((entry) => sameTabContent(entry, content)) ||
    slice.reopenScrollPositions.some((entry) => sameTabContent(entry.content, content))
  )
}
