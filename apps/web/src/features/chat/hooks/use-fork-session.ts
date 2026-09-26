import { useMutation } from '@tanstack/react-query'
import type { SessionId, TurnId } from '@workspace/contracts'
import { createSessionForkCommand } from '@workspace/client-core/chat/commands'

import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'
import { getNavigation } from '@/state/navigation-binding'

/** Branches a new session off a finished turn and opens it. */
export function useForkSession(sourceSessionId: SessionId) {
  const transport = useChatTransport()
  return useMutation({
    mutationKey: chatMutationKeys.fork(transport.environmentId, sourceSessionId),
    mutationFn: async (throughTurnId: TurnId) => {
      const command = createSessionForkCommand({ sourceSessionId, throughTurnId })
      const outcome = await dispatchChatCommand({
        action: 'chat.session.fork',
        command,
        dispatchCommand: transport.dispatchCommand,
      })
      if (!outcome.ok) throw outcome.error

      await getNavigation().openChat({
        environmentId: transport.environmentId,
        sessionId: command.sessionId,
        surface: 'main',
      })
    },
    onError: (error) =>
      toastError('Could not fork the session', {
        description: errorMessage(error, 'The fork was not created.'),
      }),
  })
}
