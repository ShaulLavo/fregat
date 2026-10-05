import type { QueryClient } from '@tanstack/react-query'
import { snapshotRequest, matchesHistoricalTarget } from '@/lib/documents/utils/comparisons'
import type { SnapshotComparison } from '@/lib/documents/utils/snapshot-comparison'
import { blobDiffQueryOptions } from '@/lib/blob-diff-query'
import { diffQueryOptions } from '@/lib/git-diff-query'
import { commitDetailsQueryOptions } from '@/lib/git-commit-details-query'

export function snapshotComparisonQueryOptions(comparison: SnapshotComparison) {
  const request = snapshotRequest(comparison)
  if (request.kind === 'moving') return diffQueryOptions(request.query.path, request.query.staged)
  return blobDiffQueryOptions(request.query)
}

export function snapshotComparisonIsAdmitted(
  queries: QueryClient,
  rootPath: string,
  comparison: SnapshotComparison,
) {
  const target = comparison.target
  if (target.rootPath !== rootPath) return false
  if (target.kind !== 'historical') return true
  const details = queries.getQueryData(
    commitDetailsQueryOptions(target.rootPath, target.origin.id).queryKey,
  )
  return details !== undefined && matchesHistoricalTarget(target, details)
}
