import type { QueryClient, QueryCacheNotifyEvent } from '@tanstack/react-query'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import { fileDocument, fileDocumentKey, fileResource } from '@/lib/documents/utils/identity'
import type { DocumentRef, TabId } from '@/lib/documents/utils/types'
import { toClientError } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'
import { fileSnapshotPathFromQueryKey } from '@/lib/file-snapshot-query-cache'
import type { FileResult } from '@/lib/file-system-types'

export function watchFileAvailability({
  documentStore,
  workspaceStore,
  queryClient,
  forgetFile,
}: {
  documentStore: EditorDocumentStoreApi
  workspaceStore: EditorWorkspaceStoreApi
  queryClient: QueryClient
  forgetFile: (document: DocumentRef) => void
}) {
  // Fresh opens keep their recovery actions; restored or previously read tabs can retire.
  const establishedTabs = new Set<TabId>()
  const rememberRestoredTabs = () => {
    for (const tab of allEditorTabs(workspaceStore.getState().workbenchPanels.editorGroups)) {
      establishedTabs.add(tab.id)
    }
  }
  rememberRestoredTabs()

  function reconcile(event: QueryCacheNotifyEvent) {
    if (event.type !== 'updated') return
    const path = fileSnapshotPathFromQueryKey(event.query.queryKey)
    if (!path) return
    const tabs = allEditorTabs(workspaceStore.getState().workbenchPanels.editorGroups).filter(
      (tab) =>
        tab.content.kind === 'document' &&
        tab.content.document.kind === 'file' &&
        tab.content.document.resource.path === path,
    )
    if (event.action.type === 'success') {
      for (const tab of tabs) establishedTabs.add(tab.id)
      return
    }
    if (event.action.type !== 'error') return
    if (toClientError(event.action.error).category !== 'not_found') return
    const documents = documentStore.getState()
    const cached = queryClient.getQueryData<FileResult>(event.query.queryKey)
    if (
      tabs.length > 0 &&
      !documents.getLiveEditorDocument(fileDocumentKey(path)) &&
      cached?.path === path
    ) {
      documents.ensureLiveEditorDocument(cached)
    }
    if (documentStore.getState().getLiveEditorDocument(fileDocumentKey(path))) {
      documentStore.getState().setFileOrphaned(fileDocumentKey(path), true)
      return
    }
    if (!tabs.some((tab) => establishedTabs.has(tab.id))) return
    forgetFile(fileDocument(fileResource(path)))
    log.info({ action: 'editor.file_missing', area: 'editor', path, outcome: 'closed-empty-tabs' })
  }

  const unsubscribeQuery = queryClient.getQueryCache().subscribe(reconcile)
  const unsubscribeWorkspace = workspaceStore.subscribe((state, previous) => {
    if (state.rootFolder?.path !== previous.rootFolder?.path) {
      establishedTabs.clear()
      rememberRestoredTabs()
      return
    }
    if (state.workbenchPanels === previous.workbenchPanels) return
    const currentIds = new Set(
      allEditorTabs(state.workbenchPanels.editorGroups).map((tab) => tab.id),
    )
    for (const id of establishedTabs) {
      if (!currentIds.has(id)) establishedTabs.delete(id)
    }
  })
  return () => {
    unsubscribeQuery()
    unsubscribeWorkspace()
  }
}
