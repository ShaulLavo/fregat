import type { GitFileDiff } from '@workspace/contracts'
import { comparisonRequest } from '@/lib/documents/utils/comparisons'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import {
  checkpointDiffRetry,
  checkpointDiffRetryDelay,
  fetchCheckpointDiff,
} from '@/features/chat/utils/checkpoint-diff-query'
import { errorMessage } from '@/lib/error-message'

import { fetchBlobDiff } from '@/features/git/utils/blob-diff-query'
import type { GitComparison } from '@/lib/documents/utils/types'
import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'

type DiffList = readonly GitFileDiff[]
type DiffQueryOptions = UseQueryOptions<DiffList, Error, DiffList, readonly unknown[]>

/**
 * Both diff document kinds resolve to the same shape — a list of `GitFileDiff`
 * — so the viewer never branches on where the diff came from. Snapshot ids are
 * content-addressed and checkpoint ids are pinned to a turn range, so neither
 * result can go stale once fetched.
 */
export function useDiffDocumentDiffs(info: GitComparison) {
  const query = useQuery(diffDocumentQueryOptions(info))

  return {
    diffs: query.data ?? [],
    failure: query.isError ? errorMessage(query.error, 'Diff unavailable.') : null,
    pending: query.isPending,
  }
}

function diffDocumentQueryOptions(info: GitComparison): DiffQueryOptions {
  const request = comparisonRequest(info)
  if (request.kind === 'checkpoint') {
    const input = request.query

    return {
      queryFn: ({ signal, client }) =>
        fetchCheckpointDiff(input, signal, clientForQueryClient(client)),
      queryKey: diffDocumentQueryKey(info),
      retry: checkpointDiffRetry,
      retryDelay: checkpointDiffRetryDelay,
      staleTime: Infinity,
    }
  }

  const input = request.query

  return {
    queryFn: ({ signal, client }) => fetchBlobDiff(input, signal, clientForQueryClient(client)),
    queryKey: diffDocumentQueryKey(info),
    retry: false,
    staleTime: Infinity,
  }
}
