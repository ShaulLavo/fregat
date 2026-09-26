import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { stopBackgroundTask } from '@/features/chat/transport/background-tasks'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { backgroundTaskKeys } from '@/features/chat/utils/query-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

export function useStopBackgroundTask(ref: ScopedSessionRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: chatMutationKeys.stopBackgroundTask(ref.environmentId, ref.sessionId),
    mutationFn: (taskId: string) => stopBackgroundTask(ref, taskId),
    onSuccess: (roster) =>
      queryClient.setQueryData(backgroundTaskKeys.roster(ref.environmentId, ref.sessionId), roster),
    onError: (error) =>
      toastError('Could not stop the task', {
        description: errorMessage(error, 'The task is still running.'),
      }),
  })
}
