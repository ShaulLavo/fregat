import type { TabContent } from '@/lib/documents/utils/types'
import { useIsFetching, type QueryKey } from '@tanstack/react-query'

import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'
import { queryHasNoData } from '@/lib/query-state'
import { fileSystemKeys } from '@/lib/query-keys'

const DISABLED_EDITOR_INPUT_QUERY = ['editor-input', 'disabled'] as const

export function useEditorInputPending(content: TabContent | null | undefined): boolean {
  const queryKey = editorInputQueryKey(content) ?? DISABLED_EDITOR_INPUT_QUERY
  const unresolvedFetches = useIsFetching({ exact: true, predicate: queryHasNoData, queryKey })

  return queryKey !== DISABLED_EDITOR_INPUT_QUERY && unresolvedFetches > 0
}

export function editorInputQueryKey(content: TabContent | null | undefined): QueryKey | null {
  if (content?.kind !== 'document') return null
  const target = content.document
  if (target.kind === 'git-diff') return diffDocumentQueryKey(target.source)
  if (target.kind === 'compare-saved') return fileSystemKeys.fileSnapshot(target.file.path)
  if (target.kind === 'file') return fileSystemKeys.fileSnapshot(target.resource.path)
  return null
}
