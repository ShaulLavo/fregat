import type { TabContent, TabId } from '@/lib/documents/utils/types'
import { useIsFetching, useQuery, type QueryKey } from '@tanstack/react-query'

import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'
import { queryHasNoData } from '@/lib/query-state'
import { fileSystemKeys } from '@/lib/query-keys'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { isPdfFile } from '@/lib/pdf-viewer/format'
import { useEditorDocumentState } from '@/features/editor/state/document-state'

const DISABLED_EDITOR_INPUT_QUERY = ['editor-input', 'disabled'] as const

export function useEditorInputPending(
  content: TabContent | null | undefined,
  tabId: TabId | null,
): boolean {
  const queryKey = editorInputQueryKey(content) ?? DISABLED_EDITOR_INPUT_QUERY
  const unresolvedFetches = useIsFetching({ exact: true, predicate: queryHasNoData, queryKey })
  const target = content?.kind === 'document' ? content.document : null
  const path =
    target?.kind === 'file' && !isPdfFile(target.resource.path) ? target.resource.path : null
  const snapshot = useQuery({
    ...fileSnapshotQueryOptions(path ?? filesystemPath('')),
    queryKey: path ? fileSystemKeys.fileSnapshot(path) : DISABLED_EDITOR_INPUT_QUERY,
    enabled: false,
  })
  const bound = useEditorDocumentState(
    (state) =>
      tabId !== null &&
      path !== null &&
      state.viewsByTabId[tabId]?.documentKey === fileDocumentKey(path),
  )

  // A completed read can publish before the body binds its view in a separate React commit.
  if (path) return !bound && !snapshot.isError && !snapshot.data?.seemsBinary

  return queryKey !== DISABLED_EDITOR_INPUT_QUERY && unresolvedFetches > 0
}

export function editorInputQueryKey(content: TabContent | null | undefined): QueryKey | null {
  if (content?.kind !== 'document') return null
  const target = content.document
  if (target.kind === 'git-diff') return diffDocumentQueryKey(target.source)
  if (target.kind === 'compare-saved' || target.kind === 'history') {
    return fileSystemKeys.fileSnapshot(target.file.path)
  }
  if (target.kind === 'file') return fileSystemKeys.fileSnapshot(target.resource.path)
  return null
}
