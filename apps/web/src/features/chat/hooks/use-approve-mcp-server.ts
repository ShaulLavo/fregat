import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { approveMcpServer } from '@/features/chat/transport/session-tools'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

export function useApproveMcpServer(ref: ScopedSessionRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: chatMutationKeys.approveMcpServer(ref.environmentId, ref.sessionId),
    mutationFn: (name: string) => approveMcpServer(ref, name),
    onSuccess: (mcp) =>
      queryClient.setQueryData(sessionToolKeys.mcp(ref.environmentId, ref.sessionId), mcp),
    onError: (error) =>
      toastError('Could not approve the server', {
        description: errorMessage(error, 'The MCP server was not approved.'),
      }),
  })
}
