import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { editorTabRecordsForWorkbenchPanels } from '@/features/workbench/utils/panels'
import type { EditorViewScrollPosition, ReopenScrollPosition } from '@/lib/documents/utils/types'

export function captureEditorScrollPositions(
  workspaceStore: EditorWorkspaceStoreApi,
  documentStore: EditorDocumentStoreApi,
) {
  const workspace = workspaceStore.getState()
  const documents = documentStore.getState()
  const retained = new Map(
    workspace.viewScrollPositions.map((entry) => [entry.tabId, entry.position]),
  )
  const views: EditorViewScrollPosition[] = []
  const reopen: ReopenScrollPosition[] = []
  for (const tab of editorTabRecordsForWorkbenchPanels(workspace.workbenchPanels)) {
    const live = documents.scrollPositionByTabId[tab.id]
    const scroll = live ?? retained.get(tab.id)
    if (!scroll) continue
    const position = { left: scroll.left ?? 0, top: scroll.top ?? 0 }
    views.push({ tabId: tab.id, position })
    if (!live) continue
    const reopenPosition = documents.viewsByTabId[tab.id]?.reopenScrollPosition ?? live
    reopen.push({
      content: tab.content,
      position: { left: reopenPosition.left ?? 0, top: reopenPosition.top ?? 0 },
    })
  }
  workspace.setViewScrollPositions(views)
  workspaceStore.getState().setEditorScrollPositions(reopen)
}
