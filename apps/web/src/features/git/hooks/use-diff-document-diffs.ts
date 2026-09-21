import { useGitReloadOwner } from '@/features/git/hooks/use-reload-owner'
import type { GitFileDiff } from '@workspace/contracts'
import { comparisonRequest } from '@/lib/documents/utils/comparisons'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useEffect } from 'react'
import { captureDiff, savedDiff } from '@/features/git/state/reload'
import {
  replaceEqualDeep,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query'

import {
  checkpointDiffRetry,
  checkpointDiffRetryDelay,
  fetchCheckpointDiff,
} from '@/features/chat/utils/checkpoint-diff-query'
import { errorMessage } from '@/lib/error-message'

import { blobDiffQueryOptions } from '@/features/git/utils/blob-diff-query'
import { checkpointBlobRequest } from '@/features/git/utils/checkpoint-blob-request'
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
  const owner = useQueryClient()
  const generation = useGitReloadOwner(owner)
  const identity = JSON.stringify(diffDocumentQueryKey(info))
  const saved = savedDiff(owner, identity)
  const query = useQuery(diffDocumentQueryOptions(info))
  const blobRequest = info.kind === 'snapshot' ? null : checkpointBlobRequest(query.data ?? [])
  // Checkpoints list patch snippets; only the displayed file needs its complete Git blobs.
  const queries: DiffQueryOptions[] = blobRequest ? [blobDiffQueryOptions(blobRequest)] : []
  const [blob] = useQueries({ queries })
  const error = query.error ?? blob?.error
  const diffs = blob ? blob.data : query.data

  useEffect(() => {
    if (diffs && !error) captureDiff(owner, generation, identity, diffs)
  }, [owner, generation, identity, diffs, error])
  const display =
    diffs && saved?.diffs ? replaceEqualDeep(saved.diffs, diffs) : (diffs ?? saved?.diffs ?? [])
  return {
    diffs: display,
    failure: error ? errorMessage(error, 'Diff unavailable.') : null,
    pending: !saved?.diffs && (query.isPending || Boolean(blob?.isPending)),
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
