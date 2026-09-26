import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProviderAccountUsage } from '@workspace/contracts'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { providerUsageKeys } from '@/features/chat/utils/query-keys'

export function useResetCredit(account: ProviderAccountUsage) {
  const queryClient = useQueryClient()
  const mutationKey = chatMutationKeys.resetCredit(
    account.resetCredits?.accountKey ?? account.accountKey,
  )
  const pending = useIsMutating({ mutationKey }) > 0
  const mutation = useMutation({
    mutationKey: chatMutationKeys.resetCredit(
      account.resetCredits?.accountKey ?? account.accountKey,
    ),
    scope: { id: `reset-credit:${account.resetCredits?.accountKey ?? account.accountKey}` },
    retry: false,
    mutationFn: async (confirmedAccount: ProviderAccountUsage) => {
      const credit = confirmedAccount.resetCredits
      if (!credit?.creditId)
        throw createRpcError({ message: 'Refresh usage before confirming a reset.' })
      const instance = confirmedAccount.providerInstanceIds[0]
      if (!instance) throw createRpcError({ message: 'The provider account is unavailable.' })
      const client = clientForQueryClient(queryClient)
      const response = await client
        .providers({ providerInstanceId: instance })
        ['reset-credit'].post({
          accountKey: credit.accountKey,
          creditId: credit.creditId,
          checkedAt: confirmedAccount.checkedAt,
          confirmed: true,
        })
      if (response.error) throw createRpcError(response.error)
      queryClient.setQueryData(providerUsageKeys.all, response.data.usage)
      return response.data
    },
    onError: () => queryClient.invalidateQueries({ queryKey: providerUsageKeys.all }),
  })
  return { ...mutation, isPending: mutation.isPending || pending }
}
