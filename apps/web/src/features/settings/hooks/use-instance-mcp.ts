import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'

import { instanceMcpQueryOptions } from '@/features/settings/utils/mcp-query'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

/** Keeps the previous list on screen while a new folder or instance is read. */
export function useInstanceMcp(providerInstanceId: ProviderInstanceId, folder: string | null) {
  return useQuery(
    { ...instanceMcpQueryOptions(providerInstanceId, folder), placeholderData: keepPreviousData },
    useSettingsOwner(),
  )
}
