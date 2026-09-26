import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { setMcpSessionOff } from '@/features/chat/transport/session-tools'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

export function useSetMcpSessionOff(ref: ScopedSessionRef) {
  const queryClient = useQueryClient()
  const mutationKey = chatMutationKeys.setMcpSessionOff(ref.environmentId, ref.sessionId)
  return useMutation({
    mutationKey,
    mutationFn: (input: { name: string; off: boolean }) =>
      setMcpSessionOff(ref, input.name, input.off),
    // Each change may restart the session; the next one waits for it.
    scope: { id: mutationKey.join(':') },
    onSuccess: (mcp) =>
      queryClient.setQueryData(sessionToolKeys.mcp(ref.environmentId, ref.sessionId), mcp),
    onError: (error, input) =>
      toastError(`Could not turn ${input.name} ${input.off ? 'off' : 'on'}`, {
        description: errorMessage(error, 'The session kept its MCP servers as they were.'),
      }),
  })
}
