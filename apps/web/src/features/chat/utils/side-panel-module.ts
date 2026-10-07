import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { chatPanelQueryKeys } from '@/features/chat/utils/query-keys'
import { sidePanelModuleError } from '@/features/chat/utils/module-errors'
import { runMutation } from '@/lib/mutations/run'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type Module = typeof import('@/features/chat/components/chat-side-panel')

export function sidePanelModuleQueryOptions(client: QueryClient = resourceQueryClient) {
  const load = mutationOptions({
    mutationKey: chatMutationKeys.sidePanelModule,
    scope: { id: 'chat.sidePanelModule' },
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      const cached = client.getQueryData<Module>(chatPanelQueryKeys.module)
      if (cached) return cached
      try {
        return await import('@/features/chat/components/chat-side-panel')
      } catch (cause) {
        throw sidePanelModuleError(cause)
      }
    },
    onSuccess: (loaded) => {
      client.setQueryData(chatPanelQueryKeys.module, loaded)
    },
  })
  return queryOptions({
    queryKey: chatPanelQueryKeys.module,
    staleTime: 'static',
    gcTime: Infinity,
    structuralSharing: false,
    networkMode: 'always',
    retry: false,
    queryFn: () => runMutation(client, load, undefined),
  })
}
