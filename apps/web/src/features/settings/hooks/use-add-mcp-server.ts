import { useMutation } from '@tanstack/react-query'
import type { ProviderInstanceId, ProviderMcpAddBody } from '@workspace/contracts'
import { toast } from 'sonner'

import { addMcpServer, settleMcpQueries } from '@/features/settings/utils/mcp-query'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

export function useAddMcpServer(providerInstanceId: ProviderInstanceId, label: string) {
  const owner = useSettingsOwner()
  const mutationKey = settingsMutationKeys.mcp.add(providerInstanceId)
  return useMutation(
    {
      mutationKey,
      mutationFn: (body: ProviderMcpAddBody) => addMcpServer(owner, providerInstanceId, body),
      scope: { id: mutationKey.join(':') },
      onSuccess: async (_result, body) => {
        await settleMcpQueries(owner)
        toast.success(`Added ${body.name} to ${label}`)
      },
      retry: false,
    },
    owner,
  )
}
