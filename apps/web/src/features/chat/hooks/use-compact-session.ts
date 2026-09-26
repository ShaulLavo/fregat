import { useMutation } from '@tanstack/react-query'
import type { InteractionMode, RuntimeMode, ScopedSessionRef } from '@workspace/contracts'
import { createSessionCompactCommand } from '@workspace/client-core/chat/commands'

import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { toastError } from '@/lib/toast-error'

/** Compacts a session as its own turn; the composer's draft is never read or sent. */
export function useCompactSession(ref: ScopedSessionRef) {
  return useMutation({
    mutationKey: chatMutationKeys.compact(ref.environmentId, ref.sessionId),
    mutationFn: async (modes: { interactionMode: InteractionMode; runtimeMode: RuntimeMode }) => {
      const outcome = await dispatchChatCommand({
        action: 'chat.session.compact',
        command: createSessionCompactCommand({ ...modes, sessionId: ref.sessionId }),
        dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
      })
      if (!outcome.ok) throw outcome.error
    },
    onError: (error) =>
      toastError('Could not compact the conversation', {
        description: error instanceof Error ? error.message : 'The compaction did not start.',
      }),
  })
}
