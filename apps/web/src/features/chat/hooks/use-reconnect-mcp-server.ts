import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { reconnectMcpServer } from '@/features/chat/transport/session-tools'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

export function useReconnectMcpServer(ref: ScopedSessionRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: chatMutationKeys.reconnectMcpServer(ref.environmentId, ref.sessionId),
    mutationFn: (name: string) => reconnectMcpServer(ref, name),
    onSuccess: (mcp) =>
      queryClient.setQueryData(sessionToolKeys.mcp(ref.environmentId, ref.sessionId), mcp),
    onError: (error) =>
      toastError('Could not reconnect the server', {
        description: errorMessage(error, 'The MCP server did not reconnect.'),
      }),
  })
}
