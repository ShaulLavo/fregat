import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
import { useMutation } from '@tanstack/react-query'
import type { ServerRestartResult, ServerRestartInput } from '@workspace/contracts'

import { unwrapEdenResponse } from '@/lib/eden-events'
import { clientForQueryClient, primaryQueryClient } from '@/lib/environments/state/query-clients'
import {
  SERVER_RESTART_SCOPE,
  serverUpdateMutationKeys,
} from '@/features/server-update/utils/mutation-keys'

/** Asks the primary server to restart; `interrupt` names the busy sessions the person accepted. */
export function useRestart() {
  const queryClient = primaryQueryClient()
  return useMutation(
    {
      mutationKey: serverUpdateMutationKeys.restart(),
      scope: { id: SERVER_RESTART_SCOPE },
      retry: false,
      mutationFn: async (input: ServerRestartInput): Promise<ServerRestartResult> => {
        const result = unwrapEdenResponse(
          await clientForQueryClient(queryClient).server.restart.post(input),
          { requireData: true },
        )
        await queryClient.invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
        return result
      },
    },
    queryClient,
  )
}
