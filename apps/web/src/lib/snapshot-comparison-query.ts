import type { QueryClient } from '@tanstack/react-query'
import { comparisonRequest, matchesHistoricalTarget } from '@/lib/documents/utils/comparisons'
import type { GitComparison } from '@/lib/documents/utils/types'
import { blobDiffQueryOptions } from '@/lib/blob-diff-query'
import { diffQueryOptions } from '@/lib/git-diff-query'
import { commitDetailsQueryOptions } from '@/lib/git-commit-details-query'
import {
  checkpointDiffQueryKey,
  checkpointDiffRetry,
  checkpointDiffRetryDelay,
  fetchCheckpointDiff,
} from '@/lib/checkpoint-diff-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function snapshotComparisonQueryOptions(comparison: GitComparison) {
  const request = comparisonRequest(comparison)
  if (request.kind === 'checkpoint')
    return {
      queryKey: checkpointDiffQueryKey(request.query),
      queryFn: ({ signal, client }: { signal: AbortSignal; client: QueryClient }) =>
        fetchCheckpointDiff(request.query, signal, clientForQueryClient(client)),
      retry: checkpointDiffRetry,
      retryDelay: checkpointDiffRetryDelay,
      staleTime: Infinity,
    }
  if (request.kind === 'moving') return diffQueryOptions(request.query.path, request.query.staged)
  return blobDiffQueryOptions(request.query)
}

export function snapshotComparisonIsAdmitted(
  queries: QueryClient,
  rootPath: string,
  comparison: GitComparison,
) {
  if (comparison.kind !== 'snapshot') return comparison.owner === rootPath
  const target = comparison.target
  if (target.rootPath !== rootPath) return false
  if (target.kind !== 'historical') return true
  const details = queries.getQueryData(
    commitDetailsQueryOptions(target.rootPath, target.origin.id).queryKey,
  )
  return details !== undefined && matchesHistoricalTarget(target, details)
}
