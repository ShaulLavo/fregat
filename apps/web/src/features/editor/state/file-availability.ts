import type { QueryClient, QueryCacheNotifyEvent } from '@tanstack/react-query'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import { toClientError } from '@/lib/client-error-taxonomy'
import { fileSnapshotPathFromQueryKey } from '@/lib/file-snapshot-query-cache'
import type { FileResult } from '@/lib/file-system-types'

export function watchFileAvailability({
  documentStore,
  workspaceStore,
  queryClient,
}: {
  documentStore: EditorDocumentStoreApi
  workspaceStore: EditorWorkspaceStoreApi
  queryClient: QueryClient
}) {
  function reconcile(event: QueryCacheNotifyEvent) {
    if (event.type !== 'updated') return
    const path = fileSnapshotPathFromQueryKey(event.query.queryKey)
    if (!path) return
    if (event.action.type === 'success') {
      // Retained presentation data can remount after deletion; only a read confirms existence.
      const file = queryClient.getQueryData<FileResult>(event.query.queryKey)
      if (!event.action.manual && file?.path === path) {
        documentStore.getState().setFileOrphaned(fileDocumentKey(path), false)
      }
      return
    }
    if (event.action.type !== 'error') return
    if (toClientError(event.action.error).category !== 'not_found') return
    const documents = documentStore.getState()
    const cached = queryClient.getQueryData<FileResult>(event.query.queryKey)
    const hasTab = allEditorTabs(workspaceStore.getState().workbenchPanels.editorGroups).some(
      (tab) =>
        tab.content.kind === 'document' &&
        tab.content.document.kind === 'file' &&
        tab.content.document.resource.path === path,
    )
    if (
      hasTab &&
      !documents.getLiveEditorDocument(fileDocumentKey(path)) &&
      cached?.path === path &&
      !cached.seemsBinary
    ) {
      documents.ensureLiveEditorDocument(cached)
    }
    // A read can race a rename; keep the tab so its path notification and recovery actions survive.
    documentStore.getState().setFileOrphaned(fileDocumentKey(path), true)
  }

  return queryClient.getQueryCache().subscribe(reconcile)
}
