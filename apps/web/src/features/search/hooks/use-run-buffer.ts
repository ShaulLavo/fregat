import { useEffect } from 'react'

import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { dirtySearchDocuments } from '@/features/search/state/dirty-documents'
import type { WorkspaceSearchQueryOptions } from '@/features/search/utils/buffer-query'
import { workspaceSearchQuery } from '@/features/search/utils/buffer-query'
import { useSearchBufferStoreApi } from '@/features/search/state/buffer-state'
import {
  runSearch,
  shouldDeferInitialOpenBufferMatches,
  workspaceSearchProvider,
} from '@/features/search/utils/buffer-runner'
import { shouldStartWorkspaceSearch } from '@/features/search/utils/run-state'
import { useRunDirtySearchBufferOverlay } from '@/features/search/hooks/use-run-dirty-buffer-overlay'

export function useRunSearchBuffer(
  rootPath: string,
  query: string,
  searchRevision: number,
  searchOptions: WorkspaceSearchQueryOptions,
) {
  const { caseSensitive, excludeGlobText, filtersVisible, includeGlobText, matchMode, wholeWord } =
    searchOptions
  const store = useSearchBufferStoreApi()
  const documentStore = useEditorDocumentStoreApi()

  useEffect(() => {
    if (!query) return

    const controller = new AbortController()
    const searchQuery = workspaceSearchQuery(rootPath, query, {
      caseSensitive,
      excludeGlobText,
      filtersVisible,
      includeGlobText,
      matchMode,
      wholeWord,
    })
    const activeSnapshot = store.getState().active
    if (!shouldStartWorkspaceSearch(activeSnapshot, searchQuery)) return

    const documentState = documentStore.getState()
    const dirtyDocuments = dirtySearchDocuments(
      documentState.liveDocumentsByKey,
      documentState.dirtyDocumentKeys,
      rootPath,
    )
    const provider = workspaceSearchProvider(dirtyDocuments)
    const deferInitialOpenBufferMatches = shouldDeferInitialOpenBufferMatches(
      activeSnapshot,
      searchQuery,
    )
    const runId = store.getState().startSearch(searchQuery)

    void runSearch(provider, searchQuery, runId, store, controller.signal, {
      deferInitialOpenBufferMatches,
    })

    return () => controller.abort()
  }, [
    documentStore,
    query,
    rootPath,
    searchRevision,
    caseSensitive,
    excludeGlobText,
    filtersVisible,
    includeGlobText,
    matchMode,
    wholeWord,
    store,
  ])

  useRunDirtySearchBufferOverlay(rootPath, query, searchOptions)
}
