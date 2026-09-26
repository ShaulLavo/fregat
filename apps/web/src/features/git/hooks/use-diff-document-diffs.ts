import type { GitFileDiff } from '@workspace/contracts'
import { comparisonRequest } from '@/lib/documents/utils/comparisons'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  checkpointDiffRetry,
  checkpointDiffRetryDelay,
  fetchCheckpointDiff,
} from '@/lib/checkpoint-diff-query'
import { errorMessage } from '@/lib/error-message'

import { blobDiffQueryOptions } from '@/features/git/utils/blob-diff-query'
import {
  checkpointBlobRequest,
  displayedCheckpointEntry,
  withCheckpointSources,
} from '@/features/git/utils/checkpoint-blob-request'
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
  const displayed = info.kind === 'snapshot' ? null : displayedCheckpointEntry(query.data ?? [])
  const blobRequest = checkpointBlobRequest(displayed)
  // Checkpoints list patch snippets; only the displayed file needs its complete Git blobs.
  const queries: DiffQueryOptions[] = blobRequest ? [blobDiffQueryOptions(blobRequest)] : []
  const [blob] = useQueries({ queries })
  const error = query.error ?? blob?.error
  const listedData = query.data
  const blobData = blob?.data
  const blobPending = Boolean(blob?.isPending)
  const resolving = blobRequest !== null
  // Manual memo: DiffView's useMemo keys its parsed files on this list, and a fresh list would
  // re-project the diff and drop the scroll position.
  const diffs = useMemo(() => {
    if (!displayed || !listedData || !resolving) return listedData

    return withCheckpointSources(listedData, displayed, { data: blobData, isPending: blobPending })
  }, [blobData, blobPending, displayed, listedData, resolving])

  return {
    diffs: diffs ?? [],
    failure: error ? errorMessage(error, 'Diff unavailable.') : null,
    pending: query.isPending || blobPending,
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

  return blobDiffQueryOptions(request.query)
}
