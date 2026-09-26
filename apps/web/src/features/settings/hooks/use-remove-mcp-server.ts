import { useMutation } from '@tanstack/react-query'
import type { ProviderInstanceId, ProviderMcpRemoveBody } from '@workspace/contracts'

import { removeMcpServer, settleMcpQueries } from '@/features/settings/utils/mcp-query'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

export function useRemoveMcpServer(providerInstanceId: ProviderInstanceId, name: string) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.mcp.remove(providerInstanceId, name),
      mutationFn: (body: ProviderMcpRemoveBody) =>
        removeMcpServer(owner, providerInstanceId, name, body),
      onSuccess: () => settleMcpQueries(owner),
      retry: false,
    },
    owner,
  )
}
