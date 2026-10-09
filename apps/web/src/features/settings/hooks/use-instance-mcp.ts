import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'

import { instanceMcpQueryOptions } from '@/features/settings/utils/mcp-query'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

/** The held list carries the provider and folder that own its actions. */
export function useInstanceMcp(
  providerInstanceId: ProviderInstanceId | null,
  folder: string | null,
) {
  return useQuery(
    { ...instanceMcpQueryOptions(providerInstanceId, folder), placeholderData: keepPreviousData },
    useSettingsOwner(),
  )
}
