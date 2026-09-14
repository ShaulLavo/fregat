import { useEffect } from 'react'

import {
  useEditorDocumentStoreApi,
  useEditorDocumentState,
} from '@/features/editor/state/document-state'
import {
  dirtySearchDocuments,
  dirtySearchRevisionKey,
} from '@/features/search/state/dirty-documents'
import type { WorkspaceSearchQueryOptions } from '@/features/search/utils/buffer-query'
import { workspaceSearchQuery } from '@/features/search/utils/buffer-query'
import { useSearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'

import { clientOnlyWorkspaceSearchProvider, runSearch } from '@/features/search/utils/buffer-runner'

const DIRTY_BUFFER_DEBOUNCE_MS = 220

export function useRunDirtySearchBufferOverlay(
  rootPath: string,
  query: string,
  searchOptions: WorkspaceSearchQueryOptions,
) {
  const { caseSensitive, excludeGlobText, filtersVisible, includeGlobText, matchMode, wholeWord } =
    searchOptions
  const store = useSearchBufferStoreApi()
  const documentStore = useEditorDocumentStoreApi()
  const dirtyRevisionKey = useEditorDocumentState((state) =>
    query
      ? dirtySearchRevisionKey(
          state.liveDocumentsByKey,
          state.dirtyDocumentKeys,
          state.documentContentRevisions,
          rootPath,
        )
      : '',
  )
  const [debouncedDirtyRevisionKey] = useDebouncedValue(dirtyRevisionKey, {
    wait: DIRTY_BUFFER_DEBOUNCE_MS,
  })
  useEffect(() => {
    if (!query) return

    const searchQuery = workspaceSearchQuery(rootPath, query, {
      caseSensitive,
      excludeGlobText,
      filtersVisible,
      includeGlobText,
      matchMode,
      wholeWord,
    })
    const documentState = documentStore.getState()
    const dirtyDocuments = dirtySearchDocuments(
      documentState.liveDocumentsByKey,
      documentState.dirtyDocumentKeys,
      rootPath,
    )
    const provider = clientOnlyWorkspaceSearchProvider(
      store.getState().active,
      dirtyDocuments,
      searchQuery,
    )
    if (!provider) return

    const controller = new AbortController()
    const runId = store.getState().startSearch(searchQuery)

    void runSearch(provider, searchQuery, runId, store, controller.signal)

    return () => controller.abort()
  }, [
    debouncedDirtyRevisionKey,
    documentStore,
    query,
    rootPath,
    caseSensitive,
    excludeGlobText,
    filtersVisible,
    includeGlobText,
    matchMode,
    wholeWord,
    store,
  ])
}
