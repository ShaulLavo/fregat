import type { GitFileDiff } from '@workspace/contracts'
import { matchesHistoricalTarget } from '@/lib/documents/utils/comparisons'
import { commitDetailsQueryOptions } from '@/lib/git-commit-details-query'
import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { useQueries, type UseQueryOptions } from '@tanstack/react-query'
import { useMemo } from 'react'

import { errorMessage } from '@/lib/error-message'

import { blobDiffQueryOptions } from '@/lib/blob-diff-query'
import {
  checkpointBlobRequest,
  displayedCheckpointEntry,
  withCheckpointSources,
} from '@/lib/checkpoint-sources'
import type { GitComparison } from '@/lib/documents/utils/types'

type DiffList = readonly GitFileDiff[]
type DiffQueryOptions = UseQueryOptions<DiffList, Error, DiffList, readonly unknown[]>

/**
 * Both diff document kinds resolve to the same shape — a list of `GitFileDiff`
 * — so the viewer never branches on where the diff came from. Snapshot ids are
 * content-addressed and checkpoint ids are pinned to a turn range, so neither
 * result can go stale once fetched.
 */
export function useDiffDocumentDiffs(info: GitComparison | null) {
  const historical =
    info?.kind === 'snapshot' && info.target.kind === 'historical' ? info.target : null
  const historyQueries: ReturnType<typeof commitDetailsQueryOptions>[] = historical
    ? [commitDetailsQueryOptions(historical.rootPath, historical.origin.id)]
    : []
  const [details] = useQueries({ queries: historyQueries })
  const admitted =
    historical === null ||
    (details?.data !== undefined && matchesHistoricalTarget(historical, details.data))
  const documentQueries: DiffQueryOptions[] = info
    ? [{ ...snapshotComparisonQueryOptions(info), enabled: admitted }]
    : []
  const [query] = useQueries({ queries: documentQueries })
  const displayed =
    !info || info.kind === 'snapshot' ? null : displayedCheckpointEntry(query?.data ?? [])
  const blobRequest = checkpointBlobRequest(displayed)
  // Checkpoints list patch snippets; only the displayed file needs its complete Git blobs.
  const queries: DiffQueryOptions[] = blobRequest ? [blobDiffQueryOptions(blobRequest)] : []
  const [blob] = useQueries({ queries })
  const error = details?.error ?? query?.error ?? blob?.error
  const listedData = query?.data
  const blobData = blob?.data
  const blobPending = Boolean(blob?.isPending)
  const resolving = blobRequest !== null
  // Manual memo: DiffView's useMemo keys its parsed files on this list, and a fresh list would
  // re-project the diff and drop the scroll position.
  const diffs = useMemo(() => {
    if (!displayed || !listedData || !resolving) return listedData

    return withCheckpointSources(listedData, displayed, { data: blobData, isPending: blobPending })
  }, [blobData, blobPending, displayed, listedData, resolving])

  const failure = error ? errorMessage(error, 'Diff unavailable.') : null
  const relationshipFailure =
    historical && !details?.isPending && !admitted
      ? 'The commit and Git comparison in this link differ.'
      : null
  return {
    diffs: admitted ? (diffs ?? []) : [],
    failure: failure ?? relationshipFailure,
    pending: Boolean(details?.isPending) || (admitted && Boolean(query?.isPending)) || blobPending,
  }
}
