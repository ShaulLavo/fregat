import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'

import type { SearchBufferOptionPatch } from '@/features/search/state/buffer-state'
import { useSearchBufferStoreApi } from '@/features/search/state/buffer-state'
import type { WorkspaceSearchQueryOptions } from '@/features/search/utils/buffer-query'
import { useSearchBufferValue } from '@/features/search/hooks/use-buffer-value'

export function useSearchBufferInputs(rootPath: string) {
  const navigation = useNavigation()
  const owner = useEditorWorkspaceStoreApi()
  const caseSensitive = useSearchBufferValue(rootPath, (snapshot) => snapshot.caseSensitive, false)
  const excludeGlobText = useSearchBufferValue(rootPath, (snapshot) => snapshot.excludeGlobText, '')
  const filtersVisible = useSearchBufferValue(
    rootPath,
    (snapshot) => snapshot.filtersVisible,
    false,
  )
  const includeGlobText = useSearchBufferValue(rootPath, (snapshot) => snapshot.includeGlobText, '')
  const matchMode = useSearchBufferValue(rootPath, (snapshot) => snapshot.matchMode, 'literal')
  const query = useSearchBufferValue(rootPath, (snapshot) => snapshot.query, '')
  const replaceText = useSearchBufferValue(rootPath, (snapshot) => snapshot.replaceText, '')
  const replaceVisible = useSearchBufferValue(
    rootPath,
    (snapshot) => snapshot.replaceVisible,
    false,
  )
  const replacing = useSearchBufferValue(
    rootPath,
    (snapshot) => snapshot.replaceStatus === 'running',
    false,
  )
  const wholeWord = useSearchBufferValue(rootPath, (snapshot) => snapshot.wholeWord, false)
  const store = useSearchBufferStoreApi()
  const searchOptions: WorkspaceSearchQueryOptions = {
    caseSensitive,
    excludeGlobText,
    filtersVisible,
    includeGlobText,
    matchMode,
    wholeWord,
  }

  function setQuery(nextQuery: string) {
    void navigation.setSearchQuery(nextQuery, owner, rootPath)
  }

  function setSearchOptions(options: SearchBufferOptionPatch) {
    void navigation.setSearchOptions(options, owner, rootPath)
  }

  function selectNextQuery() {
    void navigation.selectSearchQueryHistory(1, owner, rootPath)
  }

  function selectPreviousQuery() {
    void navigation.selectSearchQueryHistory(-1, owner, rootPath)
  }

  function setReplaceText(nextReplaceText: string) {
    store.getState().setReplaceText(rootPath, nextReplaceText)
  }

  function setReplaceVisible(nextReplaceVisible: boolean) {
    store.getState().setReplaceVisible(rootPath, nextReplaceVisible)
  }

  function selectNextReplaceText() {
    store.getState().selectNextReplaceText(rootPath)
  }

  function selectPreviousReplaceText() {
    store.getState().selectPreviousReplaceText(rootPath)
  }

  return {
    query,
    replaceText,
    replaceVisible,
    replacing,
    searchOptions,
    selectNextQuery,
    selectNextReplaceText,
    selectPreviousQuery,
    selectPreviousReplaceText,
    setQuery,
    setReplaceText,
    setReplaceVisible,
    setSearchOptions,
  }
}
