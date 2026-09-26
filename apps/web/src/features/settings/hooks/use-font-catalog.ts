import { useQuery } from '@tanstack/react-query'
import type { FontCatalogEntry } from '@workspace/contracts'

import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

/**
 * Every font the server can fetch and cache: the Nerd Fonts and all of Fontsource. About 2,000
 * rows of metadata, fetched once when a picker first opens and searched on the client.
 */
export function useFontCatalog(enabled: boolean) {
  const owner = useSettingsOwner()
  return useQuery(
    {
      queryKey: settingsQueryKeys.fontCatalog,
      queryFn: async ({ client }): Promise<readonly FontCatalogEntry[]> => {
        const response = await clientForQueryClient(client).fonts.get()
        if (response.error) throw createRpcError(response.error)

        return response.data
      },
      enabled,
      staleTime: 'static',
    },
    owner,
  )
}
