import { comparisonRequest } from '@/lib/documents/utils/comparisons'
import { checkpointDiffQueryKey } from '@/features/chat/utils/checkpoint-diff-query'
import { blobDiffQueryKey } from '@/features/git/utils/blob-diff-query'
import type { GitComparison } from '@/lib/documents/utils/types'

export function diffDocumentQueryKey(info: GitComparison) {
  const request = comparisonRequest(info)
  if (request.kind === 'checkpoint') return checkpointDiffQueryKey(request.query)
  return blobDiffQueryKey(request.query)
}
