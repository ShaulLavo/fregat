import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createSessionHarnessCommand } from '@workspace/client-core/chat/commands'
import type {
  InteractionMode,
  ProviderGoalAction,
  ProviderSessionGoalState,
  RuntimeMode,
  ScopedSessionRef,
} from '@workspace/contracts'

import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { controlSessionGoal } from '@/features/chat/transport/session-goal'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { sessionGoalKeys } from '@/features/chat/utils/query-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

type GoalControl = {
  readonly action: ProviderGoalAction
  /** False when the harness takes goal changes only as a `/goal` prompt. */
  readonly controllable: boolean
  readonly modes: { interactionMode: InteractionMode; runtimeMode: RuntimeMode }
}

/** Pauses, resumes or clears a goal: directly where the provider allows, else as `/goal clear`. */
export function useControlGoal(ref: ScopedSessionRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: chatMutationKeys.controlGoal(ref.environmentId, ref.sessionId),
    mutationFn: async ({ action, controllable, modes }: GoalControl) => {
      if (controllable) return controlSessionGoal(ref, action)
      const outcome = await dispatchChatCommand({
        action: 'chat.session.goal',
        command: createSessionHarnessCommand({
          ...modes,
          sessionId: ref.sessionId,
          text: `/goal ${action}`,
        }),
        dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
      })
      if (!outcome.ok) throw outcome.error
      return null
    },
    onSuccess: async (state: ProviderSessionGoalState | null) => {
      const key = sessionGoalKeys.all(ref.environmentId, ref.sessionId)
      if (state) queryClient.setQueriesData({ queryKey: key }, state)
      else await queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (error) =>
      toastError('Could not change the goal', {
        description: errorMessage(error, 'The goal is unchanged.'),
      }),
  })
}
