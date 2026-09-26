import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createSessionRuntimeStopCommand } from '@workspace/client-core/chat/commands'
import type { ProviderSessionSchedules, ScopedSessionRef } from '@workspace/contracts'

import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { sessionScheduleKeys } from '@/features/chat/utils/query-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

const NO_SCHEDULES: ProviderSessionSchedules = { schedules: [], heldByBackgroundWork: false }

/** Schedules live in the agent's process, so cancelling them stops that process. */
export function useCancelSchedules(ref: ScopedSessionRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: chatMutationKeys.cancelSchedules(ref.environmentId, ref.sessionId),
    mutationFn: async () => {
      const outcome = await dispatchChatCommand({
        action: 'chat.session.cancelSchedules',
        command: createSessionRuntimeStopCommand({ sessionId: ref.sessionId }),
        dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
      })
      if (!outcome.ok) throw outcome.error
    },
    onSuccess: () =>
      queryClient.setQueryData(
        sessionScheduleKeys.list(ref.environmentId, ref.sessionId),
        NO_SCHEDULES,
      ),
    onError: (error) =>
      toastError('Could not cancel the schedules', {
        description: errorMessage(error, 'The schedules are still set.'),
      }),
  })
}
