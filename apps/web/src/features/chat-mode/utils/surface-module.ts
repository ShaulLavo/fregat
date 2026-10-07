import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { chatModeViewQueryKeys } from '@/features/chat-mode/utils/query-keys'
import { surfaceModuleError } from '@/features/chat-mode/utils/module-errors'
import { runMutation } from '@/lib/mutations/run'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type Module = typeof import('@/features/chat-mode/components/surface-view')

export function surfaceModuleQueryOptions(client: QueryClient = resourceQueryClient) {
  const load = mutationOptions({
    mutationKey: chatModeMutationKeys.surfaceModule,
    scope: { id: 'chat-mode.surfaceModule' },
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      const cached = client.getQueryData<Module>(chatModeViewQueryKeys.module)
      if (cached) return cached
      try {
        return await import('@/features/chat-mode/components/surface-view')
      } catch (cause) {
        throw surfaceModuleError(cause)
      }
    },
    onSuccess: (loaded) => {
      client.setQueryData(chatModeViewQueryKeys.module, loaded)
    },
  })
  return queryOptions({
    queryKey: chatModeViewQueryKeys.module,
    staleTime: 'static',
    gcTime: Infinity,
    structuralSharing: false,
    networkMode: 'always',
    retry: false,
    queryFn: () => runMutation(client, load, undefined),
  })
}
