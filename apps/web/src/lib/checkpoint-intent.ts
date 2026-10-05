import type { GitFileDiff } from '@workspace/contracts'
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { checkpointAvailability } from '@/lib/checkpoint-availability'
import {
  cachedCountedTurnDiff,
  checkpointDiffInputForSummary,
  checkpointDiffQueryKey,
  fetchCheckpointDiff,
} from '@/lib/checkpoint-diff-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function checkpointIntentOptions(summary: ChatTurnDiffSummary, queries: QueryClient) {
  if (checkpointAvailability(summary).kind !== 'available') return null
  const display = checkpointDiffInputForSummary(summary)
  const counted = cachedCountedTurnDiff(queries, display)
  const input = { ...display, ignoreWhitespace: counted === undefined }
  return queryOptions<readonly GitFileDiff[]>({
    queryKey: checkpointDiffQueryKey(input),
    staleTime: Infinity,
    retry: false,
    queryFn: ({ client, signal }) =>
      counted ?? fetchCheckpointDiff(input, signal, clientForQueryClient(client)),
  })
}
