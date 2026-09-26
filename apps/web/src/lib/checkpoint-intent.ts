import type { GitFileDiff } from '@workspace/contracts'
import { queryOptions } from '@tanstack/react-query'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { checkpointAvailability } from '@/lib/checkpoint-availability'
import {
  cachedCountedTurnDiff,
  checkpointDiffInputForSummary,
  checkpointDiffQueryKey,
  fetchCheckpointDiff,
} from '@/lib/checkpoint-diff-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function checkpointIntentOptions(summary: ChatTurnDiffSummary) {
  if (checkpointAvailability(summary).kind !== 'available') return null
  const input = checkpointDiffInputForSummary(summary)
  return queryOptions<readonly GitFileDiff[]>({
    queryKey: checkpointDiffQueryKey(input),
    staleTime: Infinity,
    retry: false,
    queryFn: ({ client, signal }) =>
      cachedCountedTurnDiff(client, input) ??
      fetchCheckpointDiff(input, signal, clientForQueryClient(client)),
  })
}
