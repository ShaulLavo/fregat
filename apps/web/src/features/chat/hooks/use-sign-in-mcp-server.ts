import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { signInMcpServer } from '@/features/chat/transport/session-tools'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

/** Fetches the sign-in link; opening it remains a user gesture in the server row. */
export function useSignInMcpServer(ref: ScopedSessionRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: chatMutationKeys.signInMcpServer(ref.environmentId, ref.sessionId),
    mutationFn: (name: string) => signInMcpServer(ref, name),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: sessionToolKeys.mcp(ref.environmentId, ref.sessionId),
      }),
    onError: (error) =>
      toastError('Could not start the sign-in', {
        description: errorMessage(error, 'The MCP server gave no sign-in address.'),
      }),
  })
}
