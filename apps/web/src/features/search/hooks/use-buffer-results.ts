import type { WorkspaceSearchQuery } from '@workspace/contracts'

import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { useSearchBufferValue } from '@/features/search/hooks/use-buffer-value'

const EMPTY_SEARCH_GROUPS: readonly WorkspaceSearchFileGroup[] = []

export function useSearchBufferResults(rootPath: string) {
  const activeResultId = useSearchBufferValue(rootPath, (snapshot) => snapshot.activeResultId, null)
  const activeResultPicked = useSearchBufferValue(
    rootPath,
    (snapshot) => snapshot.activeResultPicked,
    false,
  )
  const groups = useSearchBufferValue(rootPath, (snapshot) => snapshot.groups, EMPTY_SEARCH_GROUPS)
  const replaceText = useSearchBufferValue(rootPath, (snapshot) => snapshot.replaceText, '')
  const replaceVisible = useSearchBufferValue(
    rootPath,
    (snapshot) => snapshot.replaceVisible,
    false,
  )
  const status = useSearchBufferValue(rootPath, (snapshot) => snapshot.status, 'idle')
  const resultsQuery = useSearchBufferValue(
    rootPath,
    (snapshot) => snapshot.resultsQuery || snapshot.query,
    '',
  )
  const resultsSearchQuery = useSearchBufferValue<WorkspaceSearchQuery | null>(
    rootPath,
    (snapshot) => snapshot.resultsSearchQuery,
    null,
  )

  return {
    activeResultId,
    activeResultPicked,
    groups,
    replaceText,
    replaceVisible,
    resultsQuery,
    resultsSearchQuery,
    status,
  }
}
