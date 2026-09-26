import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { OrchestrationRevertCheckpointHunkInput, SessionId } from '@workspace/contracts'

import {
  checkpointHunkKeys,
  revertCheckpointHunk,
} from '@/features/chat-mode/utils/checkpoint-hunks'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'
import { fileSystemKeys, gitKeys } from '@/lib/query-keys'

const notifyRevertError = createMutationErrorNotifier({
  area: 'chat',
  title: 'Could not change that file',
})

/**
 * Undo or reapply one change of a turn. Serialized per session, since two changes to one file
 * decide against each other's result; settles status, diffs, file text and the change states.
 */
export function useCheckpointHunkRevert(environmentId: string, sessionId: SessionId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: chatModeMutationKeys.checkpointHunk(environmentId, sessionId),
    scope: { id: `chat-checkpoint-hunk:${environmentId}:${sessionId}` },
    mutationFn: (input: Omit<OrchestrationRevertCheckpointHunkInput, 'sessionId'>) =>
      revertCheckpointHunk(clientForQueryClient(queryClient), { ...input, sessionId }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: checkpointHunkKeys.all }),
        queryClient.invalidateQueries({ queryKey: gitKeys.statuses() }),
        queryClient.invalidateQueries({ queryKey: gitKeys.diffs() }),
        queryClient.invalidateQueries({ queryKey: fileSystemKeys.fileSnapshots() }),
        queryClient.invalidateQueries({ queryKey: fileSystemKeys.trees() }),
      ]),
    onError: notifyRevertError,
  })
}
