import { comparisonRequest } from '@/lib/documents/utils/comparisons'
import { checkpointDiffQueryKey } from '@/lib/checkpoint-diff-query'
import { blobDiffQueryKey } from '@/lib/blob-diff-query'
import type { GitComparison } from '@/lib/documents/utils/types'
import { gitKeys } from '@/lib/query-keys'

export function diffDocumentQueryKey(info: GitComparison) {
  const request = comparisonRequest(info)
  if (request.kind === 'checkpoint') return checkpointDiffQueryKey(request.query)
  if (request.kind === 'moving') return gitKeys.diff(request.query.path, request.query.staged)
  return blobDiffQueryKey(request.query)
}
